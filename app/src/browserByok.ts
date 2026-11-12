import { automaticPrompt, automaticEstimateUSD, AUTOMATIC_PROMPT_VERSION } from '../automatic-policy.mjs';
import { validateAutomaticReferences } from './automaticReference.ts';
import { credentialStore, readStoredCredential, writeStoredCredential, authorizeStoredCredential, markStoredUploadAttempt, recordStoredAttemptOutcome, type StoredCredential, type UploadAuthorization } from './browserCredentialStore.ts';
import { generateImage } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { STUDIO_MODEL, STUDIO_QUALITY, STUDIO_SIZE, STUDIO_MAX_PNG_BYTES, studioBuildPrompt, studioEstimateUSD } from '../studio-policy.mjs';

// Credentials persist only in the dedicated owner-authorized IndexedDB store.
// Broadcast messages contain state only, never credential values.
let saved = false;
const credentialChannel = typeof document !== 'undefined' && typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('image-studio-credential-state') : null;
credentialChannel?.addEventListener('message', event => { if (['saved','deleted'].includes(event.data)) { saved=event.data==='saved'; clearBrowserKey(); } });
let key = '', expires = 0, epoch = 0;
let credentialId = '', uploadAuthorization: UploadAuthorization | null = null;
let referenceConsent = false, referenceEpoch = 0;
const referenceActive = new Set<AbortController>();
export function referenceTransmissionAllowed() { return referenceConsent; }
export function setReferenceTransmissionConsent(consent: boolean) {
  referenceConsent = consent === true; referenceEpoch++; approvals.clear();
  if (!referenceConsent) for (const controller of referenceActive) controller.abort();
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('studio-reference-consent'));
}
export function onReferenceConsentChange(listener: () => void) { window.addEventListener('studio-reference-consent', listener); return () => window.removeEventListener('studio-reference-consent', listener); }
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
export function browserKeyStatus() { return { saved, credentialId, uploadAuthorization: uploadAuthorization ? { ...uploadAuthorization } : null, connected: Boolean(key) && expires > Date.now(), expiresAt: expires ? new Date(expires).toISOString() : null }; }
export function clearBrowserKey() {
  key = ''; expires = 0; credentialId = ''; uploadAuthorization = null; epoch++; setReferenceTransmissionConsent(false); approvals.clear(); clearTimeout(expiryTimer);
  for (const controller of active) controller.abort();
  window.dispatchEvent(new Event(EVENT));
}
export const providerKeyMismatch = 'This is an OpenRouter key. This app currently requires an OpenAI API key. Replace it in Settings; no request was sent.';
export function setBrowserKey(value: string) {
  if(value.startsWith('sk-or-'))throw new Error(providerKeyMismatch);
  if (!/^sk-[A-Za-z0-9_-]{10,500}$/.test(value)) throw new Error('Enter an OpenAI API key.');
  clearBrowserKey(); key = value; expires = Date.now() + 60 * 60 * 1000;
  expiryTimer = setTimeout(clearBrowserKey, 60 * 60 * 1000);
  window.dispatchEvent(new Event(EVENT));
}
function activateStoredCredential(record: StoredCredential) {
  setBrowserKey(record.key); credentialId = record.id; uploadAuthorization = record.authorization; saved = true;
  window.dispatchEvent(new Event(EVENT));
}
export async function restoreSavedBrowserKey() {
  if(browserKeyStatus().connected)return;
  const revision=epoch, record=await readStoredCredential();
  if(epoch!==revision)return;
  saved=Boolean(record);
  if(record)activateStoredCredential(record);
  else window.dispatchEvent(new Event(EVENT));
}
export async function saveBrowserKey(value:string, consent=false, monthlyCap='') {
  if(value.startsWith('sk-or-'))throw new Error(providerKeyMismatch);
  if (!/^sk-[A-Za-z0-9_-]{10,500}$/.test(value)) throw new Error('Enter an OpenAI API key.');
  clearBrowserKey(); const revision=epoch;
  const record=await writeStoredCredential(value,consent,monthlyCap);
  if(epoch===revision)activateStoredCredential(record);
  credentialChannel?.postMessage('saved');
}
export async function saveUploadAuthorization(consent:boolean,monthlyCap='') {
  if(!browserKeyStatus().connected)throw new Error('Reload your saved key before saving upload settings.');
  const revision=epoch, expectedId=credentialId;
  const record=await authorizeStoredCredential(expectedId,consent,monthlyCap);
  if(epoch!==revision)throw new Error('The key changed while saving upload settings.');
  activateStoredCredential(record);credentialChannel?.postMessage('saved');
}
export async function forgetBrowserKey() {
  clearBrowserKey();
  await credentialStore('delete');
  saved=false;clearBrowserKey();credentialChannel?.postMessage('deleted');
}
export function onBrowserKeyChange(listener: () => void) { window.addEventListener(EVENT, listener); return () => window.removeEventListener(EVENT, listener); }
if (typeof window !== 'undefined') window.addEventListener('pagehide', clearBrowserKey);
const response = (body: unknown, status = 200) => Response.json(body, { status });
const failure = (code: string, outcome = 'DEFINITIVE_FAILURE', status = 409) => response({ error: { code, outcome } }, status);
function blocked(markers: Record<string, Marker>) {
  return Object.values(markers).some(m => (!m.reviewed && ['IN_FLIGHT','UNKNOWN'].includes(m.outcome)) || m.waitReview || (m.waitUntil ?? 0) > Date.now());
}
function validBody(b: Record<string, unknown>) {
  if (b.automaticMode !== undefined) {
    const allowed = ["clientAttemptId", "productId", "styleId", "lockMode", "operation", "automaticMode", "automaticPromptVersion", "referenceInputs", "model", "quality", "size", "prompt", "promptVersion", "presetVersion", "sceneContext", "sourceAssetHashes", "estimatedUSD", "outputFormat", "reviewRevision"];
    if (Object.keys(b).some(field => !allowed.includes(field))) return false;
    const mode = b.automaticMode;
    if (mode !== 'STRICT' && mode !== 'REFERENCE') return false;
    if (b.automaticPromptVersion !== AUTOMATIC_PROMPT_VERSION || b.prompt !== automaticPrompt(b.styleId as never, mode) || b.estimatedUSD !== automaticEstimateUSD(b.styleId as never, mode, mode === 'REFERENCE' && Array.isArray(b.referenceInputs) ? b.referenceInputs.length : 1)) return false;
    if (mode === 'REFERENCE' ? (!referenceConsent || b.operation !== 'reference_edit' || b.lockMode !== 'BALANCED' || !Array.isArray(b.referenceInputs)) : (b.referenceInputs !== undefined || b.operation !== 'generate_scene' || b.lockMode !== 'STRICT')) return false;
    return b.model === STUDIO_MODEL && b.quality === STUDIO_QUALITY && b.size === STUDIO_SIZE && b.outputFormat === 'png' && typeof b.clientAttemptId === 'string' && /^[a-f0-9-]{36}$/.test(b.clientAttemptId);
  }
  if (b.referenceInputs !== undefined || b.automaticPromptVersion !== undefined) return false;
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
  const validationEpoch = epoch, consentEpoch = referenceEpoch;
  const automatic = body.automaticMode !== undefined;
  const authorization = uploadAuthorization ? { ...uploadAuthorization } : null, dispatchCredentialId = credentialId;
  if (automatic && (!authorization || !dispatchCredentialId)) return failure('UPLOAD_AUTHORIZATION_REQUIRED');
  const isReference = body.automaticMode === 'REFERENCE';
  let referenceBytes: Uint8Array[] = [];
  try {
    if (!validBody(body)) return failure('INVALID_INPUT');
    if (isReference) referenceBytes = await validateAutomaticReferences(body.referenceInputs);
  } catch { return failure('INVALID_INPUT'); }
  if (validationEpoch !== epoch || (isReference && (!referenceConsent || consentEpoch !== referenceEpoch))) return failure('APPROVAL_STALE');
  if (body.reviewRevision !== epoch) return failure('APPROVAL_STALE');
  if (!navigator.locks) return failure('RECOVERY_REQUIRED', 'DEFINITIVE_FAILURE', 503);
  return navigator.locks.request('studio-browser-byok-dispatch-v1', async () => {
    if (!browserKeyStatus().connected) return failure('UNAUTHENTICATED','DEFINITIVE_FAILURE',401);
    if (body.reviewRevision !== epoch || validationEpoch !== epoch || (isReference && (!referenceConsent || consentEpoch !== referenceEpoch))) return failure('APPROVAL_STALE');
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
    if (isReference) referenceActive.add(controller);
    let httpStatus: number | undefined, waitSeconds: number | undefined, sent = false, accounted = false;
    try {
      const provider = createOpenAI({ apiKey: key, baseURL: 'https://api.openai.com/v1', fetch: async (url, options) => {
        const endpoint = isReference ? 'https://api.openai.com/v1/images/edits' : 'https://api.openai.com/v1/images/generations';
        if (String(url) !== endpoint || sent || controller.signal.aborted || !browserKeyStatus().connected || validationEpoch !== epoch || (isReference && (!referenceConsent || consentEpoch !== referenceEpoch))) throw new Error('Request blocked.');
        if (automatic) {
          await markStoredUploadAttempt(body.productId as string, id, body.estimatedUSD as string, dispatchCredentialId, authorization!.id);
          accounted = true;
          if (controller.signal.aborted || !browserKeyStatus().connected || validationEpoch !== epoch || (isReference && (!referenceConsent || consentEpoch !== referenceEpoch))) throw new Error('Request blocked.');
        }
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
      const result = await generateImage({ model: provider.image(STUDIO_MODEL), prompt: isReference ? { text: body.prompt as string, images: referenceBytes } : body.prompt as string, size: STUDIO_SIZE,
        n: 1, maxRetries: 0, abortSignal: controller.signal, providerOptions: { openai: { quality: STUDIO_QUALITY, outputFormat: 'png' } } });
      const image = result.image;
      if (image.mediaType !== 'image/png' || image.uint8Array.byteLength > STUDIO_MAX_PNG_BYTES) throw new Error('Invalid image');
      markers[id] = { outcome: 'DEFINITIVE_SUCCESS' }; writeJournal(markers);
      if (accounted) await recordStoredAttemptOutcome(body.productId as string, id, 'DEFINITIVE_SUCCESS');
      return response({ clientAttemptId: id, outcome: 'DEFINITIVE_SUCCESS', model: STUDIO_MODEL,
        image: { mimeType: 'image/png', width: 1024, height: 1024, dataBase64: image.base64 }, usage: null, observedUSD: null });
    } catch {
      const definitive = !sent || (httpStatus !== undefined && httpStatus >= 400 && httpStatus < 500 && httpStatus !== 408);
      markers[id] = { outcome: definitive ? 'DEFINITIVE_FAILURE' : 'UNKNOWN',
        ...(httpStatus === 429 ? waitSeconds === undefined ? { waitReview: true as const } : { waitUntil: Date.now() + waitSeconds * 1000 } : {}) };
      writeJournal(markers);
      if (accounted) await recordStoredAttemptOutcome(body.productId as string, id, definitive ? 'DEFINITIVE_FAILURE' : 'UNKNOWN');
      if (httpStatus === 429) return response({ error: { code: 'PROVIDER_LIMIT', outcome: 'DEFINITIVE_FAILURE', ...(waitSeconds === undefined ? {} : { retryAfterSeconds: waitSeconds }) } },429);
      return failure(definitive ? 'PROVIDER_REJECTED' : 'UNKNOWN', definitive ? 'DEFINITIVE_FAILURE' : 'UNKNOWN', httpStatus === 401 ? 401 : 502);
    } finally { clearTimeout(timer); active.delete(controller); referenceActive.delete(controller); window.dispatchEvent(new Event('studio-auto-usage'));  }
  });
}
