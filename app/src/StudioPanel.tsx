import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { STUDIO_MODEL, STUDIO_QUALITY, STUDIO_SIZE, STUDIO_SCENE_PROMPT_VERSION, STUDIO_PRESET_VERSION, STUDIO_STYLE_IDS, STUDIO_MAX_PNG_BYTES, STUDIO_MAX_RETRY_AFTER_SECONDS, STUDIO_PRICING_SNAPSHOT, studioBuildPrompt, studioEstimateUSD, studioObservedUSD, type StudioStyleId, type StudioSceneContext } from '../studio-policy.mjs';
import { acknowledgeStudioAttempt, createStudioAttempt, globalStudioReviewFingerprint, listOtherStudioBlockers, listStudioAttempts, listStrictComposites, listStyleInputs, loadOriginalSource, productSnapshotFingerprint, resolveImportedUncertainty, studioSceneContext, studioAttemptBlocks, studioInput, studioSessionEstimate, updateStudioAttempt, validStudioAcknowledgement, type Product, type StrictComposite, type StudioAsset, type StudioAttempt, type StudioRecordedOutcome } from './products';
import { inspectImageHeader } from './imageHeader';
import { sha256 } from './prepareSource';
import { useUnsavedChanges } from './useUnsavedChanges';
import { StrictCompositePanel } from './StrictCompositePanel';
import { LocalImage } from './LocalImage';
import { gatewayOriginSupported, unsupportedGatewayMessage } from './gatewayAccess';

type Entry = Awaited<ReturnType<typeof listStudioAttempts>>[number];
type LegacyWait = { clientAttemptId: string; retryNotBefore: number };
type Gateway = { csrf: string; reviewRevision: number; legacyWaits: LegacyWait[]; hasMoreLegacyWaits: boolean } | 'checking' | 'unavailable' | 'unsupported-origin' | 'signed-out' | 'disconnected';
type SourceOption = Awaited<ReturnType<typeof listStyleInputs>>[number];
type PlannedStyle = { styleId: StudioStyleId; input: SourceOption; context: StudioSceneContext; prompt: string; estimate: string; prior: string; perAttemptOverride: boolean; sessionOverride: boolean };
const STYLE_LABELS: Record<StudioStyleId, string> = { studio: 'Studio', hero: 'Hero', lifestyle: 'Lifestyle', flat_lay: 'Flat Lay', macro: 'Macro', ugc: 'UGC', billboard: 'Billboard' };

async function json(response: Response): Promise<unknown> {
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new Error('Invalid gateway response.');
  return response.json() as Promise<unknown>;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid gateway response.');
  return value as Record<string, unknown>;
}
function gatewayAvailable(): boolean {
  return navigator.onLine && gatewayOriginSupported();
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

export function decodeLegacyWaits(value: unknown): { waits: LegacyWait[]; hasMore: boolean } {
  const body = record(value);
  if (!Array.isArray(body.waits) || body.waits.length > 100 || typeof body.hasMore !== 'boolean') throw new Error('Invalid legacy wait response.');
  const seen = new Set<string>();
  const waits = body.waits.map((item: unknown) => {
    const entry = record(item), id = entry.clientAttemptId, deadline = entry.retryNotBefore;
    if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id) || seen.has(id) || typeof deadline !== 'number' || !Number.isSafeInteger(deadline) || deadline < 0) throw new Error('Invalid legacy wait response.');
    seen.add(id); return { clientAttemptId: id, retryNotBefore: deadline };
  });
  if (body.hasMore && waits.length === 0) throw new Error('Invalid legacy wait response.');
  return { waits, hasMore: body.hasMore };
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

export function interruptedReviewUnavailable(attempt: StudioAttempt, locks: LockManager | undefined): string | null {
  if (attempt.status !== 'SUBMITTED') return null;
  if (attempt.recoveryLockVersion !== 1) return 'This interrupted submission cannot be reviewed safely because its recovery lock version is missing or unsupported. Preserve its history for owner review.';
  if (!locks || typeof locks.request !== 'function') return 'This interrupted submission requires Web Locks for safe review. Use a supported browser with the same local history.';
  return null;
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
  return typeof seconds === 'number' && Number.isInteger(seconds) && seconds >= 1 && seconds <= STUDIO_MAX_RETRY_AFTER_SECONDS
    ? `${guidance} Wait at least ${seconds} seconds before separately authorizing a new attempt; no automatic retry will occur.`
    : `${guidance} A new attempt requires separate authorization; no automatic retry will occur.`;
}
export function sanitizedStudioFailure(status: number, envelope: Record<string, unknown>, preSend = false): NonNullable<StudioAttempt['failure']> {
  if (status === 429 && envelope.outcome === 'DEFINITIVE_FAILURE' && (envelope.code === 'RATE_LIMITED' || envelope.code === 'PROVIDER_LIMIT')) {
    const seconds = envelope.retryAfterSeconds;
    return { category: envelope.code === 'RATE_LIMITED' ? 'rate_limited' : 'provider_limit',
      ...(typeof seconds === 'number' && Number.isInteger(seconds) && seconds >= 1 && seconds <= STUDIO_MAX_RETRY_AFTER_SECONDS ? { retryAfterSeconds: seconds } : {}) };
  }
  if (preSend) return { category: 'pre_send' };
  if (envelope.outcome === 'DEFINITIVE_FAILURE' && ((status === 409 && (envelope.code === 'ATTEMPT_BUSY' || envelope.code === 'APPROVAL_STALE')) ||
      (status === 503 && envelope.code === 'RECOVERY_REQUIRED'))) return { category: 'pre_send' };
  return { category: sceneFailure(status, envelope).definitive ? 'rejected' : 'unknown' };
}

export function retryableStudioAttempt(attempt: StudioAttempt, attempts: StudioAttempt[]): boolean {
  if (!attempt.styleId || !attempt.sceneContext || !attempt.selectedFactIds || !attempt.productSnapshotFingerprint ||
      attempt.presetVersion !== STUDIO_PRESET_VERSION || attempt.promptVersion !== STUDIO_SCENE_PROMPT_VERSION ||
      attempt.model !== STUDIO_MODEL || attempt.quality !== STUDIO_QUALITY || attempt.size !== STUDIO_SIZE ||
      studioAttemptBlocks(attempt) ||
      !['DEFINITIVE_FAILURE', 'DEFINITIVE_SUCCESS', 'UNKNOWN'].includes(attempt.status)) return false;
  const job = attempts.filter((item) => item.jobId === attempt.jobId);
  if (!job.length || new Set(job.map((item) => item.attemptId)).size !== job.length) return false;
  const parents = new Set(job.map((item) => item.retryOf).filter(Boolean));
  const leaves = job.filter((item) => !parents.has(item.attemptId));
  return leaves.length === 1 && leaves[0].attemptId === attempt.attemptId;
}

