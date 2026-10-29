import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { get, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';
import { createGateway } from '../gateway.mjs';

const ownerToken = randomBytes(32).toString('base64url');
const authTokenHash = createHash('sha256').update(ownerToken).digest('hex');

async function fixture(t, configured = true) {
  const dir = await mkdtemp(join(tmpdir(), 'studio-gateway-'));
  await writeFile(join(dir, 'index.html'), '<!doctype html><title>fixture</title>');
  await writeFile(join(dir, 'private-fixture.txt'), 'synthetic-confidential-data');
  let time = 1_800_000_000_000;
  const server = await createGateway({ authTokenHash, providerConfigured: configured, staticDirectory: dir, now: () => time });
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(dir, { recursive: true, force: true }); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function request(path, { method = 'GET', body, headers = {}, cookies = '' } = {}) {
    const common = { ...(method !== 'GET' ? { Origin: origin } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookies ? { Cookie: cookies } : {}), ...headers };
    return fetch(origin + path, { method, headers: common, ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
  }
  async function login(previous = '') {
    const response = await request('/api/v2/auth/login', { method: 'POST', body: { token: ownerToken }, cookies: previous, headers: { 'X-Studio-Request': 'login' } });
    assert.equal(response.status, 200);
    const body = await response.json(), cookies = response.headers.getSetCookie();
    return { csrf: body.csrfToken, cookie: cookies.find((c) => c.startsWith('app_session=')).split(';')[0], cookies };
  }
  async function connect(session, cookies = session.cookie) {
    return request('/api/v2/session/connect', { method: 'POST', body: { provider: 'openai' }, cookies, headers: { 'X-CSRF-Token': session.csrf, 'X-Client-Request-Id': randomUUID() } });
  }
  return { request, login, connect, origin, server, advance: (ms) => { time += ms; } };
}

test('authentication rejects unauthenticated, cross-origin and malformed login requests', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/v2/session/status')).status, 401);
  assert.equal((await f.request('/api/v2/auth/login', { method: 'POST', body: { token: ownerToken }, headers: { Origin: 'https://attacker.invalid', 'X-Studio-Request': 'login' } })).status, 403);
  assert.equal((await f.request('/api/v2/auth/login', { method: 'POST', body: { token: ownerToken } })).status, 403);
  assert.equal((await f.request('/api/v2/auth/login', { method: 'POST', body: { token: ownerToken }, headers: { 'X-Studio-Request': 'login', 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await f.request('/api/v2/auth/login', { method: 'POST', body: { token: ownerToken, extra: true }, headers: { 'X-Studio-Request': 'login' } })).status, 401);
  const session = await f.login();
  assert.match(session.cookies[0], /HttpOnly; Secure; SameSite=Strict/);
  assert.ok(session.csrf.length >= 32);
});

test('provider authorization requires session-bound CSRF and cannot be replayed after disconnect', async (t) => {
  const f = await fixture(t), a = await f.login(), b = await f.login();
  const noCsrf = await f.request('/api/v2/session/connect', { method: 'POST', body: { provider: 'openai' }, cookies: a.cookie, headers: { 'X-Client-Request-Id': randomUUID() } });
  assert.equal(noCsrf.status, 403);
  const wrongCsrf = await f.request('/api/v2/session/connect', { method: 'POST', body: { provider: 'openai' }, cookies: a.cookie, headers: { 'X-CSRF-Token': b.csrf, 'X-Client-Request-Id': randomUUID() } });
  assert.equal(wrongCsrf.status, 403);
  const connected = await f.connect(a);
  assert.equal(connected.status, 201);
  assert.equal(connected.headers.get('cache-control'), 'no-store');
  const provider = connected.headers.getSetCookie()[0].split(';')[0];
  assert.match(connected.headers.getSetCookie()[0], /HttpOnly; Secure; SameSite=Strict/);
  const cookiesA = `${a.cookie}; ${provider}`;
  const statusA = await (await f.request('/api/v2/session/status', { cookies: cookiesA })).json();
  assert.equal(statusA.connected, true); assert.equal(statusA.configured, true);
  const statusB = await (await f.request('/api/v2/session/status', { cookies: `${b.cookie}; ${provider}` })).json();
  assert.equal(statusB.connected, false);
  const disconnected = await f.request('/api/v2/session', { method: 'DELETE', cookies: cookiesA, headers: { 'X-CSRF-Token': a.csrf } });
  assert.equal(disconnected.status, 204);
  const after = await (await f.request('/api/v2/session/status', { cookies: cookiesA })).json();
  assert.equal(after.connected, false); assert.equal(after.configured, true);
});

test('login rotation, logout and expiry revoke old authorizations', async (t) => {
  const f = await fixture(t), original = await f.login();
  const connected = await f.connect(original), provider = connected.headers.getSetCookie()[0].split(';')[0];
  const rotated = await f.login(original.cookie);
  assert.equal((await f.request('/api/v2/auth/session', { cookies: original.cookie })).status, 401);
  assert.equal((await (await f.request('/api/v2/session/status', { cookies: `${rotated.cookie}; ${provider}` })).json()).connected, false);
  const fresh = await f.connect(rotated), freshProvider = fresh.headers.getSetCookie()[0].split(';')[0];
  f.advance(60 * 60 * 1000 + 1);
  assert.equal((await (await f.request('/api/v2/session/status', { cookies: `${rotated.cookie}; ${freshProvider}` })).json()).connected, false);
  const logout = await f.request('/api/v2/auth/logout', { method: 'POST', cookies: rotated.cookie, headers: { 'X-CSRF-Token': rotated.csrf } });
  assert.equal(logout.status, 204);
  assert.equal((await f.request('/api/v2/auth/session', { cookies: rotated.cookie })).status, 401);
  const expiring = await f.login(); f.advance(8 * 60 * 60 * 1000 + 1);
  assert.equal((await f.request('/api/v2/auth/session', { cookies: expiring.cookie })).status, 401);
});

test('disconnect wins over an earlier in-flight connection request', async (t) => {
  const f = await fixture(t), session = await f.login();
  const started = new Promise((resolve) => f.server.once('request', resolve));
  let pending;
  const result = new Promise((resolve, reject) => {
    pending = httpRequest(`${f.origin}/api/v2/session/connect`, { method: 'POST', headers: { Origin: f.origin, Cookie: session.cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf, 'X-Client-Request-Id': randomUUID() } }, (response) => { response.resume(); resolve(response.statusCode); });
    pending.on('error', reject); pending.write('{\"provider\":');
  });
  await started;
  const disconnected = await f.request('/api/v2/session', { method: 'DELETE', cookies: session.cookie, headers: { 'X-CSRF-Token': session.csrf } });
  assert.equal(disconnected.status, 204);
  pending.end('\"openai\"}');
  assert.equal(await result, 409);
  assert.equal((await (await f.request('/api/v2/session/status', { cookies: session.cookie })).json()).connected, false);
});

test('logout prevents an earlier in-flight login from reauthenticating', async (t) => {
  const f = await fixture(t), session = await f.login();
  const started = new Promise((resolve) => f.server.once('request', resolve));
  let pending;
  const result = new Promise((resolve, reject) => {
    pending = httpRequest(`${f.origin}/api/v2/auth/login`, { method: 'POST', headers: { Origin: f.origin, 'Content-Type': 'application/json', 'X-Studio-Request': 'login' } }, (response) => { response.resume(); resolve(response.statusCode); });
    pending.on('error', reject); pending.write('{\"token\":');
  });
  await started;
  assert.equal((await f.request('/api/v2/auth/logout', { method: 'POST', cookies: session.cookie, headers: { 'X-CSRF-Token': session.csrf } })).status, 204);
  pending.end(JSON.stringify(ownerToken) + '}');
  assert.equal(await result, 409);
  assert.equal((await f.request('/api/v2/auth/session', { cookies: session.cookie })).status, 401);
});

test('connection attempts are bounded per session', async (t) => {
  const f = await fixture(t), session = await f.login();
  for (let i = 0; i < 20; i++) assert.equal((await f.connect(session)).status, 201);
  assert.equal((await f.connect(session)).status, 429);
  f.advance(10 * 60 * 1000);
  assert.equal((await f.connect(session)).status, 201);
});

test('provider allowlist, body limits and missing configuration fail closed', async (t) => {
  const f = await fixture(t, false), session = await f.login();
  assert.equal((await f.connect(session)).status, 503);
  for (const body of [{ provider: 'attacker' }, { provider: 'openai', key: 'synthetic-secret' }]) {
    const response = await f.request('/api/v2/session/connect', { method: 'POST', body, cookies: session.cookie, headers: { 'X-CSRF-Token': session.csrf, 'X-Client-Request-Id': randomUUID() } });
    assert.equal(response.status, 400);
    assert.doesNotMatch(await response.text(), /synthetic-secret/);
  }
  const large = await f.request('/api/v2/session/connect', { method: 'POST', body: JSON.stringify({ provider: 'openai', padding: 'x'.repeat(5000) }), cookies: session.cookie, headers: { 'X-CSRF-Token': session.csrf, 'X-Client-Request-Id': randomUUID() } });
  assert.equal(large.status, 413);
  const chunked = await new Promise((resolve, reject) => {
    const req = httpRequest(`${f.origin}/api/v2/session/connect`, { method: 'POST', headers: { Origin: f.origin, Cookie: session.cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf, 'X-Client-Request-Id': randomUUID() } }, (response) => { response.resume(); resolve(response.statusCode); });
    req.on('error', reject); req.write('x'.repeat(3000)); req.end('x'.repeat(3000));
  });
  assert.equal(chunked, 413);
  const unexpectedBody = await f.request('/api/v2/auth/logout', { method: 'POST', body: { unexpected: true }, cookies: session.cookie, headers: { 'X-CSRF-Token': session.csrf } });
  assert.equal(unexpectedBody.status, 400);
  assert.equal((await f.request('/api/v2/auth/session', { cookies: session.cookie })).status, 200);
  const nonJson = await f.request('/api/v2/session/connect', { method: 'POST', body: 'provider=openai', cookies: session.cookie, headers: { 'Content-Type': 'text/plain', 'X-CSRF-Token': session.csrf, 'X-Client-Request-Id': randomUUID() } });
  assert.equal(nonJson.status, 400);
  assert.equal((await f.request('/api/v2/images/generate', { method: 'POST', cookies: session.cookie, headers: { 'X-CSRF-Token': session.csrf } })).status, 404);
});

test('login throttling and Host validation reject brute force and DNS rebinding', async (t) => {
  const f = await fixture(t);
  const status = await new Promise((resolve, reject) => get(`${f.origin}/api/v2/health`, { headers: { Host: 'attacker.invalid' } }, (response) => { response.resume(); resolve(response.statusCode); }).on('error', reject));
  assert.equal(status, 403);
  for (let i = 0; i < 5; i++) {
    const response = await f.request('/api/v2/auth/login', { method: 'POST', body: { token: randomBytes(32).toString('base64url') }, headers: { 'X-Studio-Request': 'login' } });
    assert.equal(response.status, 401);
  }
  assert.equal((await f.request('/api/v2/auth/login', { method: 'POST', body: { token: ownerToken }, headers: { 'X-Studio-Request': 'login' } })).status, 429);
  f.advance(15 * 60 * 1000);
  await f.login();
});

test('concurrent incomplete logins consume the failure budget before their bodies finish', async (t) => {
  const f = await fixture(t);
  let count = 0;
  const started = new Promise((resolve) => f.server.on('request', (req) => { if (req.url === '/api/v2/auth/login' && ++count === 5) resolve(); }));
  const requests = [], results = [];
  for (let i = 0; i < 5; i++) {
    results.push(new Promise((resolve, reject) => {
      const req = httpRequest(`${f.origin}/api/v2/auth/login`, { method: 'POST', headers: { Origin: f.origin, 'Content-Type': 'application/json', 'X-Studio-Request': 'login' } }, (response) => { response.resume(); resolve(response.statusCode); });
      req.on('error', reject); requests.push(req); req.write('{\"token\":');
    }));
  }
  await started;
  assert.equal((await f.request('/api/v2/auth/login', { method: 'POST', body: { token: ownerToken }, headers: { 'X-Studio-Request': 'login' } })).status, 429);
  for (const req of requests) req.end('\"incorrect\"}');
  assert.deepEqual(await Promise.all(results), [401, 401, 401, 401, 401]);
});

test('static serving cannot follow symlinks or expose arbitrary paths', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request('/products/new')).status, 200);
  assert.equal((await f.request('/settings')).status, 200);
  assert.equal((await f.request('/gateway.mjs')).status, 404);
  assert.equal((await f.request('/private-fixture.txt')).status, 404);
  assert.equal((await f.request('/%2e%2e/package.json')).status, 404);
  const dir = await mkdtemp(join(tmpdir(), 'studio-gateway-symlink-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'index.html'), 'fixture'); await symlink(join(dir, 'index.html'), join(dir, 'escape'));
  await assert.rejects(createGateway({ authTokenHash, providerConfigured: false, staticDirectory: dir }), /symbolic links/i);
});

test('gateway responses conform to the canonical OpenAPI schemas', async (t) => {
  const spec = parse(await readFile(new URL('../../contracts/openapi.yaml', import.meta.url), 'utf8'));
  const ajv = new Ajv2020({ strict: false }); addFormats(ajv);
  const validate = Object.fromEntries(['ErrorEnvelope', 'AppSessionStatus', 'SessionStatus'].map((name) => [name, ajv.compile(spec.components.schemas[name])]));
  async function conforms(response, status, schema) {
    assert.equal(response.status, status);
    const body = await response.json();
    assert.ok(validate[schema](body), JSON.stringify(validate[schema].errors));
    return body;
  }
  const f = await fixture(t), missing = await fixture(t, false);
  await conforms(await f.request('/api/v2/session/status'), 401, 'ErrorEnvelope');
  const login = await f.request('/api/v2/auth/login', { method: 'POST', body: { token: ownerToken }, headers: { 'X-Studio-Request': 'login' } });
  const app = await conforms(login, 200, 'AppSessionStatus');
  const session = { csrf: app.csrfToken, cookie: login.headers.getSetCookie()[0].split(';')[0] };
  await conforms(await f.connect(session), 201, 'SessionStatus');
  await conforms(await f.request('/api/v2/session/status', { cookies: session.cookie }), 200, 'SessionStatus');
  await conforms(await f.request('/api/v2/does-not-exist', { cookies: session.cookie }), 404, 'ErrorEnvelope');
  await conforms(await f.request('/api/v2/session/connect', { method: 'POST', body: { provider: 'other' }, cookies: session.cookie, headers: { 'X-CSRF-Token': session.csrf, 'X-Client-Request-Id': randomUUID() } }), 400, 'ErrorEnvelope');
  await conforms(await f.request('/api/v2/session/connect', { method: 'POST', body: 'x'.repeat(5000), cookies: session.cookie, headers: { 'X-CSRF-Token': session.csrf, 'X-Client-Request-Id': randomUUID() } }), 413, 'ErrorEnvelope');
  await conforms(await missing.connect(await missing.login()), 503, 'ErrorEnvelope');
});
