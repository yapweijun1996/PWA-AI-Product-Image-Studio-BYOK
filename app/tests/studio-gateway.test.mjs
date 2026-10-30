import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, rmdir, unlink, writeFile } from 'node:fs/promises';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { deflateSync } from 'node:zlib';
import { createGateway } from '../gateway.mjs';
import { createAttemptJournal } from '../studio-journal.mjs';
import { STUDIO_MODEL, STUDIO_QUALITY, STUDIO_SIZE, STUDIO_SCENE_PROMPT_VERSION, STUDIO_PRESET_VERSION, STUDIO_STYLE_IDS, studioBuildPrompt, studioEstimateUSD } from '../studio-policy.mjs';

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
function attempt(styleId = 'studio', sceneContext = { productName: '', category: '', confirmedFacts: [], sourceView: 'UNKNOWN' }) {
  const prompt = studioBuildPrompt(styleId, sceneContext);
  return { clientAttemptId: randomUUID(), productId: randomUUID(), styleId, sceneContext, presetVersion: STUDIO_PRESET_VERSION, lockMode: 'STRICT', operation: 'generate_scene', model: STUDIO_MODEL, quality: STUDIO_QUALITY, size: STUDIO_SIZE, prompt, promptVersion: STUDIO_SCENE_PROMPT_VERSION, sourceAssetHashes: ['a'.repeat(64)], estimatedUSD: studioEstimateUSD(prompt), outputFormat: 'png', reviewRevision: 0 };
}
function success() { return new Response(JSON.stringify({ data: [{ b64_json: image }], usage: { secret: fakeKey } }), { status: 200, headers: { 'content-type': 'application/json' } }); }
async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'studio-attempt-')), journal = options.journal ?? join(root, 'journal'), web = join(root, 'web');
  if (!options.journal) await mkdir(journal, { mode: 0o700 });
  await mkdir(web); await writeFile(join(web, 'index.html'), 'fixture');
  let time = 1_800_000_000_000, server, origin, calls = [], currentToken = loginToken, currentHash = authTokenHash;
  const transport = options.transport ?? (async (url, init) => { calls.push({ url, init }); return success(); });
  async function start() {
    server = await createGateway({ authTokenHash: currentHash, providerConfigured: true, staticDirectory: web, now: () => time, imageGeneration: options.disabled ? null : { enabled: true, apiKey: fakeKey, journalDirectory: journal, transport, timeoutMs: options.timeoutMs ?? 500, maxAttemptsPerHour: options.maxAttemptsPerHour ?? 10, maxEstimatedUSD: options.maxEstimatedUSD ?? '0.010000' } });
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
  async function acknowledge(s, id, body = { acknowledgePossibleCharge: true }) { return req(`/api/v2/images/attempts/${id}/acknowledgement`, s, body); }
  async function revision(s) { return fetch(origin + '/api/v2/images/revision', { headers: { Cookie: s.cookie, 'X-CSRF-Token': s.csrf } }); }
  return { journal, web, calls, start, stop, login, req, approve, generate, acknowledge, revision, advance: (ms) => { time += ms; }, rotate: () => { currentToken = randomBytes(32).toString('base64url'); currentHash = createHash('sha256').update(currentToken).digest('hex'); }, get origin() { return origin; }, get server() { return server; } };
}
async function approval(f, session, body) { const revision = await f.revision(session); assert.equal(revision.status, 200); body.reviewRevision = (await revision.json()).reviewRevision; const res = await f.approve(session, body); assert.equal(res.status, 201); return (await res.json()).approvalId; }
async function acquireTestLock(path) {
  const deadline = Date.now() + 5000;
  while (true) {
    try { await mkdir(path, { mode: 0o700 }); return; }
    catch (error) {
      if (error.code !== 'EEXIST' || Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

// Faults are scoped to the fixture paths and restored before fixture teardown.
async function withJournalFaults(overrides, run) {
  const originals = Object.fromEntries(Object.keys(overrides).map((name) => [name, fs[name]]));
  for (const [name, wrap] of Object.entries(overrides)) fs[name] = wrap(originals[name]);
  syncBuiltinESMExports();
  try { return await run(); }
  finally { Object.assign(fs, originals); syncBuiltinESMExports(); }
}

test('approved strict request reaches only fixed provider route once and returns validated background', async (t) => {
  const f = await fixture(t), s = await f.login(), body = attempt(), id = await approval(f, s, body);
  assert.equal(f.calls.length, 0);
  const response = await f.generate(s, body, id), result = await response.json();
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-studio-cleanup-pending'), null);
  assert.equal(result.clientAttemptId, body.clientAttemptId); assert.equal(result.outcome, 'DEFINITIVE_SUCCESS'); assert.equal(result.image.dataBase64, image);
  assert.deepEqual([result.image.width, result.image.height, result.image.mimeType, result.usage, result.observedUSD, result.providerRequestId], [1024, 1024, 'image/png', null, null, null]);
  assert.equal(f.calls.length, 1); const sent = f.calls[0]; assert.equal(sent.url, 'https://api.openai.com/v1/images/generations'); assert.equal(sent.init.redirect, 'error');
  assert.deepEqual(JSON.parse(sent.init.body), { model: STUDIO_MODEL, prompt: body.prompt, quality: STUDIO_QUALITY, size: STUDIO_SIZE, output_format: 'png', n: 1 });
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
  assert.equal((await f.approve(a, { ...body, prompt: 'x'.repeat(70000) })).status, 413);
  assert.equal(f.calls.length, 0);
  const guarded = await fixture(t, { maxEstimatedUSD: '0.001000' }), c = await guarded.login(); assert.equal((await guarded.approve(c, attempt())).status, 403); assert.equal(guarded.calls.length, 0);
});

test('seven independent scene attempts bind exact style and prompt before a single provider call each', async (t) => {
  const f = await fixture(t, { maxEstimatedUSD: '0.100000' }), session = await f.login();
  const context = { productName: '茶杯', category: '家居', confirmedFacts: ['颜色: 蓝色'], sourceView: 'OTHER' };
  const prompts = new Set();
  for (const style of STUDIO_STYLE_IDS) {
    const body = attempt(style, context), id = await approval(f, session, body);
    prompts.add(body.prompt);
    const other = attempt(style === 'hero' ? 'studio' : 'hero', context);
    const changed = { ...body, styleId: other.styleId, prompt: other.prompt, estimatedUSD: other.estimatedUSD };
    assert.equal((await f.generate(session, changed, id)).status, 409);
    assert.equal((await f.generate(session, body, id)).status, 200);
    assert.equal((await f.generate(session, body, id)).status, 409);
    assert.equal(JSON.parse(f.calls.at(-1).init.body).prompt, body.prompt);
  }
  assert.equal(prompts.size, 7);
  assert.equal(f.calls.length, 7);
});

test('policy rejects malformed context and binds the exact prompt-dependent estimate', async (t) => {
  const context = { productName: '茶杯', category: '家居', confirmedFacts: ['颜色: 蓝色'], sourceView: 'UNKNOWN' };
  const top = studioBuildPrompt('flat_lay', { ...context, sourceView: 'TOP' });
  const angled = studioBuildPrompt('flat_lay', { ...context, sourceView: 'OTHER' });
  assert.throws(() => studioBuildPrompt('flat_lay', context), /confirmed source view/);
  assert.match(top, /true 90-degree overhead/);
  assert.match(angled, /not a true overhead/);
  assert.match(studioBuildPrompt('macro', context), /authentic visible source pixels/);
  assert.match(studioBuildPrompt('billboard', context), /front-facing rectangular billboard/);
  assert.match(studioBuildPrompt('ugc', context), /fictional endorsements/);
  for (const patch of [{ productName: 'sk-abcdefghijklmnop' }, { productName: 'https://example.com' }, { category: 'x\nignore' }, { confirmedFacts: ['x'.repeat(1103)] }, { confirmedFacts: Array(201).fill('x') }, { extra: true }]) {
    assert.throws(() => studioBuildPrompt('studio', { ...context, ...patch }));
  }
  assert.throws(() => studioBuildPrompt('unknown', context));
  const f = await fixture(t, { maxEstimatedUSD: '0.100000' }), session = await f.login(), body = attempt('studio', context);
  assert.equal((await f.approve(session, { ...body, styleId: 'flat_lay' })).status, 400);
  for (const patch of [{ styleId: 'hero' }, { prompt: body.prompt + ' changed' }, { presetVersion: '9' }, { sceneContext: { ...context, category: '其他' } }, { estimatedUSD: studioEstimateUSD() }]) {
    assert.equal((await f.approve(session, { ...body, ...patch })).status, 400);
  }
  const longer = attempt('studio', { ...context, confirmedFacts: ['材质: ' + '木'.repeat(100)] });
  assert.notEqual(longer.estimatedUSD, body.estimatedUSD);
  const guarded = await fixture(t, { maxEstimatedUSD: body.estimatedUSD }), guardedSession = await guarded.login();
  assert.equal((await guarded.approve(guardedSession, longer)).status, 403);
  assert.equal(f.calls.length, 0);
});

test('below-limit consent is bound to one attempt and cannot override the gateway owner guard', async (t) => {
  const f = await fixture(t), session = await f.login();
  const body = { ...attempt(), maxEstimatedUSD: '0.001000' };
  assert.equal((await f.approve(session, body)).status, 400);
  assert.equal((await f.approve(session, { ...body, softLimitOverride: false })).status, 400);
  assert.equal(f.calls.length, 0);
  const approved = { ...body, softLimitOverride: true };
  const id = await approval(f, session, approved);
  const changed = { ...approved, maxEstimatedUSD: '0.002000' };
  assert.equal((await f.generate(session, changed, id)).status, 409);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.generate(session, approved, id)).status, 200);
  assert.equal(f.calls.length, 1);
  assert.equal((await f.generate(session, approved, id)).status, 409);
  const guarded = await fixture(t, { maxEstimatedUSD: '0.001000' }), other = await guarded.login();
  assert.equal((await guarded.approve(other, { ...attempt(), maxEstimatedUSD: '0.001000', softLimitOverride: true })).status, 403);
  assert.equal(guarded.calls.length, 0);
});

test('session estimate boundary requires a separately bound single-attempt override', async (t) => {
  const f = await fixture(t), session = await f.login();
  const body = { ...attempt(), sessionPriorUSD: '0.000001', sessionLimitUSD: attempt().estimatedUSD };
  assert.equal((await f.approve(session, body)).status, 400);
  assert.equal((await f.approve(session, { ...body, sessionLimitOverride: false })).status, 400);
  const approved = { ...body, sessionLimitOverride: true };
  const id = await approval(f, session, approved);
  assert.equal((await f.generate(session, { ...approved, sessionPriorUSD: '0.000002' }, id)).status, 409);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.generate(session, approved, id)).status, 200);
  assert.equal(f.calls.length, 1);
  const equal = { ...attempt(), sessionPriorUSD: '0.000000', sessionLimitUSD: attempt().estimatedUSD };
  assert.equal((await f.approve(session, equal)).status, 201);
  assert.equal((await f.approve(session, { ...equal, sessionLimitOverride: true })).status, 400);
});