function failureText(attempt: StudioAttempt, importedUntrusted: boolean): string {
  if (attempt.status === 'UNKNOWN' || attempt.status === 'SUBMITTED') {
    const seconds = attempt.failure?.retryAfterSeconds;
    const delay = typeof seconds === 'number' && Number.isInteger(seconds) && seconds >= 1 && seconds <= STUDIO_MAX_RETRY_AFTER_SECONDS ? ` A recorded minimum wait of ${seconds} seconds applies after completion.` : '';
    return `Outcome unknown or still in progress; a charge may have occurred.${delay} No automatic retry.`;
  }
  const failure = attempt.failure;
  if (!failure) return 'No categorized reason was recorded for this historical attempt.';
  if (importedUntrusted && failure.category === 'pre_send') return 'This imported record reports that the image request was not sent; this has not been verified. No automatic retry.';
  const labels = { pre_send: 'The image request was not sent.', rejected: 'The image request failed definitively.', rate_limited: 'Local rate limit reached.', provider_limit: 'Provider limit reached; check provider quota and billing.', unknown: 'Outcome unknown; a charge may have occurred.' };
  const text = Object.hasOwn(labels, failure.category) ? labels[failure.category] : 'The failure reason is unavailable.';
  return `${text}${(failure.category === 'rate_limited' || failure.category === 'provider_limit') && Number.isInteger(failure.retryAfterSeconds) && failure.retryAfterSeconds! >= 1 && failure.retryAfterSeconds! <= STUDIO_MAX_RETRY_AFTER_SECONDS ? ` Minimum wait after completion: ${failure.retryAfterSeconds} seconds; waiting does not guarantee success.` : ''} No automatic retry.`;
}
function attemptStatusText(attempt: StudioAttempt, importedUntrusted: boolean): string {
  switch (attempt.status) {
    case 'PREPARED': return importedUntrusted ? 'Imported preparation; sending not verified' : 'Prepared; no image sent';
    case 'SUBMITTED': return 'Outcome unknown (interrupted or in progress)';
    case 'UNKNOWN': return 'Outcome unknown';
    case 'DEFINITIVE_FAILURE': return attempt.failure?.category === 'pre_send' ? (importedUntrusted ? 'Reported not sent; unverified' : 'Not sent') : 'Generation failed';
    case 'DEFINITIVE_SUCCESS': return 'Scene generated; unapproved';
  }
}
export async function decodeScene(value: unknown, attemptId: string): Promise<{ blob: Blob; hash: string; usage: Record<string, unknown> | null; observedUSD: string | null; pricingSnapshot?: string }> {
  const result = record(value), image = record(result.image);
  if (result.clientAttemptId !== attemptId || result.outcome !== 'DEFINITIVE_SUCCESS' || result.model !== STUDIO_MODEL || image.mimeType !== 'image/png' || image.width !== 1024 || image.height !== 1024 || typeof image.dataBase64 !== 'string' || image.dataBase64.length > Math.ceil(STUDIO_MAX_PNG_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image.dataBase64) || !image.dataBase64.length || (result.usage !== null && (typeof result.usage !== 'object' || Array.isArray(result.usage))) || (result.observedUSD !== null && (typeof result.observedUSD !== 'string' || !/^\d+\.\d{1,6}$/.test(result.observedUSD)))) throw new Error('The returned scene response is invalid.');
  if (result.observedUSD === null ? result.pricingSnapshot !== undefined : result.pricingSnapshot !== STUDIO_PRICING_SNAPSHOT || studioObservedUSD(result.usage) !== result.observedUSD) throw new Error('The returned usage estimate is invalid.');
  const raw = atob(image.dataBase64), bytes = Uint8Array.from(raw, (char) => char.charCodeAt(0));
  if (bytes.byteLength > STUDIO_MAX_PNG_BYTES) throw new Error('The returned scene exceeds the size limit.');
  const header = inspectImageHeader(bytes);
  if (header.mimeType !== 'image/png' || header.width !== 1024 || header.height !== 1024 || header.orientation !== 1) throw new Error('The returned scene is not the expected PNG.');
  const blob = new Blob([bytes], { type: 'image/png' });
  const bitmap = await createImageBitmap(blob);
  try { if (bitmap.width !== 1024 || bitmap.height !== 1024) throw new Error('The decoded scene dimensions do not match.'); }
  finally { bitmap.close(); }
  return { blob, hash: await sha256(bytes), usage: result.usage as Record<string, unknown> | null, observedUSD: result.observedUSD as string | null, ...(result.pricingSnapshot === undefined ? {} : { pricingSnapshot: result.pricingSnapshot as string }) };
}

function Scene({ asset }: { asset: StudioAsset }) {
  const [url, setUrl] = useState('');
  useEffect(() => { const next = URL.createObjectURL(asset.blob); setUrl(next); return () => URL.revokeObjectURL(next); }, [asset]);
  return url ? <img className="studio-scene" src={url} alt="Unapproved generated empty scene" /> : null;
}

function Original({ product, attempt }: { product: Product; attempt: StudioAttempt }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let active = true, objectUrl = '';
    setUrl('');
    const source = product.sourceAssets.find((item) => item.assetId === attempt.sourceAssetId && item.sha256 === attempt.sourceSha256);
    if (source) void loadOriginalSource(product.productId, source).then((blob) => {
      if (active) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); }
    }).catch(() => { if (active) setUrl(''); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [product, attempt.sourceAssetId, attempt.sourceSha256]);
  return url ? <img className="studio-scene" src={url} alt="Original product photograph" /> : <p>Original source unavailable or no longer matches this attempt.</p>;
}

function SceneDisclosure({ product, attempt, asset, disabled }: { product: Product; attempt: StudioAttempt; asset: StudioAsset; disabled: boolean }) {
  const [visited, setVisited] = useState(false);
  return <details className="studio-scene-disclosure" onToggle={(event) => { if (event.currentTarget.open) setVisited(true); }}>
    <summary>View scene and compose product</summary>
    {visited && <><p>Original product photograph compared with the unapproved generated empty scene. The scene alone is not the product; the original product must be composed and reviewed locally.</p><div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}><figure style={{ flex: '1 1 16rem', minWidth: 0 }}><figcaption>Original product photograph</figcaption><Original product={product} attempt={attempt} /></figure><figure style={{ flex: '1 1 16rem', minWidth: 0 }}><figcaption>Unapproved generated empty scene</figcaption><Scene asset={asset} /></figure></div><StrictCompositePanel productId={product.productId} productVersion={JSON.stringify(product)} attemptId={attempt.attemptId} scene={asset} disabled={disabled} /></>}
  </details>;
}

