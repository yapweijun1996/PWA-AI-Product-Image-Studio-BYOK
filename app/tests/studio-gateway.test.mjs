import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { deflateSync } from 'node:zlib';
import { createGateway } from '../gateway.mjs';
import { createAttemptJournal } from '../studio-journal.mjs';
import { STUDIO_PROMPT, STUDIO_MODEL, STUDIO_QUALITY, STUDIO_SIZE, STUDIO_PROMPT_VERSION, studioEstimateUSD } from '../studio-policy.mjs';

const loginToken = randomBytes(32).toString('base64url');
const authTokenHash = createHash('sha256').update(loginToken).digest('hex');
const fakeKey = 'synthetic-provider-secret';
function crc(bytes) { let c = 0xffffffff; for (const b of bytes) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const name = Buffer.from(type), len = Buffer.alloc(4), sum = Buffer.alloc(4); len.writeUInt32BE(data.length); sum.writeUInt32BE(crc(Buffer.concat([name, data]))); return Buffer.concat([len, name, data, sum]); }
function png() {
  const header = Buffer.alloc(13); header.writeUInt32BE(1024, 0); header.writeUInt32BE(1024, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.alloc(1024 * (1 + 1024 * 4)))), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}
const image = png();
function attempt() { return { clientAttemptId: randomUUID(), productId: randomUUID(), styleId: 'studio', lockMode: 'STRICT', operation: 'generate_scene', model: STUDIO_MODEL, quality: STUDIO_QUALITY, size: STUDIO_SIZE, prompt: STUDIO_PROMPT, promptVersion: STUDIO_PROMPT_VERSION, sourceAssetHashes: ['a'.repeat(64)], estimatedUSD: studioEstimateUSD(), outputFormat: 'png' }; }
function success() { return new Response(JSON.stringify({ data: [{ b64_json: image }], usage: { secret: fakeKey } }), { status: 200, headers: { 'content-type': 'application/json' } }); }
async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'studio-attempt-')), journal = join(root, 'journal'), web = join(root, 'web');
  await mkdir(journal, { mode: 0o700 }); await mkdir(web); await writeFile(join(web, 'index.html'), 'fixture');
  let time = 1_800_000_000_000, server, origin, calls = [], currentToken = loginToken, currentHash = authTokenHash;
  const transport = options.transport ?? (async (url, init) => { calls.push({ url, init }); return success(); });
  async function start() {
    server = await createGateway({ authTokenHash: currentHash, providerConfigured: true, staticDirectory: web, now: () => time, imageGeneration: { enabled: true, apiKey: fakeKey, journalDirectory: journal, transport, timeoutMs: options.timeoutMs ?? 500, maxAttemptsPerHour: options.maxAttemptsPerHour ?? 10, maxEstimatedUSD: options.maxEstimatedUSD ?? '0.010000' } });
    await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() { if (server?.listening) await new Promise((resolve) => server.close(resolve)); }
  await start(); t.after(async () => { await stop(); await rm(root, { recursive: true, force: true }); });
  async function req(path, session, body, extra = {}) { return fetch(origin + path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrf } : { 'X-Studio-Request': 'login' }), ...extra }, body: JSON.stringify(body) }); }
  async function login() {
    const res = await req('/api/v2/auth/login', null, { token: currentToken }); const csrf = (await res.json()).csrfToken; const app = res.headers.getSetCookie()[0].split(';')[0];
    const connect = await req('/api/v2/session/connect', { cookie: app, csrf }, { provider: 'openai' }, { 'X-Client-Request-Id': randomUUID() });
    return { csrf, cookie: `${app}; ${connect.headers.getSetCookie()[0].split(';')[0]}` };
  }
  async function approve(s, body) { return req('/api/v2/images/approvals', s, body); }
  async function generate(s, body, approvalId) { return req('/api/v2/images/generate', s, body, { 'X-Attempt-Approval': approvalId, 'X-Client-Request-Id': body.clientAttemptId }); }
  return { journal, web, calls, start, stop, login, req, approve, generate, advance: (ms) => { time += ms; }, rotate: () => { currentToken = randomBytes(32).toString('base64url'); currentHash = createHash('sha256').update(currentToken).digest('hex'); }, get origin() { return origin; }, get server() { return server; } };
}
async function approval(f, session, body) { const res = await f.approve(session, body); assert.equal(res.status, 201); return (await res.json()).approvalId; }

