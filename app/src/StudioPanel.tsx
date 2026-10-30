import { useEffect, useRef, useState, type FormEvent } from 'react';
import { STUDIO_PROMPT, STUDIO_MODEL, STUDIO_QUALITY, STUDIO_SIZE, STUDIO_PROMPT_VERSION, STUDIO_MAX_PNG_BYTES, studioEstimateUSD } from '../studio-policy.mjs';
import { acknowledgeStudioAttempt, createStudioAttempt, globalStudioReviewFingerprint, listStudioAttempts, studioAttemptBlocks, studioInput, updateStudioAttempt, validStudioAcknowledgement, type Product, type StudioAsset, type StudioAttempt, type StudioRecordedOutcome } from './products';
import { inspectImageHeader } from './imageHeader';
import { sha256 } from './prepareSource';
import { useUnsavedChanges } from './useUnsavedChanges';

type Entry = { attempt: StudioAttempt; asset: StudioAsset | null };
type Gateway = { csrf: string; reviewRevision: number } | 'checking' | 'unavailable' | 'signed-out' | 'disconnected';

async function json(response: Response): Promise<unknown> {
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new Error('Invalid gateway response.');
  return response.json() as Promise<unknown>;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid gateway response.');
  return value as Record<string, unknown>;
}
function gatewayAvailable(): boolean {
  return navigator.onLine && window.location.protocol === 'http:' && window.location.hostname === '127.0.0.1';
}
async function request(path: string, init: RequestInit = {}): Promise<Response> {
  if (!gatewayAvailable()) throw new Error('Offline or local gateway unavailable. No request was sent.');
  return fetch(`/api/v2${path}`, { ...init, credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
}
export function decodeAcknowledgement(value: unknown, attemptId: string): { acknowledgedAt: string; recordedOutcome: StudioRecordedOutcome } {
  const receipt = record(value);
  if (receipt.clientAttemptId !== attemptId || !validStudioAcknowledgement(receipt.acknowledgedAt, receipt.recordedOutcome)) throw new Error('Invalid acknowledgement receipt. Review remains blocked.');
  return { acknowledgedAt: receipt.acknowledgedAt, recordedOutcome: receipt.recordedOutcome as StudioRecordedOutcome };
}

export function decodeReviewRevision(value: unknown): number {
  const revision = record(value).reviewRevision;
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) throw new Error('Invalid gateway review revision.');
  return revision;
}

export async function withStudioAttemptLock<T>(attemptId: string, locks: LockManager | undefined, action: () => Promise<T>): Promise<T> {
  if (!locks || typeof locks.request !== 'function') throw new Error('This browser does not support Web Locks. Generation and review of interrupted submissions are unavailable.');
  return locks.request(`studio-attempt:${attemptId}`, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
    if (!lock) throw new Error('This attempt is still active in another tab. Wait for it to finish before reviewing.');
    return action();
  });
}

export async function withStudioReviewLock<T>(attempt: StudioAttempt, locks: LockManager | undefined, action: () => Promise<T>): Promise<T> {
  if (attempt.status !== 'SUBMITTED') return action();
  if (attempt.recoveryLockVersion !== 1) throw new Error('This interrupted submission predates recovery locking or has an invalid lock version. It cannot be reviewed safely in this browser.');
  return withStudioAttemptLock(attempt.attemptId, locks, action);
}

export function cleanupPending(headers: Headers): boolean {
  return headers.has('X-Studio-Cleanup-Pending');
}

export function sceneFailure(status: number, envelope: Record<string, unknown>): { definitive: boolean; message: string } {
  const blocked = status === 409 && envelope.code === 'ATTEMPT_BUSY' && envelope.outcome === 'DEFINITIVE_FAILURE';
  const stale = status === 409 && envelope.code === 'APPROVAL_STALE' && envelope.outcome === 'DEFINITIVE_FAILURE';
  const definitive = envelope.outcome === 'DEFINITIVE_FAILURE' && (status !== 409 || blocked || stale);
  return { definitive, message: status === 503 && envelope.code === 'RECOVERY_REQUIRED' && definitive ? 'No image request was sent; journal evidence requires owner review. Preserve records and do not bypass the block.' : stale ? 'A review invalidated this authorization before the image request was sent. Give new consent and obtain a new approval for a new attempt.' : blocked ? 'Another attempt is active or requires review. This attempt was not sent.' : definitive ? rateLimitMessage(status, envelope) ?? 'The image attempt failed definitively.' : 'The image attempt outcome is UNKNOWN. A charge may have occurred; it will not be resent automatically.' };
}