test('validated provider usage is returned without untrusted metadata', async (t) => {
  const usage = { input_tokens: 12, output_tokens: 4, total_tokens: 16, input_tokens_details: { text_tokens: 12, image_tokens: 0, secret: fakeKey }, untrusted: fakeKey };
  const f = await fixture(t, { transport: async () => new Response(JSON.stringify({ data: [{ b64_json: image }], usage }), { headers: { 'content-type': 'application/json' } }) });
  const session = await f.login(), body = attempt(), id = await approval(f, session, body);
  const result = await (await f.generate(session, body, id)).json();
  assert.deepEqual(result.usage, { input_tokens: 12, output_tokens: 4, total_tokens: 16, input_tokens_details: { image_tokens: 0, text_tokens: 12 } });
  assert.equal(result.observedUSD, null);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-provider-secret/);
});

test('complete usage yields a snapshot-based calculation, not an invoice', async (t) => {
  const usage = { input_tokens: 12, output_tokens: 4, total_tokens: 16, input_tokens_details: { text_tokens: 10, image_tokens: 2 }, output_tokens_details: { text_tokens: 0, image_tokens: 4 } };
  const f = await fixture(t, { transport: async () => new Response(JSON.stringify({ data: [{ b64_json: image }], usage }), { headers: { 'content-type': 'application/json' } }) });
  const session = await f.login(), body = attempt(), id = await approval(f, session, body);
  const result = await (await f.generate(session, body, id)).json();
  assert.equal(result.observedUSD, '0.000186');
  assert.equal(result.pricingSnapshot, '2026-10-29 Images API USD/1M: text input 5, image input 8, image output 30');
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

test('same attempt while marker exists before reservation and consumed approval replay have unknown outcome', async (t) => {
  const f = await fixture(t), s = await f.login(), body = attempt();
  const a = await approval(f, s, body), b = await approval(f, s, body);
  let resume, entered;
  const paused = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { resume = resolve; });
  let intercept = true;
  await withJournalFaults({
    rmdir: (original) => async (path, ...args) => {
      const result = await original(path, ...args);
      if (path === join(f.journal, '.lock') && intercept) { intercept = false; entered(); await gate; }
      return result;
    }
  }, async () => {
    const first = f.generate(s, body, a);
    try {
      await paused;
      const principal = createHash('sha256').update('studio-local-owner-v1').digest('hex');
      assert.equal(JSON.parse(await readFile(join(f.journal, '.inflight'), 'utf8')).attempt, body.clientAttemptId);
      assert.equal((await readdir(f.journal)).includes(`${principal}-${body.clientAttemptId}`), false);
      const duplicate = await f.generate(s, body, b), error = (await duplicate.json()).error;
      assert.equal(duplicate.status, 409); assert.equal(error.code, 'CONFLICT'); assert.equal(error.outcome, 'UNKNOWN');
      assert.doesNotMatch(error.message, /no request was sent/i);
      assert.equal(f.calls.length, 0);
    } finally { resume(); }
    assert.equal((await first).status, 200);
    const replay = await f.generate(s, body, a), error = (await replay.json()).error;
    assert.equal(replay.status, 409); assert.equal(error.code, 'CONFLICT'); assert.equal(error.outcome, 'UNKNOWN');
    assert.doesNotMatch(error.message, /no request was sent/i);
    assert.equal(f.calls.length, 1);
  });
});

test('pre-dispatch cleanup failure advertises only a durable reviewable failure', async (t) => {
  for (const publishReservation of [true, false]) {
    const f = await fixture(t), s = await f.login(), body = attempt(), id = await approval(f, s, body);
    const principal = createHash('sha256').update('studio-local-owner-v1').digest('hex');
    const base = join(f.journal, `${principal}-${body.clientAttemptId}`);
    let failedMarker = false;
    await withJournalFaults({
      link: (original) => async (source, destination) => {
        if (destination === base) {
          if (!publishReservation) throw Object.assign(new Error('synthetic reservation failure'), { code: 'EIO' });
          const result = await original(source, destination);
          f.advance(5 * 60 * 1000 + 1);
          return result;
        }
        return original(source, destination);
      },
      unlink: (original) => async (path) => {
        if (path === join(f.journal, '.inflight') && !failedMarker) {
          failedMarker = true;
          throw Object.assign(new Error('synthetic marker cleanup failure'), { code: 'EIO' });
        }
        return original(path);
      }
    }, async () => {
      const response = await f.generate(s, body, id), error = (await response.json()).error;
      assert.equal(response.status, 503); assert.equal(error.code, 'RECOVERY_REQUIRED');
      assert.equal(response.headers.get('x-studio-cleanup-pending'), publishReservation ? '1' : null);
      assert.equal(failedMarker, true); assert.equal(f.calls.length, 0);
      if (publishReservation) {
        assert.deepEqual(JSON.parse(await readFile(`${base}.result`, 'utf8')), { outcome: 'DEFINITIVE_FAILURE', format: 2 });
      } else {
        assert.equal((await readdir(f.journal)).includes(`${principal}-${body.clientAttemptId}.result`), false);
      }
    });
    if (publishReservation) {
      const current = await f.login(), receipt = await f.acknowledge(current, body.clientAttemptId);
      assert.equal(receipt.status, 200); assert.equal((await receipt.json()).recordedOutcome, 'DEFINITIVE_FAILURE');
      assert.equal((await readdir(f.journal)).includes('.inflight'), false);
    }
  }
});

test('durable success survives failure to remove the result temporary file', async (t) => {
  const f = await fixture(t), s = await f.login(), body = attempt(), id = await approval(f, s, body);
  const principal = createHash('sha256').update('studio-local-owner-v1').digest('hex');
  const resultPath = join(f.journal, `${principal}-${body.clientAttemptId}.result`);
  let resultTemp, failed = false;
  await withJournalFaults({
    link: (original) => async (source, destination) => {
      const result = await original(source, destination);
      if (destination === resultPath) resultTemp = source;
      return result;
    },
    unlink: (original) => async (path) => {
      if (path === resultTemp && !failed) {
        failed = true;
        throw Object.assign(new Error('synthetic temporary cleanup failure'), { code: 'EIO' });
      }
      return original(path);
    }
  }, async () => {
    const response = await f.generate(s, body, id), result = await response.json();
    assert.equal(failed, true); assert.equal(response.status, 200);
    assert.equal(result.outcome, 'DEFINITIVE_SUCCESS'); assert.equal(result.image.dataBase64, image);
    assert.equal(response.headers.get('x-studio-cleanup-pending'), null);
    assert.deepEqual(JSON.parse(await readFile(resultPath, 'utf8')), { outcome: 'DEFINITIVE_SUCCESS', format: 2 });
    assert.equal(f.calls.length, 1);
  });
});

test('cleanup status sync failure conservatively reports pending despite a published clean record', async (t) => {
  const f = await fixture(t), s = await f.login(), body = attempt(), id = await approval(f, s, body);
  const principal = createHash('sha256').update('studio-local-owner-v1').digest('hex');
  const cleanName = `${principal}-${body.clientAttemptId}.clean`;
  let failNextSync = false, endFailed = false, syncFailed = false;
  await withJournalFaults({
    rmdir: (original) => async (path, ...args) => {
      const shouldFail = path === join(f.journal, '.lock') && !endFailed && (await readdir(f.journal)).includes(cleanName);
      const result = await original(path, ...args);
      if (shouldFail) {
        endFailed = true; failNextSync = true;
        throw Object.assign(new Error('synthetic lock release failure'), { code: 'EIO' });
      }
      return result;
    },
    open: (original) => async (path, ...args) => {
      const fd = await original(path, ...args);
      if (path === f.journal && failNextSync) {
        failNextSync = false;
        fd.sync = async () => { syncFailed = true; throw Object.assign(new Error('synthetic directory sync failure'), { code: 'EIO' }); };
      }
      return fd;
    }
  }, async () => {
    const response = await f.generate(s, body, id), result = await response.json();
    assert.equal(endFailed, true); assert.equal(syncFailed, true);
    assert.equal(response.status, 200); assert.equal(result.image.dataBase64, image);
    assert.equal(response.headers.get('x-studio-cleanup-pending'), '1');
    assert.deepEqual(JSON.parse(await readFile(join(f.journal, cleanName), 'utf8')), { outcome: 'DEFINITIVE_SUCCESS' });
  });
  const receipt = await f.acknowledge(s, body.clientAttemptId);
  assert.equal(receipt.status, 200); assert.equal((await receipt.json()).recordedOutcome, 'DEFINITIVE_SUCCESS');
  assert.equal(f.calls.length, 1);
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
  assert.equal(await store.reserve(principal, body.clientAttemptId, 'b'.repeat(64), 1_800_000_000_000, 10, 0), 'reserved');
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

test('unknown review requires an owned finished attempt and replay cannot clear a newer marker', async (t) => {
  let release, entered, count = 0;
  const begun = new Promise((resolve) => { entered = resolve; });
  const f = await fixture(t, { transport: async () => {
    count++;
    if (count === 1) { entered(); await new Promise((resolve) => { release = resolve; }); }
    return new Response('synthetic malformed result', { status: 200 });
  } });
  const s = await f.login(), first = attempt(), firstApproval = await approval(f, s, first);
  const pending = f.generate(s, first, firstApproval); await begun;
  assert.equal((await f.acknowledge(s, first.clientAttemptId)).status, 409);
  assert.equal((await f.acknowledge(s, randomUUID())).status, 409);
  assert.equal((await f.acknowledge(s, first.clientAttemptId.toUpperCase())).status, 400);
  assert.equal((await f.acknowledge(s, first.clientAttemptId, { acknowledgePossibleCharge: false })).status, 400);
  assert.equal((await f.acknowledge(s, first.clientAttemptId, { acknowledgePossibleCharge: true, extra: true })).status, 400);
  assert.equal((await f.acknowledge({ ...s, csrf: 'invalid' }, first.clientAttemptId)).status, 403);
  assert.equal((await f.acknowledge({ ...s, cookie: s.cookie.split(';')[0] }, first.clientAttemptId)).status, 401);
  release(); assert.equal((await pending).status, 504);
  const receiptResponse = await f.acknowledge(s, first.clientAttemptId);
  assert.equal(receiptResponse.status, 200);
  const receipt = await receiptResponse.json();
  assert.deepEqual(receipt, { clientAttemptId: first.clientAttemptId, recordedOutcome: 'UNKNOWN', acknowledgedAt: new Date(1_800_000_000_000).toISOString() });
  // A lost response is retried without changing its timestamp or sending anything.
  f.advance(1000);
  assert.deepEqual(await (await f.acknowledge(s, first.clientAttemptId)).json(), receipt);
  assert.equal((await f.generate(s, first, await approval(f, s, first))).status, 409);
  const second = attempt();
  assert.equal((await f.generate(s, second, await approval(f, s, second))).status, 504);
  assert.deepEqual(await (await f.acknowledge(s, first.clientAttemptId)).json(), receipt);
  const third = attempt();
  assert.equal((await f.generate(s, third, await approval(f, s, third))).status, 409);
  assert.equal((await f.acknowledge(s, second.clientAttemptId)).status, 200);
  assert.equal(count, 2);
  await f.stop(); await f.start(); const s2 = await f.login();
  assert.deepEqual(await (await f.acknowledge(s2, first.clientAttemptId)).json(), receipt);
  assert.equal((await f.generate(s2, first, await approval(f, s2, first))).status, 409);
});

test('journal refuses missing, foreign and legacy markers; replay cleans only its own interrupted acknowledgement', async (t) => {
  const f = await fixture(t), s = await f.login();
  const principal = createHash('sha256').update('studio-local-owner-v1').digest('hex');
  const store = await createAttemptJournal(f.journal), first = attempt(), name = `${principal}-${first.clientAttemptId}`;
  assert.equal(await store.reserve(principal, first.clientAttemptId, 'b'.repeat(64), 1_800_000_000_000, 10, 0), 'reserved');
  assert.equal((await f.acknowledge(s, first.clientAttemptId)).status, 409);
  await store.finish(principal, first.clientAttemptId, 'UNKNOWN');
  assert.equal((await f.acknowledge(s, first.clientAttemptId)).status, 409);
  await mkdir(join(f.journal, '.inflight'), { mode: 0o700 });
  assert.equal((await f.acknowledge(s, first.clientAttemptId)).status, 409);
  await rm(join(f.journal, '.inflight'), { recursive: true });
  await writeFile(join(f.journal, '.inflight'), JSON.stringify({ principal, attempt: randomUUID() }), { mode: 0o600 });
  assert.equal((await f.acknowledge(s, first.clientAttemptId)).status, 409);
  await unlink(join(f.journal, '.inflight'));
  // Simulate a durable receipt followed by interruption before marker cleanup.
  const receipt = { recordedOutcome: 'UNKNOWN', acknowledgedAt: new Date(1_800_000_000_000).toISOString() };
  await writeFile(join(f.journal, `${name}.ack`), JSON.stringify(receipt), { mode: 0o600 });
  await writeFile(join(f.journal, '.inflight'), JSON.stringify({ principal, attempt: first.clientAttemptId }), { mode: 0o600 });
  assert.deepEqual(await (await f.acknowledge(s, first.clientAttemptId)).json(), { clientAttemptId: first.clientAttemptId, ...receipt });
  assert.equal((await readdir(f.journal)).includes('.inflight'), false);
  assert.deepEqual(JSON.parse(await readFile(join(f.journal, `${name}.result`), 'utf8')), { outcome: 'UNKNOWN', format: 2 });
});

test('definitive acknowledgements preserve unrelated active markers and enforce owner journal evidence', async (t) => {
  const f = await fixture(t), s = await f.login(), principal = createHash('sha256').update('studio-local-owner-v1').digest('hex');
  const store = await createAttemptJournal(f.journal), active = attempt();
  for (const outcome of ['DEFINITIVE_SUCCESS', 'DEFINITIVE_FAILURE']) {
    const old = attempt();
    assert.equal(await store.reserve(principal, old.clientAttemptId, 'c'.repeat(64), 1_800_000_000_000, 10, await store.revision()), 'reserved');
    await store.finish(principal, old.clientAttemptId, outcome);
    await writeFile(join(f.journal, `${principal}-${old.clientAttemptId}.result`), JSON.stringify({ outcome }), { mode: 0o600 });
    if (outcome === 'DEFINITIVE_SUCCESS') assert.equal(await store.begin(principal, active.clientAttemptId), 'begun');
    const response = await f.acknowledge(s, old.clientAttemptId);
    assert.equal(response.status, 200); assert.equal((await response.json()).recordedOutcome, outcome);
    assert.equal(JSON.parse(await readFile(join(f.journal, '.inflight'), 'utf8')).attempt, active.clientAttemptId);
  }
  const foreign = attempt(), otherPrincipal = 'a'.repeat(64);
  assert.equal(await store.reserve(otherPrincipal, foreign.clientAttemptId, 'd'.repeat(64), 1_800_000_000_000, 10, await store.revision()), 'reserved');
  await store.finish(otherPrincipal, foreign.clientAttemptId, 'DEFINITIVE_FAILURE');
  assert.equal((await f.acknowledge(s, foreign.clientAttemptId)).status, 409);
  await store.end(principal, active.clientAttemptId);
});

test('acknowledgement is shared durably across separate processes', async (t) => {
  const f = await fixture(t), s = await f.login(), item = attempt();
  const principal = createHash('sha256').update('studio-local-owner-v1').digest('hex');
  const store = await createAttemptJournal(f.journal);
  assert.equal(await store.begin(principal, item.clientAttemptId), 'begun');
  assert.equal(await store.reserve(principal, item.clientAttemptId, 'e'.repeat(64), 1_800_000_000_000, 10, 0), 'reserved');
  await store.finish(principal, item.clientAttemptId, 'UNKNOWN');
  const script = `import { createAttemptJournal } from ${JSON.stringify(new URL('../studio-journal.mjs', import.meta.url).href)}; const journal = await createAttemptJournal(process.argv[1]); console.log(JSON.stringify(await journal.acknowledge(process.argv[2], process.argv[3], 1800000000000, () => true)));`;
  const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script, f.journal, principal, item.clientAttemptId]);
  const receipt = JSON.parse(stdout);
  assert.deepEqual(await (await f.acknowledge(s, item.clientAttemptId)).json(), { clientAttemptId: item.clientAttemptId, ...receipt });
  assert.equal(await store.begin(principal, item.clientAttemptId), 'duplicate');
});

test('provider 429 returns safe quota-aware metadata without automatically retrying', async (t) => {
  let count = 0;
  const f = await fixture(t, { transport: async () => { count++; return new Response(fakeKey, { status: 429, headers: { 'retry-after': '12' } }); } });
  const s = await f.login(), body = attempt(), response = await f.generate(s, body, await approval(f, s, body));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '12');
  const result = await response.json();
  assert.equal(result.error.code, 'PROVIDER_LIMIT');
  assert.equal(result.error.outcome, 'DEFINITIVE_FAILURE');
  assert.equal(result.error.retryAfterSeconds, 12);
  assert.equal(JSON.stringify(result).includes(fakeKey), false);
  assert.equal((await f.generate(s, body, await approval(f, s, body))).status, 409);
  assert.equal(count, 1);
});

