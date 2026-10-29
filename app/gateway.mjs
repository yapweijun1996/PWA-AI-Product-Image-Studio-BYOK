import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, readdir, lstat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
function error(response, status, code, message) {
  json(response, status, { error: { code, message, retryable: false, requestId: randomBytes(16).toString('hex'), outcome: 'DEFINITIVE_FAILURE', retryAfterSeconds: null } });
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

// The caller supplies a SHA-256 digest of a random, high-entropy login token; it is not a password hash.
// This local-only process is not a reviewed production identity system or a provider adapter.
export async function createGateway({ authTokenHash, providerConfigured, staticDirectory, now = Date.now }) {
  if (!/^[a-f0-9]{64}$/.test(authTokenHash ?? '')) throw new Error('A valid owner access-token digest is required.');
  if (typeof providerConfigured !== 'boolean') throw new Error('Provider configuration status is required.');
  const files = await staticFiles(resolve(staticDirectory));
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
    const expectsBody = request.method === 'POST' && (path === `${API}/auth/login` || path === `${API}/session/connect`);
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
  const server = await createGateway({ authTokenHash: process.env.STUDIO_ACCESS_TOKEN_SHA256, providerConfigured: Boolean(process.env.OPENAI_API_KEY), staticDirectory: fileURLToPath(new URL('./dist/', import.meta.url)) });
  server.listen(port, '127.0.0.1', () => console.log(`Local gateway listening at http://127.0.0.1:${port}`));
}