export function approvalFailure(status: number, envelope: Record<string, unknown>): { stale: boolean; message: string } {
  const stale = status === 409 && envelope.code === 'APPROVAL_STALE' && envelope.outcome === 'DEFINITIVE_FAILURE';
  return { stale, message: stale ? 'A review invalidated this authorization before the image request was sent. Check the gateway and give new consent for a new attempt.' : rateLimitMessage(status, envelope) ?? 'Authorization was not granted. No image request was sent.' };
}

function rateLimitMessage(status: number, envelope: Record<string, unknown>): string | null {
  if (status !== 429 || (envelope.code !== 'RATE_LIMITED' && envelope.code !== 'PROVIDER_LIMIT') || envelope.outcome !== 'DEFINITIVE_FAILURE') return null;
  const seconds = envelope.retryAfterSeconds;
  const guidance = envelope.code === 'PROVIDER_LIMIT'
    ? 'Provider limit reached. Check provider rate limits, quota and billing.'
    : 'Local rate limit reached.';
  return typeof seconds === 'number' && Number.isInteger(seconds) && seconds >= 1 && seconds <= 86400
    ? `${guidance} Wait at least ${seconds} seconds before separately authorizing a new attempt; no automatic retry will occur.`
    : `${guidance} A new attempt requires separate authorization; no automatic retry will occur.`;
}
export async function decodeScene(value: unknown, attemptId: string): Promise<{ blob: Blob; hash: string; usage: Record<string, unknown> | null; observedUSD: string | null }> {
  const result = record(value), image = record(result.image);
  if (result.clientAttemptId !== attemptId || result.outcome !== 'DEFINITIVE_SUCCESS' || result.model !== STUDIO_MODEL || image.mimeType !== 'image/png' || image.width !== 1024 || image.height !== 1024 || typeof image.dataBase64 !== 'string' || image.dataBase64.length > Math.ceil(STUDIO_MAX_PNG_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image.dataBase64) || !image.dataBase64.length || (result.usage !== null && (typeof result.usage !== 'object' || Array.isArray(result.usage))) || (result.observedUSD !== null && (typeof result.observedUSD !== 'string' || !/^\d+\.\d{1,6}$/.test(result.observedUSD)))) throw new Error('The returned scene response is invalid.');
  const raw = atob(image.dataBase64), bytes = Uint8Array.from(raw, (char) => char.charCodeAt(0));
  if (bytes.byteLength > STUDIO_MAX_PNG_BYTES) throw new Error('The returned scene exceeds the size limit.');
  const header = inspectImageHeader(bytes);
  if (header.mimeType !== 'image/png' || header.width !== 1024 || header.height !== 1024 || header.orientation !== 1) throw new Error('The returned scene is not the expected PNG.');
  const blob = new Blob([bytes], { type: 'image/png' });
  const bitmap = await createImageBitmap(blob);
  try { if (bitmap.width !== 1024 || bitmap.height !== 1024) throw new Error('The decoded scene dimensions do not match.'); }
  finally { bitmap.close(); }
  return { blob, hash: await sha256(bytes), usage: result.usage as Record<string, unknown> | null, observedUSD: result.observedUSD as string | null };
}

function Scene({ asset }: { asset: StudioAsset }) {
  const [url, setUrl] = useState('');
  useEffect(() => { const next = URL.createObjectURL(asset.blob); setUrl(next); return () => URL.revokeObjectURL(next); }, [asset]);
  return url ? <img className="studio-scene" src={url} alt="Unapproved generated empty studio background" /> : null;
}