test('gateway enforces provider wait across restart, independent of client history', async (t) => {
  let calls = 0;
  const f = await fixture(t, { transport: async () => { calls++; return new Response('synthetic', { status: 429, headers: { 'retry-after': '60' } }); } });
  let session = await f.login(); const first = attempt();
  const response = await f.generate(session, first, await approval(f, session, first));
  assert.equal(response.status, 429); assert.equal((await response.json()).error.retryAfterSeconds, 60);
  assert.equal((await f.acknowledge(session, first.clientAttemptId)).status, 200);
  await f.stop(); await f.start(); session = await f.login();
  f.advance(59999);
  const early = attempt(); const blocked = await f.generate(session, early, await approval(f, session, early));
  assert.equal(blocked.status, 429); assert.equal((await blocked.json()).error.code, 'RATE_LIMITED'); assert.equal(calls, 1);
  f.advance(1);
  const later = attempt(); const retried = await f.generate(session, later, await approval(f, session, later));
  assert.equal(retried.status, 429); assert.equal((await retried.json()).error.code, 'PROVIDER_LIMIT'); assert.equal(calls, 2);
});

test('malformed durable wait fails closed without a new provider dispatch', async (t) => {
  let calls = 0;
  const f = await fixture(t, { transport: async () => { calls++; return new Response('synthetic', { status: 429, headers: { 'retry-after': '60' } }); } });
  const session = await f.login(), first = attempt();
  assert.equal((await f.generate(session, first, await approval(f, session, first))).status, 429);
  const principal = createHash('sha256').update('studio-local-owner-v1').digest('hex');
  await writeFile(join(f.journal, `${principal}-${first.clientAttemptId}.result`), JSON.stringify({ outcome: 'DEFINITIVE_FAILURE', format: 3, retryNotBefore: '0' }), { mode: 0o600 });
  assert.equal((await f.revision(session)).status, 503);
  assert.equal(calls, 1);
});