test('approved strict request reaches only fixed provider route once and returns validated background', async (t) => {
  const f = await fixture(t), s = await f.login(), body = attempt(), id = await approval(f, s, body);
  assert.equal(f.calls.length, 0);
  const response = await f.generate(s, body, id), result = await response.json();
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(result.clientAttemptId, body.clientAttemptId); assert.equal(result.outcome, 'DEFINITIVE_SUCCESS'); assert.equal(result.image.dataBase64, image);
  assert.deepEqual([result.image.width, result.image.height, result.image.mimeType, result.usage, result.observedUSD, result.providerRequestId], [1024, 1024, 'image/png', null, null, null]);
  assert.equal(f.calls.length, 1); const sent = f.calls[0]; assert.equal(sent.url, 'https://api.openai.com/v1/images/generations'); assert.equal(sent.init.redirect, 'error');
  assert.deepEqual(JSON.parse(sent.init.body), { model: STUDIO_MODEL, prompt: STUDIO_PROMPT, quality: STUDIO_QUALITY, size: STUDIO_SIZE, output_format: 'png', n: 1 });
  assert.doesNotMatch(sent.init.body, /aaaaaaaaaaaaaaaa|synthetic-provider-secret/);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-provider-secret/);
  const records = await Promise.all((await readdir(f.journal)).map((name) => readFile(join(f.journal, name), 'utf8')));
  assert.doesNotMatch(records.join(''), /synthetic-provider-secret|neutral|base64|csrf|approval/i);
  assert.equal((await f.generate(s, body, id)).status, 409);
  assert.equal((await f.generate(s, body, await approval(f, s, body))).status, 409); assert.equal(f.calls.length, 1);
  const changed = { ...body, productId: randomUUID() };
  assert.equal((await f.generate(s, changed, await approval(f, s, changed))).status, 409); assert.equal(f.calls.length, 1);
  await f.stop(); await f.start(); const again = await f.login();
  assert.equal((await f.generate(again, body, await approval(f, again, body))).status, 409); assert.equal(f.calls.length, 1);
});

test('strict validation, estimated-cost guard, body cap, and binding reject without provider calls', async (t) => {
  const f = await fixture(t), a = await f.login(), b = await f.login(), body = attempt(), id = await approval(f, a, body);
  assert.equal((await f.generate(b, body, id)).status, 409);
  const changed = { ...body, productId: randomUUID() }; assert.equal((await f.generate(a, changed, id)).status, 409);
  for (const patch of [{ prompt: 'user text' }, { model: 'other' }, { lockMode: 'CREATIVE' }, { operation: 'reference_edit' }, { sourceAssetHashes: [] }, { imageDataBase64: 'secret' }, { estimatedUSD: '0.000001' }, { maxEstimatedUSD: '0.001' }, { outputFormat: 'webp' }]) assert.equal((await f.approve(a, { ...body, ...patch })).status, 400);
  assert.equal((await f.req('/api/v2/images/generate', a, body, { 'X-Attempt-Approval': id, 'X-Client-Request-Id': randomUUID() })).status, 400);
  assert.equal((await f.approve(a, { ...body, prompt: 'x'.repeat(5000) })).status, 413);
  assert.equal(f.calls.length, 0);
  const guarded = await fixture(t, { maxEstimatedUSD: '0.001000' }), c = await guarded.login(); assert.equal((await guarded.approve(c, attempt())).status, 403); assert.equal(guarded.calls.length, 0);
});