export function StudioPanel({ product, onBusyChange }: { product: Product; onBusyChange: (busy: boolean) => void }) {
  const [gateway, setGateway] = useState<Gateway>('checking');
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [reviewFingerprint, setReviewFingerprint] = useState<string | null>(null);
  const [consent, setConsent] = useState<{ fingerprint: string; reviewRevision: number } | null>(null);
  const [max, setMax] = useState('');
  const [reviewConfirmed, setReviewConfirmed] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const running = useRef(false);
  const gatewayCheck = useRef(0);
  useUnsavedChanges(confirmed || Boolean(max) || busy || Object.values(reviewConfirmed).some(Boolean));
  const unresolved = entries?.some(({ attempt }) => studioAttemptBlocks(attempt)) ?? false;

  async function refreshGateway() {
    const check = ++gatewayCheck.current;
    setConfirmed(false); setConsent(null);
    if (!gatewayAvailable()) { setGateway('unavailable'); return; }
    setGateway('checking');
    const update = (value: Gateway) => { if (gatewayCheck.current === check) setGateway(value); };
    try {
      const authResponse = await request('/auth/session');
      if (authResponse.status === 401) { update('signed-out'); return; }
      if (!authResponse.ok) throw new Error();
      const auth = record(await json(authResponse));
      if (auth.authenticated !== true || typeof auth.csrfToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(auth.csrfToken)) throw new Error();
      const providerResponse = await request('/session/status');
      if (!providerResponse.ok) throw new Error();
      const provider = record(await json(providerResponse));
      if (provider.provider !== 'openai' || provider.connected !== true || provider.configured !== true || typeof provider.expiresAt !== 'string' || !Number.isFinite(Date.parse(provider.expiresAt)) || Date.parse(provider.expiresAt) <= Date.now()) { update('disconnected'); return; }
      const revisionResponse = await request('/images/revision', { headers: { 'X-CSRF-Token': auth.csrfToken } });
      if (!revisionResponse.ok) throw new Error();
      const reviewRevision = decodeReviewRevision(await json(revisionResponse));
      update({ csrf: auth.csrfToken, reviewRevision });
    } catch { update('unavailable'); }
  }
  async function refreshEntries() {
    setReviewFingerprint(null);
    const [value, fingerprint] = await Promise.all([listStudioAttempts(product.productId), globalStudioReviewFingerprint()]);
    setEntries(value); setReviewFingerprint(fingerprint);
  }
  useEffect(() => {
    let active = true;
    setEntries(null); setReviewFingerprint(null); setConfirmed(false); setConsent(null);
    Promise.all([listStudioAttempts(product.productId), globalStudioReviewFingerprint()]).then(([value, fingerprint]) => { if (active) { setEntries(value); setReviewFingerprint(fingerprint); } }).catch(() => { if (active) setError('Local attempt history is unavailable. Generation is disabled.'); });
    void refreshGateway();
    const offline = () => { gatewayCheck.current++; setConfirmed(false); setConsent(null); setGateway('unavailable'); };
    window.addEventListener('offline', offline);
    return () => { active = false; gatewayCheck.current++; window.removeEventListener('offline', offline); };
  }, [product.productId]);

  async function review(attempt: StudioAttempt) {
    if (running.current || !studioAttemptBlocks(attempt) || !reviewConfirmed[attempt.attemptId] || typeof gateway !== 'object' || !((attempt.status === 'UNKNOWN' || attempt.status === 'SUBMITTED') || ((attempt.status === 'DEFINITIVE_SUCCESS' || attempt.status === 'DEFINITIVE_FAILURE') && attempt.cleanupPending === true))) return;
    gatewayCheck.current++;
    running.current = true; onBusyChange(true); setBusy(true); setError(''); setNotice(''); setConfirmed(false); setConsent(null); setGateway('checking');
    try {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(attempt.attemptId)) throw new Error('This attempt has an invalid ID and cannot be reviewed.');
      await withStudioReviewLock(attempt, navigator.locks, async () => {
        const current = (await listStudioAttempts(product.productId)).find((entry) => entry.attempt.attemptId === attempt.attemptId)?.attempt;
        if (!current || current.status !== attempt.status || !studioAttemptBlocks(current) ||
            (current.status === 'SUBMITTED' && current.recoveryLockVersion !== 1)) {
          throw new Error('The attempt changed while review was pending. The current history has been refreshed.');
        }
        const response = await request(`/images/attempts/${attempt.attemptId}/acknowledgement`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': gateway.csrf },
          body: JSON.stringify({ acknowledgePossibleCharge: true }),
        });
        if (!response.ok) throw new Error(response.status === 409 ? 'Review is unavailable: the attempt may still be active or have no reviewable result. See the current history.' : 'Review could not be recorded. Check your session and connection, then try again.');
        const receipt = decodeAcknowledgement(await json(response), attempt.attemptId);
        await acknowledgeStudioAttempt(attempt.attemptId, receipt.acknowledgedAt, receipt.recordedOutcome);
        await refreshEntries();
        setReviewConfirmed((current) => ({ ...current, [attempt.attemptId]: false }));
        setNotice(attempt.cleanupPending === true ? `Review saved. The original outcome remains ${attempt.status}. A new attempt requires separate authorization.` : 'Review saved. The original outcome remains UNKNOWN. A new attempt requires separate authorization.');
      });
    } catch (reason) {
      try { await refreshEntries(); } catch { setEntries(null); }
      setError(reason instanceof Error ? reason.message : 'Review could not be saved. See the current history.');
    } finally {
      await refreshGateway();
      running.current = false; onBusyChange(false); setBusy(false);
    }
  }

  async function generate(event: FormEvent) {
    event.preventDefault();
    if (running.current || unresolved || !confirmed || consent === null || entries === null || typeof gateway !== 'object') return;
    running.current = true; onBusyChange(true); setBusy(true); setError(''); setNotice('');
    let attempt: StudioAttempt | null = null;
    let submitted = false, persisted = false;
    try {
      if (!gatewayAvailable()) throw new Error('Offline or local gateway unavailable. No request was sent.');
      if (max && (!/^\d+\.\d{1,6}$/.test(max) || Number(max) < Number(studioEstimateUSD()))) throw new Error('Enter a decimal soft limit at least equal to the estimate, or leave it empty.');
      const input = await studioInput(product.productId);
      const id = crypto.randomUUID();
      await withStudioAttemptLock(id, navigator.locks, async () => {
      try {
      const body = { clientAttemptId: id, productId: product.productId, styleId: 'studio', lockMode: 'STRICT', operation: 'generate_scene', model: STUDIO_MODEL, quality: STUDIO_QUALITY, size: STUDIO_SIZE, prompt: STUDIO_PROMPT, promptVersion: STUDIO_PROMPT_VERSION, sourceAssetHashes: [input.source.sha256], estimatedUSD: studioEstimateUSD(), ...(max ? { maxEstimatedUSD: max } : {}), outputFormat: 'png', reviewRevision: consent.reviewRevision };
      attempt = { attemptId: id, jobId: crypto.randomUUID(), productId: product.productId, sourceAssetId: input.source.assetId, sourceSha256: input.source.sha256, maskId: input.maskId, maskSha256: input.maskSha256, prompt: STUDIO_PROMPT, promptVersion: STUDIO_PROMPT_VERSION, model: STUDIO_MODEL, quality: STUDIO_QUALITY, size: STUDIO_SIZE, estimatedUSD: studioEstimateUSD(), ...(max ? { maxEstimatedUSD: max } : {}), submittedAt: new Date().toISOString(), status: 'PREPARED', usage: null, observedUSD: null, recoveryLockVersion: 1 };
      await createStudioAttempt(attempt, consent.fingerprint); persisted = true;
      const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': gateway.csrf };
      const approvalResponse = await request('/images/approvals', { method: 'POST', headers, body: JSON.stringify(body) });
      if (!approvalResponse.ok) {
        let message: string | null = null;
        try {
          const failure = approvalFailure(approvalResponse.status, record(record(await json(approvalResponse)).error));
          if (failure.stale) { gatewayCheck.current++; setGateway('unavailable'); }
          message = failure.message;
        } catch { /* use safe generic message */ }
        throw new Error(message ?? 'Authorization was not granted. No image request was sent.');
      }
      const approval = record(await json(approvalResponse));
      if (typeof approval.approvalId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(approval.approvalId) || typeof approval.expiresAt !== 'string' || !Number.isFinite(Date.parse(approval.expiresAt)) || Date.parse(approval.expiresAt) <= Date.now()) throw new Error('Invalid or expired authorization. No image request was sent.');
      attempt = { ...attempt, status: 'SUBMITTED' };
      await updateStudioAttempt(attempt, undefined, consent.fingerprint);
      submitted = true;
      const response = await request('/images/generate', { method: 'POST', headers: { ...headers, 'X-Client-Request-Id': id, 'X-Attempt-Approval': approval.approvalId }, body: JSON.stringify(body) });
      if (!response.ok) {
        let failure = { definitive: false, message: 'The image attempt outcome is UNKNOWN. A charge may have occurred; it will not be resent automatically.' };
        try {
          const envelope = record(record(await json(response)).error);
          failure = sceneFailure(response.status, envelope);
          if (response.status === 409 && envelope.code === 'APPROVAL_STALE' && failure.definitive) { gatewayCheck.current++; setGateway('unavailable'); }
        } catch { /* malformed failure is ambiguous */ }
        attempt = { ...attempt, status: failure.definitive ? 'DEFINITIVE_FAILURE' : 'UNKNOWN', ...(failure.definitive && cleanupPending(response.headers) ? { cleanupPending: true as const } : {}) };
        await updateStudioAttempt(attempt);
        throw new Error(failure.message);
      }
      const scene = await decodeScene(await json(response), id);
      attempt = { ...attempt, status: 'DEFINITIVE_SUCCESS', usage: scene.usage, observedUSD: scene.observedUSD, ...(cleanupPending(response.headers) ? { cleanupPending: true as const } : {}) };
      await updateStudioAttempt(attempt, { assetId: crypto.randomUUID(), attemptId: id, productId: product.productId, blob: scene.blob, sha256: scene.hash });
      setNotice('Unapproved empty background saved locally. The original source and mask were not modified.');
    } catch (reason) {
      if (persisted && attempt && attempt.status !== 'DEFINITIVE_FAILURE' && attempt.status !== 'UNKNOWN') {
        attempt = { ...attempt, status: submitted ? 'UNKNOWN' : 'DEFINITIVE_FAILURE' };
        try { await updateStudioAttempt(attempt); } catch { /* retained submitted or prepared record is not resent */ }
      }
      setError(submitted && attempt?.status === 'UNKNOWN' ? 'The outcome is UNKNOWN or the response could not be saved. A charge may have occurred; no automatic retry will be made.' : reason instanceof Error ? reason.message : 'Local storage or gateway is unavailable.');
      }
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Local storage or gateway is unavailable.');
    } finally {
      setConfirmed(false); setConsent(null); setMax('');
      try { await refreshEntries(); } catch { setEntries(null); setError('Local attempt history could not be read. Generation is disabled.'); }
      running.current = false; onBusyChange(false); setBusy(false);
    }
  }

  return <section className="product-section studio-panel" aria-labelledby="studio-heading">
    <span className="section-kicker">STRICT STUDIO</span><h2 id="studio-heading">Generate one empty scene</h2>
    <p>This creates an unapproved background only, not a product image. Your original source and active mask remain unchanged; no source image is sent. An owned, verified source and matching saved active mask are required.</p>
    <p><strong>Backup warning:</strong> Once an attempt is saved, the current backup cannot safely include this project's jobs or outputs and will refuse export. Back up the project before proceeding.</p>
    <p>Exactly <strong>one</strong> anticipated image call. Estimated total: <strong>${studioEstimateUSD()} USD</strong>. Estimate only, not a cap or guaranteed charge: 196 output tokens at $30 per million ($0.005880), plus an assumption of 100 text input tokens at $5 per million ($0.000500). Pricing snapshot: 2026-10-29; rates can change. Actual usage and charge may be unavailable or different. <a href="https://developers.openai.com/api/docs/guides/image-generation" target="_blank" rel="noreferrer">Pricing evidence</a>.</p>
    <p>Model {STUDIO_MODEL}; {STUDIO_QUALITY}; {STUDIO_SIZE}; PNG. Prompt {STUDIO_PROMPT_VERSION}: {STUDIO_PROMPT}</p>
    {gateway === 'checking' ? <p role="status">Checking local gateway…</p> : gateway === 'unavailable' ? <p role="status">Offline or local gateway unavailable. Generation is disabled.</p> : gateway === 'signed-out' ? <p>Sign in to the local app in provider settings first.</p> : gateway === 'disconnected' ? <p>Connect the configured provider session in settings first.</p> : <p>Local app and provider session active.</p>}
    {!navigator.locks && <p>Web Locks are unavailable in this browser. Generation and review of interrupted submissions are disabled; existing UNKNOWN attempts can still be reviewed.</p>}
    <button className="secondary-button" type="button" disabled={busy} onClick={() => void refreshGateway()}>Check gateway</button>
    <form onSubmit={generate}>
      <label htmlFor="studio-limit">Optional estimated USD soft limit</label><input id="studio-limit" value={max} onChange={(event) => setMax(event.target.value)} placeholder="e.g. 0.010000" disabled={busy} inputMode="decimal" />
      <label className="checkbox-label"><input type="checkbox" checked={confirmed} onChange={(event) => { const checked = event.target.checked; setConfirmed(checked); setConsent(checked && reviewFingerprint !== null && typeof gateway === 'object' ? { fingerprint: reviewFingerprint, reviewRevision: gateway.reviewRevision } : null); }} disabled={busy || entries === null || reviewFingerprint === null || typeof gateway !== 'object'} /><span>I explicitly authorize this single attempt and acknowledge the estimate, backup warning, and possible unknown charge.</span></label>
      <button className="primary-button" type="submit" disabled={busy || unresolved || !confirmed || consent === null || entries === null || !navigator.locks || typeof gateway !== 'object'}>{busy ? 'Working…' : 'Authorize and generate one scene'}</button>
    </form>
    {error && <p className="error-message" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <h3>Local attempt history</h3>{entries === null ? <p>History unavailable or loading.</p> : entries.length === 0 ? <p>No attempts yet.</p> : <ul className="studio-history">{entries.map(({ attempt, asset }) => <li key={attempt.attemptId}><p><strong>{attempt.status === 'SUBMITTED' ? 'UNKNOWN (interrupted or in progress)' : attempt.status === 'PREPARED' ? 'Prepared; no image send recorded' : attempt.status}</strong> · {attempt.attemptId} · {new Date(attempt.submittedAt).toLocaleString()} · estimate ${attempt.estimatedUSD} USD · observed {attempt.observedUSD === null ? 'unavailable' : `$${attempt.observedUSD} USD`}</p>
      {(attempt.status === 'UNKNOWN' || attempt.status === 'SUBMITTED' || attempt.cleanupPending !== undefined) && (studioAttemptBlocks(attempt) ? <div>
        <p>{attempt.cleanupPending === true ? `The gateway could not clear its active marker after recording ${attempt.status}. The saved outcome is unchanged. Review provider billing externally before acknowledging; this does not send an image request.` : attempt.cleanupPending !== undefined ? 'Invalid cleanup metadata. Generation remains blocked; preserve the saved records for owner review.' : 'A charge may have occurred. Review provider billing externally before proceeding. An interrupted submission may still be active; the gateway will refuse review while active or without a reviewable result. This acknowledgement does not resolve the original outcome or send an image request.'}</p>
        <label className="checkbox-label"><input type="checkbox" checked={Boolean(reviewConfirmed[attempt.attemptId])} onChange={(event) => setReviewConfirmed((current) => ({ ...current, [attempt.attemptId]: event.target.checked }))} disabled={busy} /><span>I have reviewed provider billing externally and acknowledge the previous attempt may have incurred a charge.</span></label>
        <button className="secondary-button" type="button" disabled={busy || !reviewConfirmed[attempt.attemptId] || typeof gateway !== 'object' || (attempt.cleanupPending !== undefined && attempt.cleanupPending !== true)} onClick={() => void review(attempt)}>Record review of this attempt</button>
      </div> : <p>Reviewed at {attempt.acknowledgedAt}; gateway recorded outcome: {attempt.recordedOutcome}. Local outcome remains {attempt.cleanupPending === true ? attempt.status : 'UNKNOWN'}. A new attempt requires separate authorization.</p>)}
      {attempt.status === 'DEFINITIVE_SUCCESS' && (asset ? <><p>Unapproved generated background</p><Scene asset={asset} /></> : <p className="error-message">Saved scene is missing.</p>)}</li>)}</ul>}
  </section>;
}