test('unrepresentable provider retry delay retains a durable review gate', async (t) => {
  let calls = 0;
  const f = await fixture(t, { transport: async () => { calls++; return new Response('synthetic', { status: 429, headers: { 'retry-after': '86401' } }); } });
  let session = await f.login(); const first = attempt();
  const result = await f.generate(session, first, await approval(f, session, first));
  assert.equal(result.status, 429);
  assert.equal(result.headers.get('x-studio-cleanup-pending'), '1');
  assert.equal((await result.json()).error.outcome, 'DEFINITIVE_FAILURE');
  await f.stop(); await f.start(); session = await f.login();
  const next = attempt();
  const blocked = await f.generate(session, next, await approval(f, session, next));
  assert.equal(blocked.status, 409);
  assert.equal(calls, 1);
  const receipt = await f.acknowledge(session, first.clientAttemptId);
  assert.equal(receipt.status, 200);
  assert.equal((await receipt.json()).recordedOutcome, 'DEFINITIVE_FAILURE');
  assert.equal(calls, 1);
});

test('acknowledgement remains disabled without generation configuration', async (t) => {
  const f = await fixture(t, { disabled: true }), s = await f.login();
  assert.equal((await f.acknowledge(s, randomUUID())).status, 503);
  assert.equal(f.calls.length, 0);
});

