import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, readdir, lstat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STUDIO_PROMPT, STUDIO_MODEL, STUDIO_QUALITY, STUDIO_SIZE, STUDIO_PROMPT_VERSION, STUDIO_PRICING_SNAPSHOT, studioEstimateUSD, studioObservedUSD } from './studio-policy.mjs';
import { createAttemptJournal } from './studio-journal.mjs';
import { generateStudioScene } from './studio-provider.mjs';

const API = '/api/v2';
const APP_TTL = 8 * 60 * 60 * 1000;
const PROVIDER_TTL = 60 * 60 * 1000;
const LOGIN_WINDOW = 15 * 60 * 1000;
const CONNECT_WINDOW = 10 * 60 * 1000;
const MAX_CONNECTS = 20;
const MAX_FAILURES = 5;
const MAX_SESSIONS = 128;
const MAX_BODY = 4096;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

function digest(value) { return createHash('sha256').update(value).digest('hex'); }
function token() { return randomBytes(32).toString('base64url'); }
function equal(left, right) {
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
function cookie(name, value, expired = false) {
  return `${name}=${value}; Path=/api; HttpOnly; Secure; SameSite=Strict${expired ? '; Max-Age=0' : ''}`;
}
function readCookie(request, name) {
  const pairs = (request.headers.cookie ?? '').split(';').map((part) => part.trim().split('='));
  const matches = pairs.filter(([key]) => key === name);
  return matches.length === 1 && matches[0].length === 2 && TOKEN.test(matches[0][1]) ? matches[0][1] : null;
}
function json(response, status, value, headers = {}) {
  response.writeHead(status, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8', ...headers });
  response.end(JSON.stringify(value));
}
function error(response, status, code, message, outcome = 'DEFINITIVE_FAILURE', retryAfterSeconds = null) {
  json(response, status, { error: { code, message, retryable: false, requestId: randomBytes(16).toString('hex'), outcome, retryAfterSeconds } }, retryAfterSeconds === null ? {} : { 'Retry-After': String(retryAfterSeconds) });
}
function empty(response, headers = {}) {
  response.writeHead(204, { 'Cache-Control': 'no-store', ...headers });
  response.end();
}

async function readJson(request) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '')) throw new Error('type');
  const length = request.headers['content-length'];
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY)) throw new Error('size');
  const chunks = []; let total = 0;
  await new Promise((resolve, reject) => {
    let settled = false;
    request.on('data', (chunk) => {
      if (settled) return;
      total += chunk.length;
      if (total > MAX_BODY) { settled = true; chunks.length = 0; reject(new Error('size')); return; }
      chunks.push(chunk);
    });
    request.on('end', () => { if (!settled) { settled = true; resolve(); } });
    request.on('error', () => { if (!settled) { settled = true; reject(new Error('stream')); } });
    request.on('aborted', () => { if (!settled) { settled = true; reject(new Error('stream')); } });
  });
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('shape');
    return value;
  } catch { throw new Error('json'); }
}