function CompositeComparison({ productId, productVersion, leftAttempt, rightAttempt }: { productId: string; productVersion: string; leftAttempt: string; rightAttempt: string }) {
  const [outputs, setOutputs] = useState<[StrictComposite[], StrictComposite[]] | null>(null);
  const [left, setLeft] = useState('');
  const [right, setRight] = useState('');
  const [version, setVersion] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setOutputs(null); setLeft(''); setRight(''); setError('');
    void Promise.all([listStrictComposites(productId, leftAttempt), listStrictComposites(productId, rightAttempt)])
      .then(([a, b]) => { if (active) { setOutputs([a, b]); setLeft(a[0]?.assetId ?? ''); setRight(b[0]?.assetId ?? ''); } })
      .catch(() => { if (active) setError('Saved composites could not be verified. Reload or review their history.'); });
    return () => { active = false; };
  }, [productId, productVersion, leftAttempt, rightAttempt, version]);
  const selected = outputs && [outputs[0].find((item) => item.assetId === left), outputs[1].find((item) => item.assetId === right)];
  return <div className="studio-composite-comparison"><h4>Compare saved product composites</h4>
    <p>These are saved snapshots, not approval decisions. Review each original, mask, labels and current QA separately before export.</p>
    <button type="button" className="secondary-button" onClick={() => setVersion((value) => value + 1)}>Refresh saved composites</button>
    {error ? <p className="error-message" role="alert">{error}</p> : !outputs ? <p role="status">Checking saved composites…</p> : <>
      {outputs.map((items, index) => <label key={index}>{index === 0 ? 'First' : 'Second'} saved composite
        <select value={index === 0 ? left : right} onChange={(event) => index === 0 ? setLeft(event.target.value) : setRight(event.target.value)}>
          {!items.length && <option value="">No saved composite for this attempt</option>}
          {items.map((item) => <option key={item.assetId} value={item.assetId}>{item.assetId} · {item.sha256.slice(0, 12)}</option>)}
        </select></label>)}
      {selected && selected[0] && selected[1] && <div className="studio-compare-results">{selected.map((item) => <figure key={item!.assetId}><figcaption>Saved STRICT composite · {item!.assetId} · SHA-256 {item!.sha256}</figcaption><LocalImage blob={item!.blob} alt={`Saved product composite ${item!.assetId}`} /></figure>)}</div>}
    </>}
  </div>;
}
function initialBudgetSession(): string | null {
  try {
    let id = sessionStorage.getItem('studio-budget-session');
    if (id !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return null;
    if (id === null) {
      id = crypto.randomUUID();
      sessionStorage.setItem('studio-budget-session', id);
    }
    return id;
  } catch { return null; }
}

function moneyUnits(value: string): bigint {
  const [whole, fraction] = value.split('.');
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
}
function moneyString(value: bigint): string {
  return `${value / 1_000_000n}.${String(value % 1_000_000n).padStart(6, '0')}`;
}


export function StudioPanel({ product, onBusyChange }: { product: Product; onBusyChange: (busy: boolean) => void }) {
  const location = useLocation();
  const focusedHistoryKey = useRef<string | null>(null);
  const [gateway, setGateway] = useState<Gateway>('checking');
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [attentionOnly, setAttentionOnly] = useState(false);
  const attentionFilter = useRef<HTMLButtonElement>(null);
  const reviewedFocus = useRef<string | null>(null);
  const [otherBlockers, setOtherBlockers] = useState<Awaited<ReturnType<typeof listOtherStudioBlockers>> | null>(null);
  const [reviewFingerprint, setReviewFingerprint] = useState<string | null>(null);
  const [max, setMax] = useState(() => { try { return sessionStorage.getItem('studio-attempt-limit') ?? ''; } catch { return ''; } });
  const [budgetSessionId, setBudgetSessionId] = useState(initialBudgetSession);
  const [sessionTotal, setSessionTotal] = useState<string | null>(null);
  const [sessionLimit, setSessionLimit] = useState(() => { try { return sessionStorage.getItem('studio-session-limit') ?? ''; } catch { return ''; } });
  const [sources, setSources] = useState<SourceOption[] | null>(null);
  const [selectedStyles, setSelectedStyles] = useState<StudioStyleId[]>(['studio']);
  const [sourceByStyle, setSourceByStyle] = useState<Partial<Record<StudioStyleId, string>>>({});
  const [selectedFacts, setSelectedFacts] = useState<string[]>(() => product.facts.filter((fact) => fact.confirmed).map((fact) => fact.factId));
  const [retry, setRetry] = useState<StudioAttempt | null>(null);
  const [compareLeft, setCompareLeft] = useState('');
  const [compareRight, setCompareRight] = useState('');
  const [styleConsent, setStyleConsent] = useState<Partial<Record<StudioStyleId, boolean>>>({});
  const [attemptOverrides, setAttemptOverrides] = useState<Partial<Record<StudioStyleId, boolean>>>({});
  const [sessionOverrides, setSessionOverrides] = useState<Partial<Record<StudioStyleId, boolean>>>({});
  const [topConfirmed, setTopConfirmed] = useState(false);
  const [legacyConfirmed, setLegacyConfirmed] = useState<Record<string, boolean>>({});
  const [reviewConfirmed, setReviewConfirmed] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const running = useRef(false);
  const gatewayCheck = useRef(0);
  const mounted = useRef(false);
  const retryHeading = useRef<HTMLHeadingElement>(null);
  const retryFocusOrigin = useRef<Element | null>(null);
  const retryError = useRef<HTMLParagraphElement>(null);
  const retryErrorFocusOrigin = useRef<Element | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const origin = retryFocusOrigin.current;
    retryFocusOrigin.current = null;
    if (retry && origin && (document.activeElement === origin || document.activeElement === document.body)) {
      retryHeading.current?.scrollIntoView({ block: 'start' });
      retryHeading.current?.focus({ preventScroll: true });
    }
  }, [retry]);
  useEffect(() => {
    const origin = retryErrorFocusOrigin.current;
    retryErrorFocusOrigin.current = null;
    if (error && origin && (document.activeElement === origin || document.activeElement === document.body)) {
      retryError.current?.scrollIntoView({ block: 'start' });
      retryError.current?.focus({ preventScroll: true });
    }
  }, [error]);
  useUnsavedChanges(busy || topConfirmed || Object.values(styleConsent).some(Boolean) || Object.values(attemptOverrides).some(Boolean) || Object.values(sessionOverrides).some(Boolean) || Object.values(reviewConfirmed).some(Boolean) || Object.values(legacyConfirmed).some(Boolean));
  const localBlockers = entries?.filter((entry) => entry.importedUntrusted ? entry.importedUnresolved : studioAttemptBlocks(entry.attempt)) ?? [];
  const unresolved = otherBlockers === null || otherBlockers.length > 0 || localBlockers.length > 0;
  useEffect(() => {
    if (busy || reviewedFocus.current === null || entries === null) return;
    const id = reviewedFocus.current;
    reviewedFocus.current = null;
    if (attentionOnly && !localBlockers.some((entry) => entry.attempt.attemptId === id) && document.activeElement === document.body) {
      attentionFilter.current?.focus();
    }
  }, [busy, entries, attentionOnly]);
  function rememberReviewFocus(id: string) {
    const active = document.activeElement;
    reviewedFocus.current = attentionOnly && active instanceof HTMLElement && active.closest('[data-attempt-id]')?.getAttribute('data-attempt-id') === id ? id : null;
  }

  const validMoney = (value: string) => !value || /^\d{1,9}\.\d{1,6}$/.test(value);
  let plans: PlannedStyle[] = [];
  let planError = '';
  try {
    if (!validMoney(max) || !validMoney(sessionLimit)) throw new Error('Enter valid decimal estimate limits, with at most six fractional digits.');
    if (sources && sessionTotal !== null) {
      let prior = moneyUnits(sessionTotal);
      plans = selectedStyles.map((styleId) => {
        const input = sources.find((item) => item.source.assetId === sourceByStyle[styleId]) ?? sources[0];
        if (!input) throw new Error('Save a verified mask for a source before selecting a style.');
        const context = studioSceneContext(product, input.source, selectedFacts);
        if (styleId === 'flat_lay' && context.sourceView === 'UNKNOWN') throw new Error('Flat Lay requires a known source viewpoint before a chargeable attempt.');
        const prompt = studioBuildPrompt(styleId, context);
        const estimate = studioEstimateUSD(prompt);
        const perAttemptOverride = Boolean(max && moneyUnits(estimate) > moneyUnits(max));
        const sessionOverride = Boolean(sessionLimit && prior + moneyUnits(estimate) > moneyUnits(sessionLimit));
        const plan = { styleId, input, context, prompt, estimate, prior: moneyString(prior), perAttemptOverride, sessionOverride };
        prior += moneyUnits(estimate);
        return plan;
      });
    }
    if (retry && (plans.length !== 1 || !retryableStudioAttempt(retry, entries?.map((entry) => entry.attempt) ?? []) ||
        plans[0].styleId !== retry.styleId || plans[0].input.source.assetId !== retry.sourceAssetId ||
        plans[0].input.source.sha256 !== retry.sourceSha256 || plans[0].input.maskId !== retry.maskId ||
        plans[0].input.maskSha256 !== retry.maskSha256 || plans[0].prompt !== retry.prompt ||
        JSON.stringify(plans[0].context) !== JSON.stringify(retry.sceneContext) ||
        JSON.stringify(selectedFacts) !== JSON.stringify(retry.selectedFactIds))) {
      throw new Error('The original retry inputs or history changed. Start a new job instead.');
    }
  } catch (reason) { plans = []; planError = reason instanceof Error ? reason.message : 'The style selection is invalid.'; }
  const plannedTotal = moneyString(plans.reduce((sum, plan) => sum + moneyUnits(plan.estimate), 0n));
  const ready = plans.length > 0 && plans.every((plan) => styleConsent[plan.styleId] &&
    (!plan.perAttemptOverride || attemptOverrides[plan.styleId]) && (!plan.sessionOverride || sessionOverrides[plan.styleId]) &&
    (plan.styleId !== 'flat_lay' || plan.context.sourceView !== 'TOP' || topConfirmed));
  const missingStyleConsent = plans.filter((plan) => !styleConsent[plan.styleId]);
  function clearQueueConsent() { setStyleConsent({}); setAttemptOverrides({}); setSessionOverrides({}); setTopConfirmed(false); }

  async function refreshGateway() {
    const check = ++gatewayCheck.current;
    clearQueueConsent();
    if (!gatewayOriginSupported()) { setGateway('unsupported-origin'); return; }
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
      const waitsResponse = await request('/images/legacy-waits', { headers: { 'X-CSRF-Token': auth.csrfToken } });
      if (!waitsResponse.ok) throw new Error();
      const legacy = decodeLegacyWaits(await json(waitsResponse));
      update({ csrf: auth.csrfToken, reviewRevision, legacyWaits: legacy.waits, hasMoreLegacyWaits: legacy.hasMore });
    } catch { update('unavailable'); }
  }
  async function refreshEntries() {
    setReviewFingerprint(null);
    const [value, fingerprint, total, blockers] = await Promise.all([listStudioAttempts(product.productId), globalStudioReviewFingerprint(), budgetSessionId ? studioSessionEstimate(budgetSessionId) : Promise.resolve(null), listOtherStudioBlockers(product.productId)]);
    setEntries(value); setReviewFingerprint(fingerprint); setSessionTotal(total); setOtherBlockers(blockers);
  }
  useEffect(() => {
    let active = true;
    setEntries(null); setOtherBlockers(null); setReviewFingerprint(null); setSessionTotal(null); clearQueueConsent();
    Promise.all([listStudioAttempts(product.productId), globalStudioReviewFingerprint(), budgetSessionId ? studioSessionEstimate(budgetSessionId) : Promise.resolve(null), listOtherStudioBlockers(product.productId)]).then(([value, fingerprint, total, blockers]) => { if (active) { setEntries(value); setReviewFingerprint(fingerprint); setSessionTotal(total); setOtherBlockers(blockers); } }).catch((reason: unknown) => { if (active) setError(reason instanceof Error && reason.message.startsWith('The local attempt history has inconsistent') ? reason.message : 'Local attempt history is unavailable. Generation is disabled. Preserve your local data and backups; seek recovery assistance.'); });
    void refreshGateway();
    const offline = () => { gatewayCheck.current++; clearQueueConsent(); setGateway(gatewayOriginSupported() ? 'unavailable' : 'unsupported-origin'); };
    window.addEventListener('offline', offline);
    return () => { active = false; gatewayCheck.current++; window.removeEventListener('offline', offline); };
  }, [product.productId, budgetSessionId]);

  useEffect(() => {
    if (location.hash !== '#studio-history-heading' || entries === null || focusedHistoryKey.current === location.key) return;
    const heading = document.getElementById('studio-history-heading');
    if (!heading) return;
    focusedHistoryKey.current = location.key;
    heading.scrollIntoView({ block: 'start' });
    heading.focus({ preventScroll: true });
  }, [entries, location.hash, location.key]);

  const productVersion = JSON.stringify(product);
  useEffect(() => {
    let active = true;
    setSources(null); setSourceByStyle({}); setSelectedFacts(product.facts.filter((fact) => fact.confirmed).map((fact) => fact.factId)); clearQueueConsent();
    void listStyleInputs(product.productId).then((items) => { if (active) setSources(items); })
      .catch((reason: unknown) => { if (active) { setSources([]); setError(reason instanceof Error ? reason.message : 'Sources could not be checked.'); } });
    return () => { active = false; };
  }, [productVersion]);

  async function reviewLegacyWait(id: string) {
    if (running.current || typeof gateway !== 'object' || !legacyConfirmed[id] || !gateway.legacyWaits.some((item) => item.clientAttemptId === id)) return;
    gatewayCheck.current++; running.current = true; onBusyChange(true); setBusy(true); setError(''); setNotice(''); clearQueueConsent();
    try {
      const response = await request(`/images/attempts/${id}/legacy-wait-review`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': gateway.csrf },
        body: JSON.stringify({ reviewedProviderWait: true, reviewRevision: gateway.reviewRevision }),
      });
      if (!response.ok) throw new Error(response.status === 409 ? 'Review state changed. Check the gateway and confirm again.' : 'Legacy wait review could not be recorded. Check your session and try again.');
      const receipt = record(await json(response));
      if (receipt.clientAttemptId !== id || typeof receipt.retryNotBefore !== 'number' || !Number.isSafeInteger(receipt.retryNotBefore) || receipt.retryNotBefore < 0 || typeof receipt.reviewedAt !== 'string' || !Number.isFinite(Date.parse(receipt.reviewedAt))) throw new Error('Invalid review receipt. Check the gateway before continuing.');
      setLegacyConfirmed((old) => ({ ...old, [id]: false }));
      setNotice('Legacy wait review recorded. The saved deadline may still block generation; a new attempt requires separate authorization.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Legacy wait review failed.'); }
    finally { await refreshGateway(); running.current = false; onBusyChange(false); setBusy(false); }
  }

  async function review(attempt: StudioAttempt) {
    if (running.current || entries?.find((entry) => entry.attempt.attemptId === attempt.attemptId)?.importedUntrusted || !studioAttemptBlocks(attempt) || !reviewConfirmed[attempt.attemptId] || typeof gateway !== 'object' || !((attempt.status === 'UNKNOWN' || attempt.status === 'SUBMITTED') || ((attempt.status === 'DEFINITIVE_SUCCESS' || attempt.status === 'DEFINITIVE_FAILURE') && attempt.cleanupPending === true))) return;
    rememberReviewFocus(attempt.attemptId);
    gatewayCheck.current++;
    running.current = true; onBusyChange(true); setBusy(true); setError(''); setNotice(''); clearQueueConsent(); setGateway('checking');
    try {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(attempt.attemptId)) throw new Error('This attempt has an invalid ID and cannot be reviewed.');
      await withStudioReviewLock(attempt, navigator.locks, async () => {
        const saved = (await listStudioAttempts(product.productId)).find((entry) => entry.attempt.attemptId === attempt.attemptId);
        const current = saved?.attempt;
        if (!current || saved?.importedUntrusted || current.status !== attempt.status || !studioAttemptBlocks(current) ||
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
      reviewedFocus.current = null;
      try { await refreshEntries(); } catch { setEntries(null); }
      setError(reason instanceof Error ? reason.message : 'Review could not be saved. See the current history.');
    } finally {
      await refreshGateway();
      running.current = false; onBusyChange(false); setBusy(false);
    }
  }

  async function reviewImported(attempt: StudioAttempt) {
    const entry = entries?.find((item) => item.attempt.attemptId === attempt.attemptId);
    if (running.current || !entry?.importedUnresolved || !reviewConfirmed[attempt.attemptId]) return;
    rememberReviewFocus(attempt.attemptId);
    running.current = true; onBusyChange(true); setBusy(true); setError(''); setNotice(''); clearQueueConsent();
    try {
      await resolveImportedUncertainty(attempt.attemptId);
      await refreshEntries();
      setReviewConfirmed((current) => ({ ...current, [attempt.attemptId]: false }));
      setNotice('Local review recorded. The imported outcome remains unchanged; the gateway was not contacted. A new job still needs separate authorization and may be blocked by its gateway journal.');
    } catch (reason) {
      reviewedFocus.current = null;
      try { await refreshEntries(); } catch { setEntries(null); }
      setError(reason instanceof Error ? reason.message : 'The imported uncertainty could not be reviewed.');
    } finally { running.current = false; onBusyChange(false); setBusy(false); }
  }

  async function prepareRetry(previous: StudioAttempt) {
    if (running.current || busy) return;
    const focusOrigin = document.activeElement;
    running.current = true; setBusy(true); onBusyChange(true); setError(''); setNotice(''); clearQueueConsent(); setRetry(null);
    try {
      const [history, input, hash] = await Promise.all([
        listStudioAttempts(product.productId), studioInput(product.productId, previous.sourceAssetId), productSnapshotFingerprint(product),
      ]);
      const saved = history.find((entry) => entry.attempt.attemptId === previous.attemptId);
      const current = saved?.attempt;
      if (!current || saved?.importedUntrusted || !retryableStudioAttempt(current, history.map((entry) => entry.attempt)) ||
          hash !== current.productSnapshotFingerprint || input.source.sha256 !== current.sourceSha256 ||
          input.maskId !== current.maskId || input.maskSha256 !== current.maskSha256 ||
          !current.styleId || !current.selectedFactIds ||
          JSON.stringify(studioSceneContext(product, input.source, current.selectedFactIds)) !== JSON.stringify(current.sceneContext) ||
          studioBuildPrompt(current.styleId, current.sceneContext!) !== current.prompt) {
        throw new Error('This retry is no longer eligible or its original inputs have changed. Start a new job instead.');
      }
      setEntries(history); setSelectedStyles([current.styleId]); setSourceByStyle({ [current.styleId]: current.sourceAssetId });
      setSelectedFacts([...current.selectedFactIds]); retryFocusOrigin.current = focusOrigin; setRetry(current);
      setNotice('Retry loaded for review only. No request has been sent; fresh consent and gateway approval are required.');
    } catch {
      retryErrorFocusOrigin.current = focusOrigin;
      setError('This retry is no longer eligible or its original inputs are unavailable or changed. Start a new job instead.');
      try { await refreshEntries(); } catch { setEntries(null); }
    } finally { running.current = false; setBusy(false); onBusyChange(false); }
  }

  async function generate(event: FormEvent) {
    event.preventDefault();
    if (running.current || unresolved || !ready || planError || entries === null || typeof gateway !== 'object' || gateway.legacyWaits.length > 0 ||
        !budgetSessionId || sessionTotal === null || reviewFingerprint === null || !navigator.locks) return;
    const gate = gateway, fingerprint = reviewFingerprint, initialTotal = sessionTotal;
    const chosen = plans.map((plan) => ({ ...plan, context: structuredClone(plan.context) }));
    const factIds = [...selectedFacts];
    running.current = true; onBusyChange(true); setBusy(true); setError(''); setNotice('');
    const prepared: StudioAttempt[] = [];
    const pending = new Map<string, StudioAttempt>();
    const ensureOpen = () => { if (!mounted.current) throw new Error('The workspace was closed; no further style will be sent.'); };
    try {
      if (!gatewayAvailable()) throw new Error('Offline or local gateway unavailable. No request was sent.');
      if (await studioSessionEstimate(budgetSessionId) !== initialTotal) throw new Error('The session estimate changed. Review the updated total and authorize again.');
      const productHash = await productSnapshotFingerprint(product);
      if (retry && productHash !== retry.productSnapshotFingerprint) throw new Error('Product or facts changed. Start a new job instead.');
      for (const plan of chosen) {
        ensureOpen();
        const input = await studioInput(product.productId, plan.input.source.assetId);
        if (input.maskId !== plan.input.maskId || input.maskSha256 !== plan.input.maskSha256 || input.source.sha256 !== plan.input.source.sha256) {
          throw new Error('A source or mask changed. Review the queue again; no image request was sent.');
        }
        const attempt: StudioAttempt = {
          attemptId: crypto.randomUUID(), jobId: retry?.jobId ?? crypto.randomUUID(), productId: product.productId,
          ...(retry ? { retryOf: retry.attemptId } : {}),
          sourceAssetId: input.source.assetId, sourceSha256: input.source.sha256, maskId: input.maskId, maskSha256: input.maskSha256,
          styleId: plan.styleId, presetVersion: STUDIO_PRESET_VERSION, sceneContext: plan.context,
          productSnapshotFingerprint: productHash, selectedFactIds: factIds,
          ...(plan.styleId === 'flat_lay' && plan.context.sourceView === 'TOP' ? { topViewConfirmed: true as const } : {}),
          prompt: plan.prompt, promptVersion: STUDIO_SCENE_PROMPT_VERSION, model: STUDIO_MODEL, quality: STUDIO_QUALITY, size: STUDIO_SIZE,
          estimatedUSD: plan.estimate, ...(max ? { maxEstimatedUSD: max } : {}), ...(plan.perAttemptOverride ? { softLimitOverride: true as const } : {}),
          budgetSessionId, sessionPriorUSD: plan.prior, ...(sessionLimit ? { sessionLimitUSD: sessionLimit } : {}),
          ...(plan.sessionOverride ? { sessionLimitOverride: true as const } : {}),
          submittedAt: new Date().toISOString(), status: 'PREPARED', usage: null, observedUSD: null, recoveryLockVersion: 1,
        };
        await createStudioAttempt(attempt, fingerprint);
        prepared.push(attempt);
        pending.set(attempt.attemptId, attempt);
      }
      const expectedTotal = moneyString(moneyUnits(initialTotal) + chosen.reduce((sum, plan) => sum + moneyUnits(plan.estimate), 0n));
      if (await studioSessionEstimate(budgetSessionId) !== expectedTotal) throw new Error('The session estimate changed while preparing the queue. No image request was sent.');
      await refreshEntries();
      for (let index = 0; index < prepared.length; index++) {
        ensureOpen();
        let attempt = prepared[index], submitted = false, savedOutcome = false, savedSuccess = false;
        let failureDetail: NonNullable<StudioAttempt['failure']> = { category: 'pre_send' };
        const plan = chosen[index], id = attempt.attemptId;
        setNotice(`Waiting for the local image-request lock for ${STYLE_LABELS[plan.styleId]} (${index + 1} of ${prepared.length}); later styles remain prepared.`);
        await navigator.locks.request('studio-origin-dispatch-v1', { mode: 'exclusive' }, () => withStudioAttemptLock(id, navigator.locks, async () => {
          ensureOpen();
          setNotice(`Submitting ${STYLE_LABELS[plan.styleId]} (${index + 1} of ${prepared.length}); later styles remain prepared.`);
          try {
            const body = { clientAttemptId: id, productId: product.productId, styleId: plan.styleId, lockMode: 'STRICT', operation: 'generate_scene',
              model: STUDIO_MODEL, quality: STUDIO_QUALITY, size: STUDIO_SIZE, prompt: plan.prompt, promptVersion: STUDIO_SCENE_PROMPT_VERSION,
              presetVersion: STUDIO_PRESET_VERSION, sceneContext: plan.context, sourceAssetHashes: [attempt.sourceSha256], estimatedUSD: plan.estimate,
              ...(max ? { maxEstimatedUSD: max } : {}), ...(plan.perAttemptOverride ? { softLimitOverride: true } : {}), sessionPriorUSD: plan.prior,
              ...(sessionLimit ? { sessionLimitUSD: sessionLimit } : {}), ...(plan.sessionOverride ? { sessionLimitOverride: true } : {}),
              outputFormat: 'png', reviewRevision: gate.reviewRevision };
            const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': gate.csrf };
            ensureOpen();
            const approvalResponse = await request('/images/approvals', { method: 'POST', headers, body: JSON.stringify(body) });
            if (!approvalResponse.ok) {
              let message: string | null = null;
              try {
                const envelope = record(record(await json(approvalResponse)).error);
                const failure = approvalFailure(approvalResponse.status, envelope);
                failureDetail = sanitizedStudioFailure(approvalResponse.status, envelope, true);
                if (failure.stale) { gatewayCheck.current++; setGateway('unavailable'); }
                message = failure.message;
              } catch { /* use safe generic message */ }
              throw new Error(message ?? 'Authorization was not granted. No image request was sent.');
            }
            const approval = record(await json(approvalResponse));
            if (typeof approval.approvalId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(approval.approvalId) ||
                typeof approval.expiresAt !== 'string' || !Number.isFinite(Date.parse(approval.expiresAt)) || Date.parse(approval.expiresAt) <= Date.now()) {
              throw new Error('Invalid or expired authorization. No image request was sent.');
            }
            ensureOpen();
            attempt = { ...attempt, status: 'SUBMITTED' };
            await updateStudioAttempt(attempt, undefined, fingerprint, expectedTotal);
            pending.delete(id);
            if (!mounted.current) {
              attempt = { ...attempt, status: 'DEFINITIVE_FAILURE', failure: { category: 'pre_send' } };
              await updateStudioAttempt(attempt);
              savedOutcome = true;
              throw new Error('The workspace was closed before the image request was sent.');
            }
            submitted = true;
            const response = await request('/images/generate', { method: 'POST', headers: { ...headers, 'X-Client-Request-Id': id, 'X-Attempt-Approval': approval.approvalId }, body: JSON.stringify(body) });
            if (!response.ok) {
              let failure = { definitive: false, message: 'The image attempt outcome is UNKNOWN. A charge may have occurred; it will not be resent automatically.' };
              try {
                const envelope = record(record(await json(response)).error);
                failure = sceneFailure(response.status, envelope);
                failureDetail = sanitizedStudioFailure(response.status, envelope);
                if (response.status === 409 && envelope.code === 'APPROVAL_STALE' && failure.definitive) { gatewayCheck.current++; setGateway('unavailable'); }
              } catch { /* malformed failure is ambiguous */ }
              attempt = { ...attempt, status: failure.definitive ? 'DEFINITIVE_FAILURE' : 'UNKNOWN', failure: failure.definitive ? failureDetail : { category: 'unknown' },
                ...(failure.definitive && cleanupPending(response.headers) ? { cleanupPending: true as const } : {}) };
              await updateStudioAttempt(attempt);
              savedOutcome = true;
              throw new Error(failure.message);
            }
            const scene = await decodeScene(await json(response), id);
            attempt = { ...attempt, status: 'DEFINITIVE_SUCCESS', usage: scene.usage, observedUSD: scene.observedUSD,
              ...(scene.pricingSnapshot === undefined ? {} : { pricingSnapshot: scene.pricingSnapshot }),
              ...(cleanupPending(response.headers) ? { cleanupPending: true as const } : {}) };
            await updateStudioAttempt(attempt, { assetId: crypto.randomUUID(), attemptId: id, productId: product.productId, blob: scene.blob, sha256: scene.hash });
            savedSuccess = true;
            if (studioAttemptBlocks(attempt)) throw new Error('The gateway requires explicit review before another style can run.');
          } catch (reason) {
            if (!savedSuccess && !savedOutcome) {
              const { pricingSnapshot: _pricing, cleanupPending: _cleanup, ...base } = attempt;
              const knownDelay = (failureDetail.category === 'rate_limited' || failureDetail.category === 'provider_limit') ? failureDetail.retryAfterSeconds : undefined;
              attempt = { ...base, status: submitted ? 'UNKNOWN' : 'DEFINITIVE_FAILURE', failure: submitted ? { category: 'unknown', ...(knownDelay === undefined ? {} : { retryAfterSeconds: knownDelay }) } : failureDetail, usage: null, observedUSD: null };
              try { await updateStudioAttempt(attempt); pending.delete(id); } catch { /* preserve interrupted evidence; never resend */ }
            }
            if (submitted && attempt.status === 'UNKNOWN') throw new Error('The outcome is UNKNOWN or could not be saved. A charge may have occurred; the remaining queue was not sent and no automatic retry will occur.');
            throw reason;
          }
        }));
        await refreshEntries();
      }
      setNotice(`${prepared.length} independent scene attempts completed. Each result remains unapproved until local composition and human review.`);
    } catch (reason) {
      setNotice('');
      setError(`${reason instanceof Error ? reason.message : 'The queue could not continue.'} Remaining prepared styles were not automatically sent.`);
    } finally {
      for (const item of pending.values()) {
        try { await updateStudioAttempt({ ...item, status: 'DEFINITIVE_FAILURE', failure: { category: 'pre_send' } }); } catch { /* Keep unresolved local evidence for manual review. */ }
      }
      clearQueueConsent();
      if (prepared.length) setRetry(null);
      try { await refreshEntries(); } catch { setEntries(null); setError('Local attempt history could not be read. Generation is disabled.'); }
      running.current = false; onBusyChange(false); setBusy(false);
    }
  }

  async function closePrepared(attempt: StudioAttempt) {
    if (busy || entries?.find((entry) => entry.attempt.attemptId === attempt.attemptId)?.importedUntrusted || attempt.status !== 'PREPARED' || !navigator.locks) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await withStudioAttemptLock(attempt.attemptId, navigator.locks, () => updateStudioAttempt({ ...attempt, status: 'DEFINITIVE_FAILURE', failure: { category: 'pre_send' } }));
      await refreshEntries();
      setNotice('The prepared attempt was closed without sending an image request. A new attempt requires separate authorization.');
    } catch {
      await refreshEntries().catch(() => { setEntries(null); });
      setError('The attempt could not be closed; its state may have changed in another tab. Review the history before proceeding.');
    } finally { setBusy(false); }
  }
  const scenes = (entries ?? []).filter((entry) => entry.attempt.styleId && entry.attempt.status === 'DEFINITIVE_SUCCESS' && entry.asset);
  const leftScene = scenes.find((entry) => entry.attempt.attemptId === compareLeft);
  const rightScene = scenes.find((entry) => entry.attempt.attemptId === compareRight && entry.attempt.styleId === leftScene?.attempt.styleId && entry.attempt.attemptId !== compareLeft);


  return <section className="product-section studio-panel" aria-labelledby="studio-heading">
    <span className="section-kicker">STRICT STYLE QUEUE</span><h2 id="studio-heading">Generate style scenes</h2>
    <p>Each selected style is an independent, potentially billable attempt. The original image and mask remain local; the product name, category and selected confirmed facts shown in each prompt are sent to the provider. Do not include secrets or information you do not want to share.</p>
    <p><strong>Backup warning:</strong> Full backups include generated scenes, local review records, prompts, cost estimates and other project history. ZIP files are not encrypted; protect them as sensitive data.</p>
    <p>Planned calls: <strong>{selectedStyles.length}</strong>; estimated total: <strong>{planError || !sources || sessionTotal === null ? 'unavailable' : `$${plannedTotal} USD`}</strong>. One call per selected scene; no automatic retry. Estimate only, not a cap or invoice. Model {STUDIO_MODEL}, {STUDIO_QUALITY}, {STUDIO_SIZE}, PNG; pricing snapshot 2026-10-29. <a href="https://developers.openai.com/api/docs/guides/image-generation" target="_blank" rel="noreferrer">Pricing evidence</a>.</p>
    {gateway === 'checking' ? <p role="status">Checking local gateway…</p> : gateway === 'unavailable' ? <p role="status">Offline or local gateway unavailable. Generation is disabled.</p> : gateway === 'unsupported-origin' ? <p role="status">{unsupportedGatewayMessage} Generation is disabled.</p> : gateway === 'signed-out' ? <p>Sign in to the local app in provider settings first.</p> : gateway === 'disconnected' ? <p>Connect the configured provider session in settings first.</p> : <p>Local app and provider session active.</p>}
    {!navigator.locks && <p>Web Locks are unavailable in this browser. Generation and review of interrupted submissions are disabled; existing UNKNOWN attempts can still be reviewed.</p>}
    {entries === null && error && <p id="studio-error" ref={retryError} tabIndex={-1} className="error-message" role="alert">{error}</p>}
    {localBlockers.length > 0 && <p role="status">{localBlockers.length} {localBlockers.length === 1 ? 'attempt in this project needs' : 'attempts in this project need'} attention before generation. <Link to={{ pathname: location.pathname, hash: '#studio-history-heading' }}>Open local attempt history</Link>.</p>}
    {otherBlockers && otherBlockers.length > 0 && <section aria-labelledby="other-blockers-heading">
      <h3 id="other-blockers-heading">Attempts in other projects need attention</h3>
      <p>Generation is blocked across this browser workspace until these attempts are reviewed. Open each project and check its local attempt history; a gateway may also have its own separate restrictions. After reviewing in another tab, refresh this list.</p>
      <ul>{otherBlockers.map((item) => <li key={item.productId}>{item.name ? <Link to={`/products/${encodeURIComponent(item.productId)}#studio-history-heading`}>{item.name}</Link> : `Missing project ${item.productId}: preserve local data and seek recovery assistance`} — {item.count} {item.count === 1 ? 'attempt' : 'attempts'}</li>)}</ul>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => { clearQueueConsent(); setOtherBlockers(null); void refreshEntries().catch(() => { setEntries(null); setError('Local attempt history is unavailable. Generation is disabled.'); }); }}>Refresh attempt history</button>
    </section>}
    <button className="secondary-button" type="button" disabled={busy} onClick={() => void refreshGateway()}>Check gateway</button>
    {typeof gateway === 'object' && gateway.legacyWaits.length > 0 && <section aria-labelledby="legacy-waits-heading">
      <h3 id="legacy-waits-heading">Earlier provider waits need review</h3>
      <p>These older records cannot prove how much time passed. Check the provider's current rate limits, the original wait and billing externally. Do not confirm until the provider's required wait has elapsed. This review does not send a request; a new attempt needs separate authorization.</p>
      <ul>{gateway.legacyWaits.map((item) => <li key={item.clientAttemptId}><p>Attempt {item.clientAttemptId}. Its saved deadline is based on the previous system clock and is not proof of elapsed time.</p>
        <label className="checkbox-label"><input type="checkbox" checked={Boolean(legacyConfirmed[item.clientAttemptId])} disabled={busy} onChange={(event) => { const checked = event.target.checked; setLegacyConfirmed((old) => ({ ...old, [item.clientAttemptId]: checked })); }} /><span>I checked provider billing and rate limits externally and confirmed this attempt's required wait has elapsed.</span></label>
        <button type="button" className="secondary-button" disabled={busy || !legacyConfirmed[item.clientAttemptId]} onClick={() => void reviewLegacyWait(item.clientAttemptId)}>Record legacy wait review</button>
      </li>)}</ul>{gateway.hasMoreLegacyWaits && <p>More earlier waits remain; review this page and check the gateway again.</p>}
    </section>}
    <form onSubmit={generate}>
      {retry && <div><h3 id="retry-review-heading" tabIndex={-1} ref={retryHeading}>Retry of attempt {retry.attemptId}</h3><p>Job {retry.jobId}. Previous outcome: {retry.status}; a previous charge may have occurred, including for a reviewed UNKNOWN. The current estimate is {planError || !plans.length ? 'unavailable' : `$${plans[0].estimate} USD`}; this is a separate potentially billable call. No automatic retry occurs.</p><p>Original source, mask, facts, style and prompt are locked. To change inputs or preset, start a new job.</p><button type="button" className="secondary-button" disabled={busy} onClick={() => { setRetry(null); clearQueueConsent(); }}>Start a new job instead</button></div>}
      <p>Session estimate so far: {sessionTotal === null ? 'unavailable' : `$${sessionTotal} USD`}. Includes prepared and failed attempts in this browser-tab session; it is not provider spend or a hard cap.</p>
      <label htmlFor="studio-session-limit">Optional session estimated USD soft limit</label><input id="studio-session-limit" value={sessionLimit} onChange={(event) => { const value = event.target.value; setSessionLimit(value); clearQueueConsent(); try { sessionStorage.setItem('studio-session-limit', value); } catch { setBudgetSessionId(null); setError('Session settings are unavailable. Generation is disabled.'); } }} placeholder="e.g. 0.050000" disabled={busy} inputMode="decimal" />
      <label htmlFor="studio-limit">Optional per-attempt estimated USD soft limit</label><input id="studio-limit" value={max} onChange={(event) => { const value = event.target.value; setMax(value); clearQueueConsent(); try { sessionStorage.setItem('studio-attempt-limit', value); } catch { setBudgetSessionId(null); setError('Session settings are unavailable. Generation is disabled.'); } }} placeholder="e.g. 0.010000" disabled={busy} inputMode="decimal" />
      <fieldset disabled={busy || Boolean(retry)}><legend>Confirmed facts to include in each provider prompt</legend><p>Only selected confirmed facts are sent. Names and category are also included; review every prompt before authorizing.</p>{product.facts.filter((fact) => fact.confirmed).map((fact) => <label className="checkbox-label" key={fact.factId}><input type="checkbox" checked={selectedFacts.includes(fact.factId)} onChange={(event) => { const checked = event.target.checked; setSelectedFacts((old) => checked ? [...old, fact.factId] : old.filter((id) => id !== fact.factId)); clearQueueConsent(); }} /><span>{fact.name}: {fact.value}</span></label>)}</fieldset>
      <fieldset disabled={busy || Boolean(retry)}><legend>Choose styles</legend>{STUDIO_STYLE_IDS.map((styleId) => <label className="checkbox-label" key={styleId}><input type="checkbox" checked={selectedStyles.includes(styleId)} onChange={(event) => { const checked = event.target.checked; setSelectedStyles((old) => checked ? [...old, styleId] : old.filter((id) => id !== styleId)); clearQueueConsent(); }} /><span>{STYLE_LABELS[styleId]}</span></label>)}</fieldset>
      {sources === null ? <p role="status">Checking source masks…</p> : sources.length === 0 ? <p>Save a verified mask for a source before generation.</p> : selectedStyles.map((styleId) => <label key={styleId}>{STYLE_LABELS[styleId]} source<select value={sourceByStyle[styleId] ?? sources[0].source.assetId} disabled={busy || Boolean(retry)} onChange={(event) => { const value = event.target.value; setSourceByStyle((old) => ({ ...old, [styleId]: value })); clearQueueConsent(); }}>{sources.map((item) => <option key={item.source.assetId} value={item.source.assetId}>{item.source.filename} · {item.source.cameraView}</option>)}</select></label>)}
      {planError && <p className="error-message" role="alert">{planError}</p>}
      {plans.map((plan) => <section className="style-plan" key={plan.styleId}><h3>{STYLE_LABELS[plan.styleId]}</h3><p>Source {plan.input.source.filename} · {plan.input.source.cameraView}; one planned call, estimated ${plan.estimate} USD. {plan.styleId === 'flat_lay' && (plan.context.sourceView === 'TOP' ? 'True overhead requires your confirmation below.' : 'This is a source-angle-inspired scene, not true overhead.')}{plan.styleId === 'macro' && ' Select and review an actual source crop during composition.'}{plan.styleId === 'billboard' && ' Compose and inspect the complete ad locally; no advertising copy is generated.'}</p><details><summary>Review exact provider prompt</summary><p>{plan.prompt}</p></details>
        {plan.styleId === 'flat_lay' && plan.context.sourceView === 'TOP' && <label className="checkbox-label"><input type="checkbox" checked={topConfirmed} disabled={busy} onChange={(event) => { setTopConfirmed(event.target.checked); setStyleConsent({}); }} /><span>I confirm this source is compatible with a true 90-degree overhead view.</span></label>}
        {plan.perAttemptOverride && <label className="checkbox-label"><input type="checkbox" checked={Boolean(attemptOverrides[plan.styleId])} disabled={busy} onChange={(event) => { const checked = event.target.checked; setAttemptOverrides((old) => ({ ...old, [plan.styleId]: checked })); setStyleConsent({}); }} /><span>For {STYLE_LABELS[plan.styleId]} only, I approve exceeding the per-attempt soft estimate limit.</span></label>}
        {plan.sessionOverride && <label className="checkbox-label"><input type="checkbox" checked={Boolean(sessionOverrides[plan.styleId])} disabled={busy} onChange={(event) => { const checked = event.target.checked; setSessionOverrides((old) => ({ ...old, [plan.styleId]: checked })); setStyleConsent({}); }} /><span>For {STYLE_LABELS[plan.styleId]} only, I approve exceeding the session soft estimate limit.</span></label>}
        <label className="checkbox-label"><input type="checkbox" checked={Boolean(styleConsent[plan.styleId])} disabled={busy || entries === null || reviewFingerprint === null || sessionTotal === null || typeof gateway !== 'object'} onChange={(event) => { const checked = event.target.checked; setStyleConsent((old) => ({ ...old, [plan.styleId]: checked })); }} /><span>I authorize this single {STYLE_LABELS[plan.styleId]} attempt, including the displayed provider data and estimate, and understand a timeout may still incur a charge.</span></label></section>)}
      {plans.length > 0 && !busy && <p className="queue-consent-progress" role="status">Style authorizations: {plans.length - missingStyleConsent.length} of {plans.length}.{missingStyleConsent.length > 0 ? ` Still needed: ${missingStyleConsent.map((plan) => STYLE_LABELS[plan.styleId]).join(', ')}.` : ' Other required confirmations and gateway checks still apply.'}</p>}
      <button className="primary-button" type="submit" disabled={busy || unresolved || (typeof gateway === 'object' && gateway.legacyWaits.length > 0) || !ready || Boolean(planError) || entries === null || !navigator.locks || !budgetSessionId || sessionTotal === null || reviewFingerprint === null || typeof gateway !== 'object'}>{busy ? 'Working…' : 'Authorize and generate selected scenes'}</button>
    </form>
    {entries !== null && error && <p id="studio-error" ref={retryError} tabIndex={-1} className="error-message" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <section className="studio-scene-comparison" aria-labelledby="studio-comparison-heading">
      <h3 id="studio-comparison-heading">Compare generated scenes</h3>
      <p>Choose two attempts of the same style. These are unapproved empty backgrounds, not product photographs; inspect the original and the locally composed product separately.</p>
      <label>First attempt<select value={compareLeft} onChange={(event) => { setCompareLeft(event.target.value); setCompareRight(''); }}><option value="">Choose an attempt</option>{scenes.map(({ attempt }) => <option key={attempt.attemptId} value={attempt.attemptId}>{STYLE_LABELS[attempt.styleId!]} · {attempt.attemptId}</option>)}</select></label>
      <label>Second attempt<select value={rightScene?.attempt.attemptId ?? ''} onChange={(event) => setCompareRight(event.target.value)} disabled={!leftScene}><option value="">Choose another attempt of the same style</option>{scenes.filter(({ attempt }) => attempt.styleId === leftScene?.attempt.styleId && attempt.attemptId !== compareLeft).map(({ attempt }) => <option key={attempt.attemptId} value={attempt.attemptId}>{attempt.attemptId}</option>)}</select></label>
      {leftScene && rightScene && <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>{[leftScene, rightScene].map(({ attempt, asset }) => <figure key={attempt.attemptId} style={{ flex: '1 1 16rem', minWidth: 0 }}><figcaption>Unapproved {STYLE_LABELS[attempt.styleId!]} scene · {attempt.attemptId}</figcaption><Scene asset={asset!} /></figure>)}</div>}
      {leftScene && rightScene && <CompositeComparison productId={product.productId} productVersion={productVersion} leftAttempt={leftScene.attempt.attemptId} rightAttempt={rightScene.attempt.attemptId} />}
    </section>
    <h3 id="studio-history-heading" tabIndex={-1}>Local attempt history</h3>{entries && entries.length > 0 && <><button ref={attentionFilter} className="secondary-button studio-history-filter" type="button" aria-pressed={attentionOnly} disabled={busy} onClick={() => setAttentionOnly((value) => !value)}>Show only attempts needing attention</button><p role="status">Showing {attentionOnly ? localBlockers.length : entries.length} of {entries.length} attempts{attentionOnly ? ' flagged for attention' : ''}.{attentionOnly && ' Gateway and retry restrictions may also apply.'}</p></>}{entries?.some((entry) => entry.importedUnresolved) && <p>Each imported attempt needs a fresh local billing and rate-limit review before new generation. Reviews recorded by an earlier app version may need to be repeated.</p>}{entries === null ? <p>History unavailable or loading.</p> : entries.length === 0 ? <p>No attempts yet.</p> : attentionOnly && localBlockers.length === 0 ? <p>No attempts are flagged for attention in this project. Gateway and retry restrictions may still apply.</p> : <ul className="studio-history">{(attentionOnly ? localBlockers : entries).map(({ attempt, asset, importedUntrusted, importedUnresolved }) => <li key={attempt.attemptId} data-attempt-id={attempt.attemptId}><p><strong>{attempt.styleId ? STYLE_LABELS[attempt.styleId] : 'Studio (legacy)'} · {attemptStatusText(attempt, importedUntrusted)}</strong> · {attempt.attemptId} · {new Date(attempt.submittedAt).toLocaleString()} · pre-call estimate ${attempt.estimatedUSD} USD · usage-based estimate {attempt.observedUSD === null ? 'unavailable' : `$${attempt.observedUSD} USD (${attempt.pricingSnapshot}; not the provider invoice)`}</p>
      {attempt.retryOf && <p>Retry of attempt {attempt.retryOf} · job {attempt.jobId}.</p>}
      {(attempt.status === 'DEFINITIVE_FAILURE' || attempt.status === 'UNKNOWN' || attempt.status === 'SUBMITTED') && <p>{failureText(attempt, importedUntrusted)}</p>}
      {(!attempt.styleId || !attempt.sceneContext || !attempt.selectedFactIds || !attempt.productSnapshotFingerprint || attempt.presetVersion !== STUDIO_PRESET_VERSION || attempt.promptVersion !== STUDIO_SCENE_PROMPT_VERSION) && <p>This historical attempt cannot be retried with the current preset. Start a new job and give separate fresh consent instead; the original record remains unchanged.</p>}
      {!importedUntrusted && retryableStudioAttempt(attempt, entries.map((entry) => entry.attempt)) && <button className="secondary-button" type="button" aria-label={`Prepare ${attempt.status === 'DEFINITIVE_SUCCESS' ? 'another attempt' : 'retry'} for ${attempt.styleId && STYLE_LABELS[attempt.styleId]}, attempt ${attempt.attemptId}`} disabled={busy || unresolved} onClick={() => void prepareRetry(attempt)}>Prepare {attempt.status === 'DEFINITIVE_SUCCESS' ? 'another attempt' : 'retry'} for {attempt.styleId && STYLE_LABELS[attempt.styleId]}</button>}
      {!importedUntrusted && attempt.status === 'PREPARED' && <button className="secondary-button" type="button" disabled={busy || !navigator.locks} onClick={() => void closePrepared(attempt)}>Close unsent prepared attempt</button>}
      {attempt.usage !== null && <p>Provider-reported token usage: {Object.entries(attempt.usage).map(([key, value]) => `${key}: ${typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)}`).join(' · ')}. Provider invoice remains authoritative.</p>}
      {importedUntrusted ? (importedUnresolved ? <div>
        <p>This imported record is untrusted and may represent an active or charged attempt. Review provider billing and rate limits externally. This local review does not contact the gateway, verify the outcome, or acknowledge its journal. The gateway may independently block new requests.</p>
        <label className="checkbox-label"><input type="checkbox" checked={Boolean(reviewConfirmed[attempt.attemptId])} onChange={(event) => { const checked = event.target.checked; setReviewConfirmed((current) => ({ ...current, [attempt.attemptId]: checked })); }} disabled={busy} /><span>I have reviewed provider billing and rate limits externally and acknowledge this imported attempt may have incurred a charge.</span></label>
        <button className="secondary-button" type="button" disabled={busy || !reviewConfirmed[attempt.attemptId]} onClick={() => void reviewImported(attempt)}>Record local review of imported uncertainty</button>
      </div> : <p>This imported record remains untrusted. Any local uncertainty review did not contact the gateway or change the original outcome. Same-job retry is unavailable; a new job needs fresh authorization and may still be blocked by the gateway.</p>) : (attempt.status === 'UNKNOWN' || attempt.status === 'SUBMITTED' || attempt.cleanupPending !== undefined) && (studioAttemptBlocks(attempt) ? <div>
        <p>{attempt.cleanupPending === true ? `The gateway requires review before clearing its active marker after recording ${attempt.status}. The saved outcome is unchanged. Review provider billing and rate limits externally before acknowledging; this does not send an image request.` : attempt.cleanupPending !== undefined ? 'Invalid cleanup metadata. Generation remains blocked; preserve the saved records for owner review.' : 'A charge may have occurred. Review provider billing and rate limits externally before proceeding. An interrupted submission may still be active; the gateway will refuse review while active or without a reviewable result. This acknowledgement does not resolve the original outcome or send an image request.'}</p>
        <label className="checkbox-label"><input type="checkbox" checked={Boolean(reviewConfirmed[attempt.attemptId])} onChange={(event) => { const checked = event.target.checked; setReviewConfirmed((current) => ({ ...current, [attempt.attemptId]: checked })); }} disabled={busy} /><span>I have reviewed provider billing and rate limits externally and acknowledge the previous attempt may have incurred a charge.</span></label>
        {interruptedReviewUnavailable(attempt, navigator.locks) && <p>{interruptedReviewUnavailable(attempt, navigator.locks)}</p>}
        <button className="secondary-button" type="button" disabled={busy || !reviewConfirmed[attempt.attemptId] || typeof gateway !== 'object' || Boolean(interruptedReviewUnavailable(attempt, navigator.locks)) || (attempt.cleanupPending !== undefined && attempt.cleanupPending !== true)} onClick={() => void review(attempt)}>Record review of this attempt</button>
      </div> : <p>Reviewed at {attempt.acknowledgedAt}; gateway recorded outcome: {attempt.recordedOutcome}. Local outcome remains {attempt.cleanupPending === true ? attempt.status : 'UNKNOWN'}. A new attempt requires separate authorization.</p>)}
      {attempt.status === 'DEFINITIVE_SUCCESS' && (asset ? <SceneDisclosure product={product} attempt={attempt} asset={asset} disabled={busy} /> : <p className="error-message">Saved scene is missing.</p>)}</li>)}</ul>}
  </section>;
}