test('corrupt or orphan acknowledgement evidence prevents journal recovery', async (t) => {
  const f = await fixture(t), principal = createHash('sha256').update('studio-local-owner-v1').digest('hex'), item = attempt();
  const name = `${principal}-${item.clientAttemptId}`;
  await writeFile(join(f.journal, `${name}.ack`), JSON.stringify({ recordedOutcome: 'UNKNOWN', acknowledgedAt: new Date(1_800_000_000_000).toISOString() }), { mode: 0o600 });
  const s = await f.login();
  assert.equal((await f.acknowledge(s, item.clientAttemptId)).status, 503);
  await f.stop();
  await assert.rejects(() => f.start());
  assert.equal(f.calls.length, 0);
});

test('finish and end wait for another process lock and retain the provider outcome', async (t) => {
  let entered, release;
  const started = new Promise((resolve) => { entered = resolve; });
  const f = await fixture(t, { timeoutMs: 10000, transport: async () => {
    entered();
    await new Promise((resolve) => { release = resolve; });
    return success();
  } });
  const s = await f.login(), body = attempt(), pending = f.generate(s, body, await approval(f, s, body));
  await started;
  const lock = join(f.journal, '.lock');
  await acquireTestLock(lock);
  release();
  await new Promise((resolve) => setTimeout(resolve, 50));
  await rmdir(lock);
  const response = await pending;
  assert.equal(response.status, 200);
  const principal = createHash('sha256').update('studio-local-owner-v1').digest('hex');
  assert.deepEqual(JSON.parse(await readFile(join(f.journal, `${principal}-${body.clientAttemptId}.result`), 'utf8')), { outcome: 'DEFINITIVE_SUCCESS', format: 2 });
  assert.equal((await readdir(f.journal)).includes('.inflight'), false);
});