async function staticFiles(directory) {
  const files = new Map();
  async function visit(folder, relative = '') {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name), name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error('The static build must not contain symbolic links.');
      if (entry.isDirectory()) await visit(path, name);
      else if (entry.isFile()) files.set(`/${name}`, path);
    }
  }
  await visit(directory);
  if (!files.has('/index.html')) throw new Error('Build the application before starting the gateway.');
  return files;
}
function money(value) {
  if (typeof value !== 'string' || !/^\d{1,9}\.\d{1,6}$/.test(value)) return null;
  const [whole, fraction] = value.split('.');
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
}
function validAttempt(body) {
  const required = ['clientAttemptId', 'productId', 'styleId', 'lockMode', 'operation', 'model', 'quality', 'size', 'prompt', 'promptVersion', 'sourceAssetHashes', 'estimatedUSD', 'outputFormat', 'reviewRevision'];
  if (Object.keys(body).some((key) => !required.includes(key) && !['maxEstimatedUSD', 'softLimitOverride', 'sessionPriorUSD', 'sessionLimitUSD', 'sessionLimitOverride'].includes(key)) || required.some((key) => !Object.hasOwn(body, key))) return false;
  return typeof body.clientAttemptId === 'string' && UUID.test(body.clientAttemptId) && body.clientAttemptId === body.clientAttemptId.toLowerCase()
    && typeof body.productId === 'string' && UUID.test(body.productId) && body.productId === body.productId.toLowerCase()
    && body.styleId === 'studio' && body.lockMode === 'STRICT' && body.operation === 'generate_scene'
    && body.model === STUDIO_MODEL && body.quality === STUDIO_QUALITY && body.size === STUDIO_SIZE
    && body.prompt === STUDIO_PROMPT && body.promptVersion === STUDIO_PROMPT_VERSION && body.outputFormat === 'png'
    && Array.isArray(body.sourceAssetHashes) && body.sourceAssetHashes.length === 1 && typeof body.sourceAssetHashes[0] === 'string' && /^[a-f0-9]{64}$/.test(body.sourceAssetHashes[0])
    && body.estimatedUSD === studioEstimateUSD() && Number.isSafeInteger(body.reviewRevision) && body.reviewRevision >= 0
    && (!Object.hasOwn(body, 'maxEstimatedUSD') ? !Object.hasOwn(body, 'softLimitOverride')
      : money(body.maxEstimatedUSD) !== null && (money(body.maxEstimatedUSD) < money(studioEstimateUSD()) ? body.softLimitOverride === true : !Object.hasOwn(body, 'softLimitOverride')))
    && (!Object.hasOwn(body, 'sessionPriorUSD') ? !Object.hasOwn(body, 'sessionLimitUSD') && !Object.hasOwn(body, 'sessionLimitOverride')
      : money(body.sessionPriorUSD) !== null && (!Object.hasOwn(body, 'sessionLimitUSD') ? !Object.hasOwn(body, 'sessionLimitOverride')
        : money(body.sessionLimitUSD) !== null && (money(body.sessionPriorUSD) + money(studioEstimateUSD()) > money(body.sessionLimitUSD) ? body.sessionLimitOverride === true : !Object.hasOwn(body, 'sessionLimitOverride'))));
}
function attemptDigest(body) {
  return digest(JSON.stringify([body.clientAttemptId, body.productId, body.styleId, body.lockMode, body.operation, body.model, body.quality, body.size, body.prompt, body.promptVersion, body.sourceAssetHashes, body.estimatedUSD, Object.hasOwn(body, 'maxEstimatedUSD') ? body.maxEstimatedUSD : null, body.softLimitOverride === true, body.sessionPriorUSD ?? null, body.sessionLimitUSD ?? null, body.sessionLimitOverride === true, body.outputFormat, body.reviewRevision]));
}


