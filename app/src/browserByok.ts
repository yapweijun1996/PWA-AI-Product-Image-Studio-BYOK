import { generateImage } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { STUDIO_MODEL, STUDIO_QUALITY, STUDIO_SIZE, STUDIO_MAX_PNG_BYTES, studioBuildPrompt, studioEstimateUSD } from '../studio-policy.mjs';

// Credentials never cross a persistence or broadcast boundary.
let key = '', expires = 0, epoch = 0;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;
const active = new Set<AbortController>();
const approvals = new Map<string, { body: string; epoch: number; expires: number }>();
const EVENT = 'studio-browser-key-changed';
const JOURNAL = 'studio.browser-byok.attempts.v1';
type Marker = { outcome: 'IN_FLIGHT' | 'UNKNOWN' | 'DEFINITIVE_SUCCESS' | 'DEFINITIVE_FAILURE'; reviewed?: true; waitUntil?: number; waitReview?: true };
function journal(): Record<string, Marker> {
  const value = JSON.parse(localStorage.getItem(JOURNAL) ?? '{}');
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.entries(value).some(([id, m]) =>
    !/^[a-f0-9-]{36}$/.test(id) || !m || typeof m !== 'object' || !['IN_FLIGHT','UNKNOWN','DEFINITIVE_SUCCESS','DEFINITIVE_FAILURE'].includes((m as Marker).outcome) ||
    ((m as Marker).waitUntil !== undefined && (!Number.isSafeInteger((m as Marker).waitUntil) || (m as Marker).waitUntil! < 0)))) throw new Error('Local request history requires recovery.');
  return value;
}
export function browserWaitReviewNeeded() { return Object.values(journal()).some(m=>m.waitReview===true); }
function writeJournal(value: Record<string, Marker>) { localStorage.setItem(JOURNAL, JSON.stringify(value)); }
export function browserKeyStatus() { return { connected: Boolean(key) && expires > Date.now(), expiresAt: expires ? new Date(expires).toISOString() : null }; }
export function clearBrowserKey() {
  key = ''; expires = 0; epoch++; approvals.clear(); clearTimeout(expiryTimer);
  for (const controller of active) controller.abort();
  window.dispatchEvent(new Event(EVENT));
}
export function setBrowserKey(value: string) {
  if (!/^sk-[A-Za-z0-9_-]{10,500}$/.test(value)) throw new Error('Enter an OpenAI API key.');
  clearBrowserKey(); key = value; expires = Date.now() + 60 * 60 * 1000;
  expiryTimer = setTimeout(clearBrowserKey, 60 * 60 * 1000);
  window.dispatchEvent(new Event(EVENT));
}
export function onBrowserKeyChange(listener: () => void) { window.addEventListener(EVENT, listener); return () => window.removeEventListener(EVENT, listener); }
if (typeof window !== 'undefined') window.addEventListener('pagehide', clearBrowserKey);
const response = (body: unknown, status = 200) => Response.json(body, { status });
const failure = (code: string, outcome = 'DEFINITIVE_FAILURE', status = 409) => response({ error: { code, outcome } }, status);
function blocked(markers: Record<string, Marker>) {
  return Object.values(markers).some(m => (!m.reviewed && ['IN_FLIGHT','UNKNOWN'].includes(m.outcome)) || m.waitReview || (m.waitUntil ?? 0) > Date.now());
}
function validBody(b: Record<string, unknown>) {
  return b.model === STUDIO_MODEL && b.quality === STUDIO_QUALITY && b.size === STUDIO_SIZE && b.outputFormat === 'png' &&
    b.operation === 'generate_scene' && b.lockMode === 'STRICT' && typeof b.clientAttemptId === 'string' && /^[a-f0-9-]{36}$/.test(b.clientAttemptId) &&
    b.prompt === studioBuildPrompt(b.styleId as never, b.sceneContext as never) && b.estimatedUSD === studioEstimateUSD(b.prompt as string);
}