test('private orphan temporary files are ignored but corrupt published records fail closed', async (t) => {
  const f = await fixture(t), principal = createHash('sha256').update('studio-local-owner-v1').digest('hex'), item = attempt();
  const orphan = `.tmp-${'a'.repeat(32)}`;
  await writeFile(join(f.journal, orphan), '{"partial":', { mode: 0o600 });
  const store = await createAttemptJournal(f.journal);
  assert.equal(await store.revision(), 0);
  assert.equal(await store.reserve(principal, item.clientAttemptId, 'f'.repeat(64), 1_800_000_000_000, 10, 0), 'reserved');
  assert.equal(await readFile(join(f.journal, orphan), 'utf8'), '{"partial":');
  await writeFile(join(f.journal, `${principal}-${item.clientAttemptId}.result`), '{"outcome":', { mode: 0o600 });
  await assert.rejects(() => store.revision());
  await assert.rejects(() => createAttemptJournal(f.journal));
});

test('terminal review cleans only its matching marker and end is safe after another attempt begins', async (t) => {
  const f = await fixture(t), principal = createHash('sha256').update('studio-local-owner-v1').digest('hex');
  const store = await createAttemptJournal(f.journal), first = attempt(), next = attempt();
  assert.equal(await store.begin(principal, first.clientAttemptId), 'begun');
  assert.equal(await store.reserve(principal, first.clientAttemptId, 'b'.repeat(64), 1_800_000_000_000, 10, 0), 'reserved');
  await assert.rejects(() => store.end(principal, first.clientAttemptId));
  await store.finish(principal, first.clientAttemptId, 'DEFINITIVE_SUCCESS');
  await store.finish(principal, first.clientAttemptId, 'DEFINITIVE_SUCCESS');
  await assert.rejects(() => store.finish(principal, first.clientAttemptId, 'UNKNOWN'));
  const receipt = await store.acknowledge(principal, first.clientAttemptId, 1_800_000_000_000, () => true);
  assert.equal(receipt.recordedOutcome, 'DEFINITIVE_SUCCESS');
  assert.equal(await store.begin(principal, next.clientAttemptId), 'begun');
  await store.end(principal, first.clientAttemptId);
  assert.equal(JSON.parse(await readFile(join(f.journal, '.inflight'), 'utf8')).attempt, next.clientAttemptId);
  assert.deepEqual(await store.acknowledge(principal, first.clientAttemptId, 1_800_000_001_000, () => true), receipt);
  assert.equal(await store.revision(), 1);
  await store.end(principal, next.clientAttemptId);
});

test('acknowledgement in another gateway invalidates existing approvals, but replay does not', async (t) => {
  const f = await fixture(t), other = await fixture(t, { journal: f.journal });
  const s = await f.login(), secondSession = await other.login();
  const finished = attempt();
  assert.equal((await other.generate(secondSession, finished, await approval(other, secondSession, finished))).status, 200);
  const candidate = attempt(), old = await approval(f, s, candidate);
  assert.equal((await other.acknowledge(secondSession, finished.clientAttemptId)).status, 200);
  const rejected = await f.generate(s, candidate, old), body = await rejected.json();
  assert.equal(rejected.status, 409);
  assert.equal(body.error.code, 'APPROVAL_STALE');
  assert.equal(body.error.outcome, 'DEFINITIVE_FAILURE');
  assert.equal(f.calls.length, 0);
  const fresh = await approval(f, s, candidate);
  assert.equal((await other.acknowledge(secondSession, finished.clientAttemptId)).status, 200);
  assert.equal((await f.generate(s, candidate, fresh)).status, 200);
  assert.equal(f.calls.length, 1);
});

test('logout while acknowledgement waits for the journal prevents its first mutation', async (t) => {
  const f = await fixture(t), s = await f.login(), body = attempt();
  assert.equal((await f.generate(s, body, await approval(f, s, body))).status, 200);
  const lock = join(f.journal, '.lock');
  await mkdir(lock, { mode: 0o700 });
  const received = new Promise((resolve) => f.server.once('request', (req) => req.once('end', resolve)));
  const pending = f.acknowledge(s, body.clientAttemptId);
  await received;
  const logout = await fetch(f.origin + '/api/v2/auth/logout', { method: 'POST', headers: { Origin: f.origin, Cookie: s.cookie, 'X-CSRF-Token': s.csrf } });
  assert.equal(logout.status, 204);
  await rmdir(lock);
  assert.equal((await pending).status, 401);
  const principal = createHash('sha256').update('studio-local-owner-v1').digest('hex');
  assert.equal((await readdir(f.journal)).includes(`${principal}-${body.clientAttemptId}.ack`), false);
});

test('disconnect while approval waits for revision does not issue approval', async (t) => {
  const f = await fixture(t), s = await f.login(), body = attempt(), lock = join(f.journal, '.lock');
  await mkdir(lock, { mode: 0o700 });
  const received = new Promise((resolve) => f.server.once('request', (req) => req.once('end', resolve)));
  const pending = f.approve(s, body);
  await received;
  const disconnected = await fetch(f.origin + '/api/v2/session', { method: 'DELETE', headers: { Origin: f.origin, Cookie: s.cookie, 'X-CSRF-Token': s.csrf } });
  assert.equal(disconnected.status, 204);
  await rmdir(lock);
  assert.equal((await pending).status, 401);
  assert.equal(f.calls.length, 0);
});

test('a lock that outlives the bounded wait is never removed', async (t) => {
  const f = await fixture(t), store = await createAttemptJournal(f.journal), lock = join(f.journal, '.lock');
  await mkdir(lock, { mode: 0o700 });
  await assert.rejects(() => store.revision(), /Journal locked or unavailable/);
  assert.equal((await readdir(f.journal)).includes('.lock'), true);
  await rmdir(lock);
});