test('approval expires, disconnect invalidates, and in-flight body cannot submit after logout', async (t) => {
  const f = await fixture(t), a = await f.login(), body = attempt(), id = await approval(f, a, body);
  f.advance(5 * 60 * 1000 + 1); assert.equal((await f.generate(a, body, id)).status, 409);
  const id2 = await approval(f, a, body);
  const started = new Promise((resolve) => f.server.once('request', resolve));
  let startRequest;
  const start = new Promise((resolve, reject) => { startRequest = httpRequest(f.origin + '/api/v2/images/generate', { method: 'POST', headers: { Origin: f.origin, Cookie: a.cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': a.csrf, 'X-Attempt-Approval': id2, 'X-Client-Request-Id': body.clientAttemptId } }, (res) => { res.resume(); resolve(res.statusCode); }); startRequest.on('error', reject); startRequest.write('{'); });
  await started;
  const logout = await fetch(f.origin + '/api/v2/auth/logout', { method: 'POST', headers: { Origin: f.origin, Cookie: a.cookie, 'X-CSRF-Token': a.csrf } }); assert.equal(logout.status, 204);
  startRequest.end(JSON.stringify(body).slice(1)); assert.equal(await start, 401); assert.equal(f.calls.length, 0);
});

test('concurrent reservations, hourly rate, and restart never resend', async (t) => {
  const f = await fixture(t, { maxAttemptsPerHour: 1 }), s = await f.login(), body = attempt();
  const [a, b] = await Promise.all([approval(f, s, body), approval(f, s, body)]);
  const pair = await Promise.all([f.generate(s, body, a), f.generate(s, body, b)]); assert.deepEqual(pair.map((r) => r.status).sort(), [200, 409]); assert.equal(f.calls.length, 1);
  const next = attempt(); assert.equal((await f.generate(s, next, await approval(f, s, next))).status, 429);
  await f.stop(); await f.start(); const s2 = await f.login(), later = attempt(); assert.equal((await f.generate(s2, later, await approval(f, s2, later))).status, 429); assert.equal(f.calls.length, 1);
});

test('access-token rotation preserves duplicate and hourly attempt protections', async (t) => {
  const f = await fixture(t, { maxAttemptsPerHour: 1 }), first = await f.login(), body = attempt();
  assert.equal((await f.generate(first, body, await approval(f, first, body))).status, 200);
  await f.stop(); f.rotate(); await f.start();
  const next = await f.login();
  assert.equal((await f.generate(next, body, await approval(f, next, body))).status, 409);
  const other = attempt();
  assert.equal((await f.generate(next, other, await approval(f, next, other))).status, 429);
  assert.equal(f.calls.length, 1);
});

test('ambiguous provider timeout and malformed image retain UNKNOWN and block resends', async (t) => {
  for (const mode of ['timeout', 'malformed']) {
    let count = 0;
    const f = await fixture(t, { timeoutMs: 25, transport: async () => { count++; if (mode === 'timeout') return new Promise(() => {}); return new Response(JSON.stringify({ data: [{ b64_json: 'bm90LXBuZw==' }] }), { headers: { 'content-type': 'application/json' } }); } });
    const s = await f.login(), body = attempt(), response = await f.generate(s, body, await approval(f, s, body));
    assert.equal(response.status, 504); assert.equal((await response.json()).error.outcome, 'UNKNOWN');
    assert.equal((await f.generate(s, body, await approval(f, s, body))).status, 409);
    await f.stop(); await f.start(); const s2 = await f.login(); assert.equal((await f.generate(s2, body, await approval(f, s2, body))).status, 409); assert.equal(count, 1);
  }
});

test('journal corruption and unsafe directory fail closed', async (t) => {
  const f = await fixture(t); await f.stop(); await writeFile(join(f.journal, 'invalid'), 'broken'); await assert.rejects(() => f.start());
  await assert.rejects(() => createGateway({ authTokenHash, providerConfigured: true, staticDirectory: f.web, imageGeneration: { enabled: true, apiKey: fakeKey, journalDirectory: 'relative', transport: () => { throw new Error('network forbidden'); } } }));
});

test('crash after durable reservation blocks the same attempt after restart', async (t) => {
  const f = await fixture(t), body = attempt();
  await f.stop();
  const store = await createAttemptJournal(f.journal), principal = createHash('sha256').update('studio-local-owner-v1').digest('hex');
  assert.equal(await store.reserve(principal, body.clientAttemptId, 'b'.repeat(64), 1_800_000_000_000, 10), 'reserved');
  await f.start(); const s = await f.login();
  assert.equal((await f.generate(s, body, await approval(f, s, body))).status, 409); assert.equal(f.calls.length, 0);
});

test('provider 400 is definitive and concurrent different attempts cannot send simultaneously', async (t) => {
  let release, entered;
  const begun = new Promise((resolve) => { entered = resolve; });
  let count = 0;
  const f = await fixture(t, { transport: async () => { count++; entered(); await new Promise((resolve) => { release = resolve; }); return new Response('synthetic error', { status: 400 }); } });
  const s = await f.login(), first = attempt(), second = attempt(), a = await approval(f, s, first), b = await approval(f, s, second);
  const pending = f.generate(s, first, a); await begun;
  const busy = await f.generate(s, second, b); assert.equal(busy.status, 409);
  assert.equal((await busy.json()).error.code, 'ATTEMPT_BUSY');
  release(); const failed = await pending; assert.equal(failed.status, 502); assert.equal((await failed.json()).error.outcome, 'DEFINITIVE_FAILURE'); assert.equal(count, 1);
});

test('disconnect invalidates the bound provider session and approval', async (t) => {
  const f = await fixture(t), s = await f.login(), body = attempt(), id = await approval(f, s, body);
  const disconnected = await fetch(f.origin + '/api/v2/session', { method: 'DELETE', headers: { Origin: f.origin, Cookie: s.cookie, 'X-CSRF-Token': s.csrf } });
  assert.equal(disconnected.status, 204); assert.equal((await f.generate(s, body, id)).status, 401); assert.equal(f.calls.length, 0);
});
