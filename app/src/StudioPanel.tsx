import { useEffect, useRef, useState, type FormEvent } from 'react';
import { STUDIO_MODEL, STUDIO_QUALITY, STUDIO_SIZE, STUDIO_SCENE_PROMPT_VERSION, STUDIO_PRESET_VERSION, STUDIO_STYLE_IDS, STUDIO_MAX_PNG_BYTES, STUDIO_PRICING_SNAPSHOT, studioBuildPrompt, studioEstimateUSD, studioObservedUSD, type StudioStyleId, type StudioSceneContext } from '../studio-policy.mjs';
import { acknowledgeStudioAttempt, createStudioAttempt, globalStudioReviewFingerprint, listStudioAttempts, listStyleInputs, productSnapshotFingerprint, studioSceneContext, studioAttemptBlocks, studioInput, studioSessionEstimate, updateStudioAttempt, validStudioAcknowledgement, type Product, type StudioAsset, type StudioAttempt, type StudioRecordedOutcome } from './products';
import { inspectImageHeader } from './imageHeader';
import { sha256 } from './prepareSource';
import { useUnsavedChanges } from './useUnsavedChanges';
import { StrictCompositePanel } from './StrictCompositePanel';

type Entry = { attempt: StudioAttempt; asset: StudioAsset | null };
type Gateway = { csrf: string; reviewRevision: number } | 'checking' | 'unavailable' | 'signed-out' | 'disconnected';
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
  const [gateway, setGateway] = useState<Gateway>('checking');
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [reviewFingerprint, setReviewFingerprint] = useState<string | null>(null);
  const [max, setMax] = useState(() => { try { return sessionStorage.getItem('studio-attempt-limit') ?? ''; } catch { return ''; } });
  const [budgetSessionId, setBudgetSessionId] = useState(initialBudgetSession);
  const [sessionTotal, setSessionTotal] = useState<string | null>(null);
  const [sessionLimit, setSessionLimit] = useState(() => { try { return sessionStorage.getItem('studio-session-limit') ?? ''; } catch { return ''; } });
  const [sources, setSources] = useState<SourceOption[] | null>(null);
  const [selectedStyles, setSelectedStyles] = useState<StudioStyleId[]>(['studio']);
  const [sourceByStyle, setSourceByStyle] = useState<Partial<Record<StudioStyleId, string>>>({});
  const [selectedFacts, setSelectedFacts] = useState<string[]>(() => product.facts.filter((fact) => fact.confirmed).map((fact) => fact.factId));
  const [styleConsent, setStyleConsent] = useState<Partial<Record<StudioStyleId, boolean>>>({});
  const [attemptOverrides, setAttemptOverrides] = useState<Partial<Record<StudioStyleId, boolean>>>({});
  const [sessionOverrides, setSessionOverrides] = useState<Partial<Record<StudioStyleId, boolean>>>({});
  const [topConfirmed, setTopConfirmed] = useState(false);
  const [reviewConfirmed, setReviewConfirmed] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const running = useRef(false);
  const gatewayCheck = useRef(0);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useUnsavedChanges(busy || Object.values(styleConsent).some(Boolean) || Object.values(reviewConfirmed).some(Boolean));
  const unresolved = entries?.some(({ attempt }) => studioAttemptBlocks(attempt)) ?? false;
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
  } catch (reason) { plans = []; planError = reason instanceof Error ? reason.message : 'The style selection is invalid.'; }
  const plannedTotal = moneyString(plans.reduce((sum, plan) => sum + moneyUnits(plan.estimate), 0n));
  const ready = plans.length > 0 && plans.every((plan) => styleConsent[plan.styleId] &&
    (!plan.perAttemptOverride || attemptOverrides[plan.styleId]) && (!plan.sessionOverride || sessionOverrides[plan.styleId]) &&
    (plan.styleId !== 'flat_lay' || plan.context.sourceView !== 'TOP' || topConfirmed));
  function clearQueueConsent() { setStyleConsent({}); setAttemptOverrides({}); setSessionOverrides({}); setTopConfirmed(false); }

  async function refreshGateway() {
    const check = ++gatewayCheck.current;
    clearQueueConsent();
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
    const [value, fingerprint, total] = await Promise.all([listStudioAttempts(product.productId), globalStudioReviewFingerprint(), budgetSessionId ? studioSessionEstimate(budgetSessionId) : Promise.resolve(null)]);
    setEntries(value); setReviewFingerprint(fingerprint); setSessionTotal(total);
  }
  useEffect(() => {
    let active = true;
    setEntries(null); setReviewFingerprint(null); setSessionTotal(null); clearQueueConsent();
    Promise.all([listStudioAttempts(product.productId), globalStudioReviewFingerprint(), budgetSessionId ? studioSessionEstimate(budgetSessionId) : Promise.resolve(null)]).then(([value, fingerprint, total]) => { if (active) { setEntries(value); setReviewFingerprint(fingerprint); setSessionTotal(total); } }).catch(() => { if (active) setError('Local attempt history is unavailable. Generation is disabled.'); });
    void refreshGateway();
    const offline = () => { gatewayCheck.current++; clearQueueConsent(); setGateway('unavailable'); };
    window.addEventListener('offline', offline);
    return () => { active = false; gatewayCheck.current++; window.removeEventListener('offline', offline); };
  }, [product.productId, budgetSessionId]);

  const productVersion = JSON.stringify(product);
  useEffect(() => {
    let active = true;
    setSources(null); setSourceByStyle({}); setSelectedFacts(product.facts.filter((fact) => fact.confirmed).map((fact) => fact.factId)); clearQueueConsent();
    void listStyleInputs(product.productId).then((items) => { if (active) setSources(items); })
      .catch((reason: unknown) => { if (active) { setSources([]); setError(reason instanceof Error ? reason.message : 'Sources could not be checked.'); } });
    return () => { active = false; };
  }, [productVersion]);

  async function review(attempt: StudioAttempt) {
    if (running.current || !studioAttemptBlocks(attempt) || !reviewConfirmed[attempt.attemptId] || typeof gateway !== 'object' || !((attempt.status === 'UNKNOWN' || attempt.status === 'SUBMITTED') || ((attempt.status === 'DEFINITIVE_SUCCESS' || attempt.status === 'DEFINITIVE_FAILURE') && attempt.cleanupPending === true))) return;
    gatewayCheck.current++;
    running.current = true; onBusyChange(true); setBusy(true); setError(''); setNotice(''); clearQueueConsent(); setGateway('checking');
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
    if (running.current || unresolved || !ready || planError || entries === null || typeof gateway !== 'object' ||
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
      for (const plan of chosen) {
        ensureOpen();
        const input = await studioInput(product.productId, plan.input.source.assetId);
        if (input.maskId !== plan.input.maskId || input.maskSha256 !== plan.input.maskSha256 || input.source.sha256 !== plan.input.source.sha256) {
          throw new Error('A source or mask changed. Review the queue again; no image request was sent.');
        }
        const attempt: StudioAttempt = {
          attemptId: crypto.randomUUID(), jobId: crypto.randomUUID(), productId: product.productId,
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
        const plan = chosen[index], id = attempt.attemptId;
        setNotice(`Submitting ${STYLE_LABELS[plan.styleId]} (${index + 1} of ${prepared.length}); later styles remain prepared.`);
        await withStudioAttemptLock(id, navigator.locks, async () => {
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
                const failure = approvalFailure(approvalResponse.status, record(record(await json(approvalResponse)).error));
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
              attempt = { ...attempt, status: 'DEFINITIVE_FAILURE' };
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
                if (response.status === 409 && envelope.code === 'APPROVAL_STALE' && failure.definitive) { gatewayCheck.current++; setGateway('unavailable'); }
              } catch { /* malformed failure is ambiguous */ }
              attempt = { ...attempt, status: failure.definitive ? 'DEFINITIVE_FAILURE' : 'UNKNOWN',
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
              attempt = { ...base, status: submitted ? 'UNKNOWN' : 'DEFINITIVE_FAILURE', usage: null, observedUSD: null };
              try { await updateStudioAttempt(attempt); pending.delete(id); } catch { /* preserve interrupted evidence; never resend */ }
            }
            if (submitted && attempt.status === 'UNKNOWN') throw new Error('The outcome is UNKNOWN or could not be saved. A charge may have occurred; the remaining queue was not sent and no automatic retry will occur.');
            throw reason;
          }
        });
        await refreshEntries();
      }
      setNotice(`${prepared.length} independent scene attempts completed. Each result remains unapproved until local composition and human review.`);
    } catch (reason) {
      setError(`${reason instanceof Error ? reason.message : 'The queue could not continue.'} Remaining prepared styles were not automatically sent.`);
    } finally {
      for (const item of pending.values()) {
        try { await updateStudioAttempt({ ...item, status: 'DEFINITIVE_FAILURE' }); } catch { /* Keep unresolved local evidence for manual review. */ }
      }
      clearQueueConsent();
      try { await refreshEntries(); } catch { setEntries(null); setError('Local attempt history could not be read. Generation is disabled.'); }
      running.current = false; onBusyChange(false); setBusy(false);
    }
  }

  async function closePrepared(attempt: StudioAttempt) {
    if (busy || attempt.status !== 'PREPARED' || !navigator.locks) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await withStudioAttemptLock(attempt.attemptId, navigator.locks, () => updateStudioAttempt({ ...attempt, status: 'DEFINITIVE_FAILURE' }));
      await refreshEntries();
      setNotice('The prepared attempt was closed without sending an image request. A new attempt requires separate authorization.');
    } catch {
      await refreshEntries().catch(() => { setEntries(null); });
      setError('The attempt could not be closed; its state may have changed in another tab. Review the history before proceeding.');
    } finally { setBusy(false); }
  }

  return <section className="product-section studio-panel" aria-labelledby="studio-heading">
    <span className="section-kicker">STRICT STYLE QUEUE</span><h2 id="studio-heading">Generate style scenes</h2>
    <p>Each selected style is an independent, potentially billable attempt. The original image and mask remain local; the product name, category and selected confirmed facts shown in each prompt are sent to the provider. Do not include secrets or information you do not want to share.</p>
    <p><strong>Backup warning:</strong> Once an attempt is saved, the current backup cannot safely include this project's jobs or outputs and will refuse export. Back up the project before proceeding.</p>
    <p>Planned calls: <strong>{selectedStyles.length}</strong>; estimated total: <strong>{planError || !sources || sessionTotal === null ? 'unavailable' : `$${plannedTotal} USD`}</strong>. One call per selected scene; no automatic retry. Estimate only, not a cap or invoice. Model {STUDIO_MODEL}, {STUDIO_QUALITY}, {STUDIO_SIZE}, PNG; pricing snapshot 2026-10-29. <a href="https://developers.openai.com/api/docs/guides/image-generation" target="_blank" rel="noreferrer">Pricing evidence</a>.</p>
    {gateway === 'checking' ? <p role="status">Checking local gateway…</p> : gateway === 'unavailable' ? <p role="status">Offline or local gateway unavailable. Generation is disabled.</p> : gateway === 'signed-out' ? <p>Sign in to the local app in provider settings first.</p> : gateway === 'disconnected' ? <p>Connect the configured provider session in settings first.</p> : <p>Local app and provider session active.</p>}
    {!navigator.locks && <p>Web Locks are unavailable in this browser. Generation and review of interrupted submissions are disabled; existing UNKNOWN attempts can still be reviewed.</p>}
    <button className="secondary-button" type="button" disabled={busy} onClick={() => void refreshGateway()}>Check gateway</button>
    <form onSubmit={generate}>
      <p>Session estimate so far: {sessionTotal === null ? 'unavailable' : `$${sessionTotal} USD`}. Includes prepared and failed attempts in this browser-tab session; it is not provider spend or a hard cap.</p>
      <label htmlFor="studio-session-limit">Optional session estimated USD soft limit</label><input id="studio-session-limit" value={sessionLimit} onChange={(event) => { const value = event.target.value; setSessionLimit(value); clearQueueConsent(); try { sessionStorage.setItem('studio-session-limit', value); } catch { setBudgetSessionId(null); setError('Session settings are unavailable. Generation is disabled.'); } }} placeholder="e.g. 0.050000" disabled={busy} inputMode="decimal" />
      <label htmlFor="studio-limit">Optional per-attempt estimated USD soft limit</label><input id="studio-limit" value={max} onChange={(event) => { const value = event.target.value; setMax(value); clearQueueConsent(); try { sessionStorage.setItem('studio-attempt-limit', value); } catch { setBudgetSessionId(null); setError('Session settings are unavailable. Generation is disabled.'); } }} placeholder="e.g. 0.010000" disabled={busy} inputMode="decimal" />
      <fieldset disabled={busy}><legend>Confirmed facts to include in each provider prompt</legend><p>Only selected confirmed facts are sent. Names and category are also included; review every prompt before authorizing.</p>{product.facts.filter((fact) => fact.confirmed).map((fact) => <label className="checkbox-label" key={fact.factId}><input type="checkbox" checked={selectedFacts.includes(fact.factId)} onChange={(event) => { const checked = event.target.checked; setSelectedFacts((old) => checked ? [...old, fact.factId] : old.filter((id) => id !== fact.factId)); clearQueueConsent(); }} /><span>{fact.name}: {fact.value}</span></label>)}</fieldset>
      <fieldset disabled={busy}><legend>Choose styles</legend>{STUDIO_STYLE_IDS.map((styleId) => <label className="checkbox-label" key={styleId}><input type="checkbox" checked={selectedStyles.includes(styleId)} onChange={(event) => { const checked = event.target.checked; setSelectedStyles((old) => checked ? [...old, styleId] : old.filter((id) => id !== styleId)); clearQueueConsent(); }} /><span>{STYLE_LABELS[styleId]}</span></label>)}</fieldset>
      {sources === null ? <p role="status">Checking source masks…</p> : sources.length === 0 ? <p>Save a verified mask for a source before generation.</p> : selectedStyles.map((styleId) => <label key={styleId}>{STYLE_LABELS[styleId]} source<select value={sourceByStyle[styleId] ?? sources[0].source.assetId} disabled={busy} onChange={(event) => { const value = event.target.value; setSourceByStyle((old) => ({ ...old, [styleId]: value })); clearQueueConsent(); }}>{sources.map((item) => <option key={item.source.assetId} value={item.source.assetId}>{item.source.filename} · {item.source.cameraView}</option>)}</select></label>)}
      {planError && <p className="error-message" role="alert">{planError}</p>}
      {plans.map((plan) => <section className="style-plan" key={plan.styleId}><h3>{STYLE_LABELS[plan.styleId]}</h3><p>Source {plan.input.source.filename} · {plan.input.source.cameraView}; one planned call, estimated ${plan.estimate} USD. {plan.styleId === 'flat_lay' && (plan.context.sourceView === 'TOP' ? 'True overhead requires your confirmation below.' : 'This is a source-angle-inspired scene, not true overhead.')}{plan.styleId === 'macro' && ' Select and review an actual source crop during composition.'}{plan.styleId === 'billboard' && ' Compose and inspect the complete ad locally; no advertising copy is generated.'}</p><details><summary>Review exact provider prompt</summary><p>{plan.prompt}</p></details>
        {plan.styleId === 'flat_lay' && plan.context.sourceView === 'TOP' && <label className="checkbox-label"><input type="checkbox" checked={topConfirmed} disabled={busy} onChange={(event) => { setTopConfirmed(event.target.checked); setStyleConsent({}); }} /><span>I confirm this source is compatible with a true 90-degree overhead view.</span></label>}
        {plan.perAttemptOverride && <label className="checkbox-label"><input type="checkbox" checked={Boolean(attemptOverrides[plan.styleId])} disabled={busy} onChange={(event) => { const checked = event.target.checked; setAttemptOverrides((old) => ({ ...old, [plan.styleId]: checked })); setStyleConsent({}); }} /><span>For {STYLE_LABELS[plan.styleId]} only, I approve exceeding the per-attempt soft estimate limit.</span></label>}
        {plan.sessionOverride && <label className="checkbox-label"><input type="checkbox" checked={Boolean(sessionOverrides[plan.styleId])} disabled={busy} onChange={(event) => { const checked = event.target.checked; setSessionOverrides((old) => ({ ...old, [plan.styleId]: checked })); setStyleConsent({}); }} /><span>For {STYLE_LABELS[plan.styleId]} only, I approve exceeding the session soft estimate limit.</span></label>}
        <label className="checkbox-label"><input type="checkbox" checked={Boolean(styleConsent[plan.styleId])} disabled={busy || entries === null || reviewFingerprint === null || sessionTotal === null || typeof gateway !== 'object'} onChange={(event) => { const checked = event.target.checked; setStyleConsent((old) => ({ ...old, [plan.styleId]: checked })); }} /><span>I authorize this single {STYLE_LABELS[plan.styleId]} attempt, including the displayed provider data and estimate, and understand a timeout may still incur a charge.</span></label></section>)}
      <button className="primary-button" type="submit" disabled={busy || unresolved || !ready || Boolean(planError) || entries === null || !navigator.locks || !budgetSessionId || sessionTotal === null || reviewFingerprint === null || typeof gateway !== 'object'}>{busy ? 'Working…' : 'Authorize and generate selected scenes'}</button>
    </form>
    {error && <p className="error-message" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <h3>Local attempt history</h3>{entries === null ? <p>History unavailable or loading.</p> : entries.length === 0 ? <p>No attempts yet.</p> : <ul className="studio-history">{entries.map(({ attempt, asset }) => <li key={attempt.attemptId}><p><strong>{attempt.styleId ? STYLE_LABELS[attempt.styleId] : 'Studio (legacy)'} · {attempt.status === 'SUBMITTED' ? 'UNKNOWN (interrupted or in progress)' : attempt.status === 'PREPARED' ? 'Prepared; no image send recorded' : attempt.status}</strong> · {attempt.attemptId} · {new Date(attempt.submittedAt).toLocaleString()} · pre-call estimate ${attempt.estimatedUSD} USD · usage-based estimate {attempt.observedUSD === null ? 'unavailable' : `$${attempt.observedUSD} USD (${attempt.pricingSnapshot}; not the provider invoice)`}</p>
      {attempt.status === 'PREPARED' && <button className="secondary-button" type="button" disabled={busy || !navigator.locks} onClick={() => void closePrepared(attempt)}>Close unsent prepared attempt</button>}
      {attempt.usage !== null && <p>Provider-reported token usage: {Object.entries(attempt.usage).map(([key, value]) => `${key}: ${typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)}`).join(' · ')}. Provider invoice remains authoritative.</p>}
      {(attempt.status === 'UNKNOWN' || attempt.status === 'SUBMITTED' || attempt.cleanupPending !== undefined) && (studioAttemptBlocks(attempt) ? <div>
        <p>{attempt.cleanupPending === true ? `The gateway could not clear its active marker after recording ${attempt.status}. The saved outcome is unchanged. Review provider billing externally before acknowledging; this does not send an image request.` : attempt.cleanupPending !== undefined ? 'Invalid cleanup metadata. Generation remains blocked; preserve the saved records for owner review.' : 'A charge may have occurred. Review provider billing externally before proceeding. An interrupted submission may still be active; the gateway will refuse review while active or without a reviewable result. This acknowledgement does not resolve the original outcome or send an image request.'}</p>
        <label className="checkbox-label"><input type="checkbox" checked={Boolean(reviewConfirmed[attempt.attemptId])} onChange={(event) => setReviewConfirmed((current) => ({ ...current, [attempt.attemptId]: event.target.checked }))} disabled={busy} /><span>I have reviewed provider billing externally and acknowledge the previous attempt may have incurred a charge.</span></label>
        <button className="secondary-button" type="button" disabled={busy || !reviewConfirmed[attempt.attemptId] || typeof gateway !== 'object' || (attempt.cleanupPending !== undefined && attempt.cleanupPending !== true)} onClick={() => void review(attempt)}>Record review of this attempt</button>
      </div> : <p>Reviewed at {attempt.acknowledgedAt}; gateway recorded outcome: {attempt.recordedOutcome}. Local outcome remains {attempt.cleanupPending === true ? attempt.status : 'UNKNOWN'}. A new attempt requires separate authorization.</p>)}
      {attempt.status === 'DEFINITIVE_SUCCESS' && (asset ? <><p>Unapproved generated background</p><Scene asset={asset} /><StrictCompositePanel productId={product.productId} productVersion={JSON.stringify(product)} attemptId={attempt.attemptId} scene={asset} disabled={busy} /></> : <p className="error-message">Saved scene is missing.</p>)}</li>)}</ul>}
  </section>;
}