test('revision is authenticated and stale consent cannot obtain an approval', async (t) => {
  const f = await fixture(t), s = await f.login(), finished = attempt(), candidate = attempt();
  assert.equal((await f.revision({ ...s, csrf: 'invalid' })).status, 403);
  assert.equal((await f.revision({ ...s, cookie: s.cookie.split(';')[0] })).status, 401);
  assert.deepEqual(await (await f.revision(s)).json(), { reviewRevision: 0 });
  assert.equal((await f.generate(s, finished, await approval(f, s, finished))).status, 200);
  assert.equal((await f.acknowledge(s, finished.clientAttemptId)).status, 200);
  const stale = await f.approve(s, candidate);
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).error.code, 'APPROVAL_STALE');
  assert.deepEqual(await (await f.revision(s)).json(), { reviewRevision: 1 });
  assert.equal((await f.acknowledge(s, finished.clientAttemptId)).status, 200);
  assert.deepEqual(await (await f.revision(s)).json(), { reviewRevision: 1 });
  assert.equal(f.calls.length, 1);
  for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, null]) assert.equal((await f.approve(s, { ...candidate, reviewRevision: value })).status, 400);
  const missing = { ...candidate }; delete missing.reviewRevision;
  assert.equal((await f.approve(s, missing)).status, 400);
});

test('review and final reservation dispatch serialize under the journal lock', async (t) => {
  const f = await fixture(t), store = await createAttemptJournal(f.journal);
  const principal = createHash('sha256').update('studio-local-owner-v1').digest('hex');
  const old = attempt(), next = attempt();
  assert.equal(await store.reserve(principal, old.clientAttemptId, 'a'.repeat(64), 1_800_000_000_000, 10, 0), 'reserved');
  await store.finish(principal, old.clientAttemptId, 'DEFINITIVE_FAILURE');
  await writeFile(join(f.journal, `${principal}-${old.clientAttemptId}.result`), JSON.stringify({ outcome: 'DEFINITIVE_FAILURE' }), { mode: 0o600 });
  assert.equal(await store.begin(principal, next.clientAttemptId), 'begun');
  let receipt, called = 0, owned = false;
  const result = await store.reserveAndDispatch(principal, next.clientAttemptId, 'b'.repeat(64), 1_800_000_000_000, 10, 0, () => true, () => {
    called++;
    receipt = store.acknowledge(principal, old.clientAttemptId, 1_800_000_000_000, () => true);
  }, () => { owned = true; });
  assert.equal(result, 'submitted'); assert.equal(called, 1); assert.equal(owned, true);
  assert.equal((await receipt).recordedOutcome, 'DEFINITIVE_FAILURE');
  assert.equal(await store.revision(), 1);
  await store.finish(principal, next.clientAttemptId, 'DEFINITIVE_FAILURE');
  await store.end(principal, next.clientAttemptId);
  const later = attempt();
  assert.equal(await store.begin(principal, later.clientAttemptId), 'begun');
  assert.equal(await store.reserveAndDispatch(principal, later.clientAttemptId, 'c'.repeat(64), 1_800_000_000_000, 10, 0, () => true, () => { called++; }, () => {}), 'stale');
  await store.abortBeforeDispatch(principal, later.clientAttemptId, false);
  assert.equal(called, 1);
});

test('known terminal outcomes survive cleanup lock timeout and remain reviewable', async (t) => {
  for (const [status, expectedStatus, outcome] of [[200, 200, 'DEFINITIVE_SUCCESS'], [429, 429, 'DEFINITIVE_FAILURE'], [400, 502, 'DEFINITIVE_FAILURE']]) {
    let entered, release, count = 0;
    const started = new Promise((resolve) => { entered = resolve; });
    const f = await fixture(t, { timeoutMs: 10000, transport: async () => {
      count++; entered(); await new Promise((resolve) => { release = resolve; });
      return status === 200 ? success() : new Response(`synthetic error ${fakeKey}`, { status });
    } });
    const s = await f.login(), body = attempt(), pending = f.generate(s, body, await approval(f, s, body));
    await started;
    const lock = join(f.journal, '.lock');
    await acquireTestLock(lock);
    release();
    const response = await pending, result = await response.json();
    assert.equal(response.status, expectedStatus);
    assert.equal(response.headers.get('x-studio-cleanup-pending'), '1');
    if (status === 200) assert.equal(result.image.dataBase64, image);
    else { assert.equal(result.error.outcome, outcome); assert.doesNotMatch(JSON.stringify(result), /synthetic-provider-secret/); }
    const principal = createHash('sha256').update('studio-local-owner-v1').digest('hex');
    assert.deepEqual(JSON.parse(await readFile(join(f.journal, `${principal}-${body.clientAttemptId}.result`), 'utf8')), { outcome, format: 2 });
    await rmdir(lock);
    const receipt = await f.acknowledge(s, body.clientAttemptId);
    assert.equal(receipt.status, 200);
    assert.deepEqual(await receipt.json(), { clientAttemptId: body.clientAttemptId, recordedOutcome: outcome, acknowledgedAt: new Date(1_800_000_000_000).toISOString() });
    assert.equal((await readdir(f.journal)).includes('.inflight'), false);
    assert.equal(count, 1);
  }
});

test('pre-send failure after marker and reservation publishes failure and cleans only owned marker', async (t) => {
  const f = await fixture(t), store = await createAttemptJournal(f.journal), item = attempt();
  const principal = createHash('sha256').update('studio-local-owner-v1').digest('hex');
  let owned = false, called = 0;
  assert.equal(await store.begin(principal, item.clientAttemptId), 'begun');
  await assert.rejects(() => store.reserveAndDispatch(principal, item.clientAttemptId, 'd'.repeat(64), 1_800_000_000_000, 10, 0, () => { throw new Error('synthetic pre-send failure'); }, () => { called++; }, () => { owned = true; }));
  await store.abortBeforeDispatch(principal, item.clientAttemptId, owned);
  assert.equal(called, 0);
  assert.deepEqual(JSON.parse(await readFile(join(f.journal, `${principal}-${item.clientAttemptId}.result`), 'utf8')), { outcome: 'DEFINITIVE_FAILURE', format: 2 });
  assert.equal((await readdir(f.journal)).includes('.inflight'), false);
  assert.deepEqual(JSON.parse(await readFile(join(f.journal, `${principal}-${item.clientAttemptId}.clean`), 'utf8')), { outcome: 'DEFINITIVE_FAILURE' });
  assert.equal(await store.begin(principal, attempt().clientAttemptId), 'begun');
});