// The caller supplies a SHA-256 digest of a random, high-entropy login token; it is not a password hash.
// This loopback-only process is not a reviewed production identity system.
export async function createGateway({ authTokenHash, providerConfigured, staticDirectory, now = Date.now, imageGeneration = null }) {
  if (!/^[a-f0-9]{64}$/.test(authTokenHash ?? '')) throw new Error('A valid owner access-token digest is required.');
  if (typeof providerConfigured !== 'boolean') throw new Error('Provider configuration status is required.');
  const files = await staticFiles(resolve(staticDirectory));
  let journal = null, imageConfig = null;
  if (imageGeneration?.enabled === true) {
    const { apiKey, journalDirectory, transport = fetch, timeoutMs = 120_000, maxEstimatedUSD = '0.010000', maxAttemptsPerHour = 10 } = imageGeneration;
    if (!providerConfigured || typeof apiKey !== 'string' || !apiKey || typeof transport !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000 || money(maxEstimatedUSD) === null || !Number.isInteger(maxAttemptsPerHour) || maxAttemptsPerHour < 1 || maxAttemptsPerHour > 100) throw new Error('Invalid image generation configuration.');
    journal = await createAttemptJournal(journalDirectory);
    imageConfig = { apiKey, transport, timeoutMs, maxEstimatedUSD, maxAttemptsPerHour };
  }
  // This gateway has exactly one local owner; token rotation must not reset
  // the journal's replay protection or hourly reservation history.
  const principal = digest('studio-local-owner-v1'), approvals = new Map();
  const sessions = new Map(), providers = new Map();
  let failures = 0, failureWindow = 0, authEpoch = 0;

  function revoke(sessionId) {
    sessions.delete(sessionId);
    for (const [id, provider] of providers) if (provider.owner === sessionId) providers.delete(id);
  }
  function clean() {
    const time = now();
    for (const [id, session] of sessions) if (session.expires <= time) revoke(id);
    for (const [id, provider] of providers) if (provider.expires <= time || !sessions.has(provider.owner)) providers.delete(id);
    for (const [id, approval] of approvals) if (approval.expires <= time || !sessions.has(approval.sessionId) || !providers.has(approval.providerId)) approvals.delete(id);
    if (time - failureWindow >= LOGIN_WINDOW) { failures = 0; failureWindow = time; }
  }
  function appSession(request) {
    const value = readCookie(request, 'app_session');
    const id = value && digest(value), session = id && sessions.get(id);
    return session ? { id, ...session } : null;
  }
  function providerSession(request, session) {
    const value = readCookie(request, 'provider_session');
    const id = value && digest(value), provider = id && providers.get(id);
    return provider?.owner === session.id ? provider : null;
  }
  function safeOrigin(request, origin) {
    const site = request.headers['sec-fetch-site'];
    return request.headers.origin === origin && (!site || site === 'same-origin');
  }
  function validCsrf(request, session) {
    const value = request.headers['x-csrf-token'];
    return typeof value === 'string' && TOKEN.test(value) && equal(value, session.csrf);
  }

  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const address = server.address();
    const expectedHost = address && typeof address === 'object' ? `127.0.0.1:${address.port}` : '';
    if (request.headers.host !== expectedHost) return error(response, 403, 'FORBIDDEN', 'Request origin is not allowed.');
    const origin = `http://${expectedHost}`;
    const path = request.url;
    const length = request.headers['content-length'];
    if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY)) return error(response, 413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.');
    const acknowledgementPath = /^\/api\/v2\/images\/attempts\/([^/]*)\/acknowledgement$/.exec(path ?? '');
    const expectsBody = request.method === 'POST' && (path === `${API}/auth/login` || path === `${API}/session/connect` || path === `${API}/images/approvals` || path === `${API}/images/generate` || acknowledgementPath);
    if (!expectsBody && ((length && Number(length) > 0) || request.headers['transfer-encoding'])) return error(response, 400, 'INVALID_INPUT', 'Request body is not allowed.');
    clean();
    try {
      if (path === `${API}/health` && request.method === 'GET') return json(response, 200, { status: 'ready' });
      if (path?.startsWith('/api/')) {
        if (request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin') return error(response, 403, 'FORBIDDEN', 'Request origin is not allowed.');
        if (request.method !== 'GET' && !safeOrigin(request, origin)) return error(response, 403, 'FORBIDDEN', 'Request origin is not allowed.');
        if (path === `${API}/auth/login` && request.method === 'POST') {
          if (request.headers['x-studio-request'] !== 'login') return error(response, 403, 'FORBIDDEN', 'Request is not allowed.');
          if (failures >= MAX_FAILURES) return error(response, 429, 'RATE_LIMITED', 'Too many login attempts. Try again later.');
          failures++;
          const epoch = authEpoch;
          let body;
          try { body = await readJson(request); }
          catch (reason) { const oversized = reason.message === 'size'; return error(response, oversized ? 413 : 400, oversized ? 'PAYLOAD_TOO_LARGE' : 'INVALID_INPUT', 'Invalid request.'); }
          if (authEpoch !== epoch) return error(response, 409, 'CONFLICT', 'Authentication changed. Try again.');
          if (Object.keys(body).length !== 1 || typeof body.token !== 'string' || !TOKEN.test(body.token) || !equal(digest(body.token), authTokenHash)) {
            return error(response, 401, 'UNAUTHENTICATED', 'Authentication failed.');
          }
          if (sessions.size >= MAX_SESSIONS) return error(response, 503, 'UNAVAILABLE', 'Too many active sessions.');
          const previous = appSession(request); if (previous) revoke(previous.id);
          const raw = token(), id = digest(raw), csrf = token();
          sessions.set(id, { csrf, expires: now() + APP_TTL, connectWindow: now(), connects: 0, providerEpoch: 0 });
          failures = 0;
          return json(response, 200, { authenticated: true, csrfToken: csrf }, { 'Set-Cookie': [cookie('app_session', raw), cookie('provider_session', '', true)] });
        }
        const session = appSession(request);
        if (!session) return error(response, 401, 'UNAUTHENTICATED', 'Authentication required.');
        if (path === `${API}/auth/session` && request.method === 'GET') return json(response, 200, { authenticated: true, csrfToken: session.csrf });
        if (request.method !== 'GET' && !validCsrf(request, session)) return error(response, 403, 'FORBIDDEN', 'Request authorization failed.');
        if (path === `${API}/auth/logout` && request.method === 'POST') {
          authEpoch++;
          revoke(session.id);
          return empty(response, { 'Set-Cookie': [cookie('app_session', '', true), cookie('provider_session', '', true)] });
        }
        if (path === `${API}/session/status` && request.method === 'GET') {
          const active = providerSession(request, session);
          return json(response, 200, { connected: Boolean(active), configured: providerConfigured, provider: 'openai', expiresAt: active ? new Date(active.expires).toISOString() : null });
        }
        if (path === `${API}/session/connect` && request.method === 'POST') {
          const current = sessions.get(session.id);
          const epoch = current.providerEpoch;
          if (now() - current.connectWindow >= CONNECT_WINDOW) { current.connectWindow = now(); current.connects = 0; }
          if (current.connects >= MAX_CONNECTS) return error(response, 429, 'RATE_LIMITED', 'Too many connection attempts. Try again later.');
          current.connects++;
          if (!UUID.test(request.headers['x-client-request-id'] ?? '')) return error(response, 400, 'INVALID_INPUT', 'Invalid request.');
          let body;
          try { body = await readJson(request); }
          catch (reason) { const oversized = reason.message === 'size'; return error(response, oversized ? 413 : 400, oversized ? 'PAYLOAD_TOO_LARGE' : 'INVALID_INPUT', 'Invalid request.'); }
          if (sessions.get(session.id) !== current || current.expires <= now()) return error(response, 401, 'UNAUTHENTICATED', 'Authentication required.');
          if (current.providerEpoch !== epoch) return error(response, 409, 'CONFLICT', 'Provider authorization changed. Try again.');
          if (Object.keys(body).length !== 1 || body.provider !== 'openai') return error(response, 400, 'INVALID_INPUT', 'Unsupported provider or request.');
          if (!providerConfigured) return error(response, 503, 'UNAVAILABLE', 'Provider is not configured.');
          current.providerEpoch++;
          for (const [id, existing] of providers) if (existing.owner === session.id) providers.delete(id);
          const raw = token(), expires = now() + PROVIDER_TTL;
          providers.set(digest(raw), { owner: session.id, expires });
          return json(response, 201, { connected: true, configured: true, provider: 'openai', expiresAt: new Date(expires).toISOString() }, { 'Set-Cookie': cookie('provider_session', raw) });
        }
        if (path === `${API}/session` && request.method === 'DELETE') {
          sessions.get(session.id).providerEpoch++;
          for (const [id, existing] of providers) if (existing.owner === session.id) providers.delete(id);
          return empty(response, { 'Set-Cookie': cookie('provider_session', '', true) });
        }
        if (path === `${API}/images/revision` && request.method === 'GET') {
          if (!journal || !imageConfig) return error(response, 503, 'UNAVAILABLE', 'Billable image generation is not enabled.');
          if (!validCsrf(request, session)) return error(response, 403, 'FORBIDDEN', 'Request authorization failed.');
          const current = sessions.get(session.id), provider = providerSession(request, session);
          const providerValue = readCookie(request, 'provider_session'), providerId = providerValue && digest(providerValue);
          if (!provider) return error(response, 401, 'UNAUTHENTICATED', 'Provider authorization required.');
          let reviewRevision;
          try { reviewRevision = await journal.revision(); }
          catch { return error(response, 503, 'UNAVAILABLE', 'The attempt journal is unavailable.'); }
          if (sessions.get(session.id) !== current || current.expires <= now() || providers.get(providerId) !== provider || provider.expires <= now()) return error(response, 401, 'UNAUTHENTICATED', 'Authorization expired or was revoked.');
          return json(response, 200, { reviewRevision });
        }
        if (acknowledgementPath && request.method === 'POST') {
          if (!journal || !imageConfig) return error(response, 503, 'UNAVAILABLE', 'Billable image generation is not enabled.');
          const current = sessions.get(session.id), provider = providerSession(request, session);
          const providerValue = readCookie(request, 'provider_session'), providerId = providerValue && digest(providerValue);
          if (!provider) return error(response, 401, 'UNAUTHENTICATED', 'Provider authorization required.');
          const attemptId = acknowledgementPath[1];
          if (!UUID.test(attemptId) || attemptId !== attemptId.toLowerCase()) return error(response, 400, 'INVALID_INPUT', 'Invalid attempt identifier.');
          let body;
          try { body = await readJson(request); }
          catch (reason) { const oversized = reason.message === 'size'; return error(response, oversized ? 413 : 400, oversized ? 'PAYLOAD_TOO_LARGE' : 'INVALID_INPUT', 'Invalid request.'); }
          const active = () => sessions.get(session.id) === current && current.expires > now() && providers.get(providerId) === provider && provider.expires > now();
          if (!active()) return error(response, 401, 'UNAUTHENTICATED', 'Authorization expired or was revoked.');
          if (Object.keys(body).length !== 1 || body.acknowledgePossibleCharge !== true) return error(response, 400, 'INVALID_INPUT', 'Explicit acknowledgement is required.');
          let receipt;
          try { receipt = await journal.acknowledge(principal, attemptId, now(), active); }
          catch {
            if (!active()) return error(response, 401, 'UNAUTHENTICATED', 'Authorization expired or was revoked.');
            return error(response, 503, 'UNAVAILABLE', 'The attempt journal is unavailable; acknowledgement can be replayed.');
          }
          if (!receipt) return error(response, 409, 'CONFLICT', 'This attempt cannot be reviewed safely.');
          return json(response, 200, { clientAttemptId: attemptId, ...receipt });
        }
        if ((path === `${API}/images/approvals` || path === `${API}/images/generate`) && request.method === 'POST') {
          if (!journal || !imageConfig) return error(response, 503, 'UNAVAILABLE', 'Billable image generation is not enabled.');
          const current = sessions.get(session.id), provider = providerSession(request, session);
          const providerValue = readCookie(request, 'provider_session'), providerId = providerValue && digest(providerValue);
          if (!provider) return error(response, 401, 'UNAUTHENTICATED', 'Provider authorization required.');
          let body;
          try { body = await readJson(request); }
          catch (reason) { const oversized = reason.message === 'size'; return error(response, oversized ? 413 : 400, oversized ? 'PAYLOAD_TOO_LARGE' : 'INVALID_INPUT', 'Invalid request.'); }
          const active = () => sessions.get(session.id) === current && current.expires > now() && providers.get(providerId) === provider && provider.expires > now();
          if (!active()) return error(response, 401, 'UNAUTHENTICATED', 'Authorization expired or was revoked.');
          if (!validAttempt(body)) return error(response, 400, 'INVALID_INPUT', 'Invalid Studio attempt or estimate.');
          if (money(studioEstimateUSD()) > money(imageConfig.maxEstimatedUSD)) return error(response, 403, 'FORBIDDEN', 'The estimate exceeds the configured estimate guard.');
          const bodyDigest = attemptDigest(body);
          if (path === `${API}/images/approvals`) {
            if (approvals.size >= 128) return error(response, 429, 'RATE_LIMITED', 'Too many pending approvals.');
            let revision;
            try { revision = await journal.revision(); }
            catch { return error(response, 503, 'UNAVAILABLE', 'The attempt journal is unavailable; no approval was issued.'); }
            if (!active()) return error(response, 401, 'UNAUTHENTICATED', 'Authorization expired or was revoked.');
            if (revision !== body.reviewRevision) return error(response, 409, 'APPROVAL_STALE', 'Review occurred after consent; new consent and approval are required before sending.');
            const id = randomUUID(), expires = Math.min(now() + 5 * 60 * 1000, current.expires, provider.expires);
            approvals.set(id, { sessionId: session.id, providerId, bodyDigest, expires, revision });
            return json(response, 201, { approvalId: id, expiresAt: new Date(expires).toISOString() });
          }
          const approvalId = request.headers['x-attempt-approval'], requestId = request.headers['x-client-request-id'];
          if (requestId !== body.clientAttemptId) return error(response, 400, 'INVALID_INPUT', 'Invalid attempt identifiers.');
          const approval = typeof approvalId === 'string' && UUID.test(approvalId) ? approvals.get(approvalId) : null;
          if (!approval || approval.sessionId !== session.id || approval.providerId !== providerId || approval.expires <= now() || approval.bodyDigest !== bodyDigest) return error(response, 409, 'CONFLICT', 'Approval is invalid, expired or does not match this attempt; its original outcome is unknown.', 'UNKNOWN');
          approvals.delete(approvalId);
          let begun;
          try { begun = await journal.begin(principal, body.clientAttemptId); }
          catch (reason) { return error(response, 503, reason.message.includes('manual recovery') ? 'RECOVERY_REQUIRED' : 'UNAVAILABLE', reason.message.includes('manual recovery') ? 'No request was sent; an in-flight marker may require manual recovery.' : 'The attempt journal is unavailable; no request was sent.'); }
          if (begun === 'duplicate') return error(response, 409, 'CONFLICT', 'This attempt was already started; its original outcome is not known from this response.', 'UNKNOWN');
          if (begun === 'busy') return error(response, 409, 'ATTEMPT_BUSY', 'Another attempt is active or requires owner review.');
          let submitted = false, reserved = false, providerPromise, reply, retainInflight = false;
          try {
            const reservation = await journal.reserveAndDispatch(principal, body.clientAttemptId, bodyDigest, now(), imageConfig.maxAttemptsPerHour, approval.revision, () => active() && approval.expires > now(), () => {
              submitted = true;
              providerPromise = generateStudioScene(imageConfig);
            }, () => { reserved = true; });
            if (reservation === 'stale') reply = { status: 409, code: 'APPROVAL_STALE', message: 'Review occurred after consent; new consent and approval are required before sending.' };
            else if (reservation === 'duplicate') reply = { status: 409, code: 'CONFLICT', message: 'This attempt was already reserved; its original outcome is not known from this response.', outcome: 'UNKNOWN' };
            else if (reservation === 'rate') reply = { status: 429, code: 'RATE_LIMITED', message: 'The hourly attempt limit was reached.' };
            else if (reservation === 'unauthorized') reply = { status: 401, code: 'UNAUTHENTICATED', message: 'Authorization expired or was revoked before submission.' };
          } catch {
            if (!submitted) reply = { status: 503, code: 'UNAVAILABLE', message: 'The attempt journal is unavailable; no request was sent.' };
          }
          if (submitted) {
            try {
              const result = await providerPromise;
              if (!result || !['DEFINITIVE_SUCCESS', 'DEFINITIVE_FAILURE', 'UNKNOWN'].includes(result.outcome)) throw new Error('Invalid provider outcome');
              if (result.outcome === 'UNKNOWN') retainInflight = true;
              try { await journal.finish(principal, body.clientAttemptId, result.outcome); }
              catch { retainInflight = true; }
              if (retainInflight) reply = { status: 504, code: 'UPSTREAM_UNKNOWN', message: 'The attempt may have been charged; its outcome requires review. Do not retry automatically.', outcome: 'UNKNOWN' };
              else if (result.outcome === 'DEFINITIVE_FAILURE' && result.errorCode === 'PROVIDER_LIMIT') {
                const retryAfterSeconds = Number.isInteger(result.retryAfterSeconds) && result.retryAfterSeconds >= 0 && result.retryAfterSeconds <= 86400 ? result.retryAfterSeconds : null;
                reply = { status: 429, code: 'PROVIDER_LIMIT', message: 'Provider returned 429; check rate limits, quota and billing.', retryAfterSeconds };
              }
              else if (result.outcome === 'DEFINITIVE_FAILURE') reply = { status: 502, code: 'PROVIDER_ERROR', message: 'The provider rejected the attempt.' };
              else {
                const observedUSD = studioObservedUSD(result.usage);
                reply = { status: 200, value: { clientAttemptId: body.clientAttemptId, outcome: 'DEFINITIVE_SUCCESS', model: STUDIO_MODEL, image: { mimeType: 'image/png', dataBase64: result.image, width: 1024, height: 1024 }, usage: result.usage, observedUSD, ...(observedUSD === null ? {} : { pricingSnapshot: STUDIO_PRICING_SNAPSHOT }), providerRequestId: null } };
              }
            } catch { retainInflight = true; reply = { status: 504, code: 'UPSTREAM_UNKNOWN', message: 'The attempt may have been charged; its outcome requires review. Do not retry automatically.', outcome: 'UNKNOWN' }; }
          }
          if (!submitted) {
            try { await journal.abortBeforeDispatch(principal, body.clientAttemptId, reserved); }
            catch {
              if (reply?.outcome !== 'UNKNOWN') {
                let pending = false;
                try { pending = await journal.hasPendingFailure(principal, body.clientAttemptId); } catch {}
                if (pending) response.setHeader('X-Studio-Cleanup-Pending', '1');
                reply = { status: 503, code: 'RECOVERY_REQUIRED', message: 'No request was sent; journal evidence may require manual recovery.' };
              }
            }
          } else if (!retainInflight) {
            // The immutable result is durable even if marker cleanup meets a stale lock.
            try { await journal.end(principal, body.clientAttemptId); }
            catch {
              let resolved = false;
              try { resolved = await journal.cleanupResolved(principal, body.clientAttemptId); } catch {}
              if (!resolved) response.setHeader('X-Studio-Cleanup-Pending', '1');
            }
          }
          if (reply.status === 200) return json(response, 200, reply.value);
          return error(response, reply.status, reply.code, reply.message, reply.outcome, reply.retryAfterSeconds ?? null);
        }
        return error(response, 404, 'NOT_FOUND', 'Endpoint not found.');
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') return error(response, 404, 'NOT_FOUND', 'Resource not found.');
      const pathname = path?.split('?')[0] ?? '';
      const route = /^\/(?:|settings|help|import|products\/(?:new|[0-9a-f-]{36}))$/i.test(pathname);
      const publicAsset = /^\/(?:index\.html|sw\.js|manifest\.webmanifest|icons\/icon(?:\.svg|-(?:180|192|512)\.png)|assets\/[A-Za-z0-9_-]+\.(?:js|css))$/.test(pathname);
      const filename = (publicAsset ? files.get(pathname) : null) ?? (route ? files.get('/index.html') : null);
      if (!filename || !(await lstat(filename)).isFile()) return error(response, 404, 'NOT_FOUND', 'Resource not found.');
      const content = await readFile(filename);
      response.writeHead(200, { 'Content-Type': TYPES[extname(filename)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache', 'Content-Length': content.length });
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch {
      if (!response.headersSent) error(response, 500, 'INTERNAL_ERROR', 'The request could not be completed.');
      else response.destroy();
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.maxConnections = 128;
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.STUDIO_PORT ?? '4173');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid local gateway port.');
  const imageGeneration = process.env.STUDIO_ENABLE_BILLABLE_IMAGES === '1' ? {
    enabled: true, apiKey: process.env.OPENAI_API_KEY, journalDirectory: process.env.STUDIO_ATTEMPT_JOURNAL_DIRECTORY,
    maxEstimatedUSD: process.env.STUDIO_MAX_ESTIMATED_USD ?? '0.010000',
    maxAttemptsPerHour: Number(process.env.STUDIO_MAX_ATTEMPTS_PER_HOUR ?? '10')
  } : null;
  const server = await createGateway({ authTokenHash: process.env.STUDIO_ACCESS_TOKEN_SHA256, providerConfigured: Boolean(process.env.OPENAI_API_KEY), staticDirectory: fileURLToPath(new URL('./dist/', import.meta.url)), imageGeneration });
  if (imageGeneration) console.warn('Billable image generation is enabled; estimates are not price caps. Use only after explicit security and cost review.');
  server.listen(port, '127.0.0.1', () => console.log(`Local gateway listening at http://127.0.0.1:${port}`));
}