// Local transport adapter for the existing attempt workflow. These receipts are
// browser bookkeeping, never claims of server authorization or billing proof.
export async function browserStudioRequest(path: string, init: RequestInit = {}): Promise<Response> {
  if (!browserKeyStatus().connected) return failure('UNAUTHENTICATED', 'DEFINITIVE_FAILURE', 401);
  const body = init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
  if (path === '/auth/session') return response({ authenticated: true, csrfToken: 'b'.repeat(43) });
  if (path === '/session/status') return response({ provider: 'openai', configured: true, connected: true, expiresAt: new Date(expires).toISOString() });
  if (path === '/images/revision') return response({ reviewRevision: epoch });
  if (path === '/images/legacy-waits') {
    const waits = Object.entries(journal()).filter(([,m]) => m.waitReview).map(([clientAttemptId]) => ({ clientAttemptId, retryNotBefore: 0 }));
    return response({ waits: waits.slice(0,100), hasMore: waits.length > 100 });
  }
  const review = /^\/images\/attempts\/([a-f0-9-]{36})\/(acknowledgement|legacy-wait-review)$/.exec(path);
  if (review && init.method === 'POST') {
    if (!navigator.locks) return failure('RECOVERY_REQUIRED','DEFINITIVE_FAILURE',503);
    return navigator.locks.request('studio-browser-byok-dispatch-v1', async () => {
    const markers = journal(), id = review[1], m = markers[id];
    if (!m) return failure('RECOVERY_REQUIRED', 'DEFINITIVE_FAILURE', 503);
    if (review[2] === 'legacy-wait-review') {
      if (body.reviewedProviderWait !== true || body.reviewRevision !== epoch) return failure('APPROVAL_STALE');
      delete m.waitReview; writeJournal(markers); epoch++; approvals.clear();
      return response({ clientAttemptId: id, retryNotBefore: m.waitUntil ?? 0, reviewedAt: new Date().toISOString() });
    }
    if (body.acknowledgePossibleCharge !== true) return failure('INVALID_INPUT');
    m.reviewed = true; writeJournal(markers); epoch++; approvals.clear();
    return response({ clientAttemptId: id, acknowledgedAt: new Date().toISOString(), recordedOutcome: m.outcome === 'IN_FLIGHT' ? 'UNKNOWN' : m.outcome });
    });
  }
  if (!['/images/approvals','/images/generate'].includes(path) || init.method !== 'POST') return failure('INVALID_INPUT');
  try { if (!validBody(body)) return failure('INVALID_INPUT'); } catch { return failure('INVALID_INPUT'); }
  if (body.reviewRevision !== epoch) return failure('APPROVAL_STALE');
  if (!navigator.locks) return failure('RECOVERY_REQUIRED', 'DEFINITIVE_FAILURE', 503);
  return navigator.locks.request('studio-browser-byok-dispatch-v1', async () => {
    if (!browserKeyStatus().connected) return failure('UNAUTHENTICATED','DEFINITIVE_FAILURE',401);
    if (body.reviewRevision !== epoch) return failure('APPROVAL_STALE');
    const markers = journal(), id = body.clientAttemptId as string;
    if (blocked(markers) || markers[id]) return failure('ATTEMPT_BUSY');
    if (path === '/images/approvals') {
      approvals.clear();
      const approvalId = crypto.randomUUID(), deadline = Date.now() + 60_000;
      approvals.set(approvalId, { body: JSON.stringify(body), epoch, expires: deadline });
      return response({ approvalId, expiresAt: new Date(deadline).toISOString() });
    }
    const headers = new Headers(init.headers), approval = approvals.get(headers.get('X-Attempt-Approval') ?? '');
    approvals.delete(headers.get('X-Attempt-Approval') ?? '');
    if (!approval || approval.epoch !== epoch || approval.expires <= Date.now() || approval.body !== JSON.stringify(body) || headers.get('X-Client-Request-Id') !== id) return failure('APPROVAL_STALE');
    markers[id] = { outcome: 'IN_FLIGHT' };
    try { writeJournal(markers); } catch { return failure('RECOVERY_REQUIRED','DEFINITIVE_FAILURE',503); }
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 300_000);
    active.add(controller);
    let httpStatus: number | undefined, waitSeconds: number | undefined, sent = false;
    try {
      const provider = createOpenAI({ apiKey: key, baseURL: 'https://api.openai.com/v1', fetch: async (url, options) => {
        if (String(url) !== 'https://api.openai.com/v1/images/generations' || sent) throw new Error('Request blocked.');
        sent = true;
        const result = await fetch(url, { ...options, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
        httpStatus = result.status;
        const delay = result.headers.get('retry-after');
        if (delay && /^\d{1,10}$/.test(delay) && Number(delay) <= 2147483647) waitSeconds = Number(delay);
        if (result.body) {
          const reader = result.body.getReader(); let bytes = 0;
          const limited = new ReadableStream<Uint8Array>({
            async pull(stream) {
              try {
                const chunk = await reader.read();
                if (chunk.done) { stream.close(); return; }
                bytes += chunk.value.byteLength;
                if (bytes > 18 * 1024 * 1024) { controller.abort(); void reader.cancel(); stream.error(new Error('Image response exceeds limit.')); return; }
                stream.enqueue(chunk.value);
              } catch { stream.error(new Error('Image response interrupted.')); }
            }, cancel() { void reader.cancel(); }
          });
          return new Response(limited, { status: result.status, headers: result.headers });
        }
        return result;
      } });
      const result = await generateImage({ model: provider.image(STUDIO_MODEL), prompt: body.prompt as string, size: STUDIO_SIZE,
        n: 1, maxRetries: 0, abortSignal: controller.signal, providerOptions: { openai: { quality: STUDIO_QUALITY, outputFormat: 'png' } } });
      const image = result.image;
      if (image.mediaType !== 'image/png' || image.uint8Array.byteLength > STUDIO_MAX_PNG_BYTES) throw new Error('Invalid image');
      markers[id] = { outcome: 'DEFINITIVE_SUCCESS' }; writeJournal(markers);
      return response({ clientAttemptId: id, outcome: 'DEFINITIVE_SUCCESS', model: STUDIO_MODEL,
        image: { mimeType: 'image/png', width: 1024, height: 1024, dataBase64: image.base64 }, usage: null, observedUSD: null });
    } catch {
      const definitive = !sent || (httpStatus !== undefined && httpStatus >= 400 && httpStatus < 500 && httpStatus !== 408);
      markers[id] = { outcome: definitive ? 'DEFINITIVE_FAILURE' : 'UNKNOWN',
        ...(httpStatus === 429 ? waitSeconds === undefined ? { waitReview: true as const } : { waitUntil: Date.now() + waitSeconds * 1000 } : {}) };
      writeJournal(markers);
      if (httpStatus === 429) return response({ error: { code: 'PROVIDER_LIMIT', outcome: 'DEFINITIVE_FAILURE', ...(waitSeconds === undefined ? {} : { retryAfterSeconds: waitSeconds }) } },429);
      return failure(definitive ? 'PROVIDER_REJECTED' : 'UNKNOWN', definitive ? 'DEFINITIVE_FAILURE' : 'UNKNOWN', httpStatus === 401 ? 401 : 502);
    } finally { clearTimeout(timer); active.delete(controller); }
  });
}