test('pre-send cleanup refuses a replaced marker and preserves foreign evidence', async (t) => {
  const f = await fixture(t), store = await createAttemptJournal(f.journal), item = attempt(), foreign = attempt();
  const principal = createHash('sha256').update('studio-local-owner-v1').digest('hex');
  assert.equal(await store.begin(principal, item.clientAttemptId), 'begun');
  await unlink(join(f.journal, '.inflight'));
  const evidence = { principal, attempt: foreign.clientAttemptId };
  await writeFile(join(f.journal, '.inflight'), JSON.stringify(evidence), { mode: 0o600 });
  await assert.rejects(() => store.reserveAndDispatch(principal, item.clientAttemptId, 'f'.repeat(64), 1_800_000_000_000, 10, 0, () => true, () => { throw new Error('must not dispatch'); }, () => {}), /marker/);
  await assert.rejects(() => store.abortBeforeDispatch(principal, item.clientAttemptId, false), /manual recovery/);
  assert.deepEqual(JSON.parse(await readFile(join(f.journal, '.inflight'), 'utf8')), evidence);
});

test('interrupted definitive cleanup blocks globally across restart until authenticated review', async (t) => {
  const f = await fixture(t), s = await f.login(), first = attempt();
  const response = await f.generate(s, first, await approval(f, s, first));
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.outcome, 'DEFINITIVE_SUCCESS');
  assert.equal(result.image.dataBase64, image);
  assert.deepEqual(first.sourceAssetHashes, ['a'.repeat(64)]);
  const principal = createHash('sha256').update('studio-local-owner-v1').digest('hex');
  const base = `${principal}-${first.clientAttemptId}`;
  const durableResult = await readFile(join(f.journal, `${base}.result`), 'utf8');
  assert.deepEqual(JSON.parse(durableResult), { outcome: 'DEFINITIVE_SUCCESS', format: 2 });
  assert.deepEqual(JSON.parse(await readFile(join(f.journal, `${base}.clean`), 'utf8')), { outcome: 'DEFINITIVE_SUCCESS' });
  assert.equal((await readdir(f.journal)).includes('.inflight'), false);
  // Model interruption after unlink and directory sync, before clean publication.
  await unlink(join(f.journal, `${base}.clean`));
  await f.stop(); await f.start();
  const s2 = await f.login(), next = attempt();
  const blocked = await f.generate(s2, next, await approval(f, s2, next));
  assert.equal(blocked.status, 409);
  assert.deepEqual([(await blocked.json()).error.code, f.calls.length], ['ATTEMPT_BUSY', 1]);
  assert.equal((await f.acknowledge({ ...s2, csrf: 'invalid' }, first.clientAttemptId)).status, 403);
  const receipt = await f.acknowledge(s2, first.clientAttemptId);
  assert.equal(receipt.status, 200);
  assert.equal((await receipt.json()).recordedOutcome, 'DEFINITIVE_SUCCESS');
  assert.equal(await readFile(join(f.journal, `${base}.result`), 'utf8'), durableResult);
  assert.equal((await f.generate(s2, next, await approval(f, s2, next))).status, 200);
  assert.equal(f.calls.length, 2);
});

test('clean publication survives restart and duplicate UUID never claims a definitive failure', async (t) => {
  const f = await fixture(t), s = await f.login(), first = attempt();
  assert.equal((await f.generate(s, first, await approval(f, s, first))).status, 200);
  await f.stop(); await f.start();
  const s2 = await f.login();
  const duplicate = await f.generate(s2, first, await approval(f, s2, first));
  assert.equal(duplicate.status, 409);
  const error = (await duplicate.json()).error;
  assert.equal(error.code, 'CONFLICT'); assert.equal(error.outcome, 'UNKNOWN');
  assert.equal(f.calls.length, 1);
  const next = attempt();
  assert.equal((await f.generate(s2, next, await approval(f, s2, next))).status, 200);
  assert.equal(f.calls.length, 2);
});

test('orphan, malformed and mismatched clean records fail closed without deleting evidence', async (t) => {
  for (const kind of ['orphan', 'malformed', 'mismatch']) {
    const f = await fixture(t), principal = createHash('sha256').update('studio-local-owner-v1').digest('hex'), item = attempt();
    const store = await createAttemptJournal(f.journal), base = `${principal}-${item.clientAttemptId}`;
    if (kind !== 'orphan') {
      assert.equal(await store.reserve(principal, item.clientAttemptId, 'a'.repeat(64), 1_800_000_000_000, 10, 0), 'reserved');
      await store.finish(principal, item.clientAttemptId, 'DEFINITIVE_SUCCESS');
    }
    const evidence = kind === 'malformed' ? '{"outcome":' : JSON.stringify({ outcome: kind === 'mismatch' ? 'DEFINITIVE_FAILURE' : 'DEFINITIVE_SUCCESS' });
    await writeFile(join(f.journal, `${base}.clean`), evidence, { mode: 0o600 });
    await assert.rejects(() => store.revision());
    await f.stop(); await assert.rejects(() => f.start());
    assert.equal(await readFile(join(f.journal, `${base}.clean`), 'utf8'), evidence);
  }
});

test('review of markerless pending definitive result preserves another attempt marker', async (t) => {
  const f = await fixture(t), s = await f.login(), principal = createHash('sha256').update('studio-local-owner-v1').digest('hex');
  const store = await createAttemptJournal(f.journal), first = attempt(), other = attempt();
  assert.equal(await store.begin(principal, first.clientAttemptId), 'begun');
  assert.equal(await store.reserve(principal, first.clientAttemptId, 'b'.repeat(64), 1_800_000_000_000, 10, 0), 'reserved');
  await store.finish(principal, first.clientAttemptId, 'DEFINITIVE_SUCCESS');
  await unlink(join(f.journal, '.inflight'));
  const marker = { principal, attempt: other.clientAttemptId };
  await writeFile(join(f.journal, '.inflight'), JSON.stringify(marker), { mode: 0o600 });
  const receipt = await f.acknowledge(s, first.clientAttemptId);
  assert.equal(receipt.status, 200);
  assert.equal((await receipt.json()).recordedOutcome, 'DEFINITIVE_SUCCESS');
  assert.deepEqual(JSON.parse(await readFile(join(f.journal, '.inflight'), 'utf8')), marker);
  assert.equal(await store.begin(principal, attempt().clientAttemptId), 'busy');
});
