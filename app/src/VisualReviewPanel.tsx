import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createVisualReview, listVisualReviews, loadStrictCompositeInputs, recordVisualDecision, type StrictComposite, type VisualReviewRecord } from './products';
import { evaluateVisualReview, STYLE_REVIEW_FIELDS, type ReviewCheck, type ReviewChecks, type ReviewFinding, type ReviewRegion, type ReviewScores, type ReviewVariant, type StyleReviewChecks, type VisualReviewEvaluation } from './visualReviewRules';
import { LocalImage } from './LocalImage';
import { useUnsavedChanges } from './useUnsavedChanges';

const SCORE_FIELDS: Array<[keyof ReviewScores, string]> = [
  ['design', 'Packaging, material and design'], ['typography', 'Logo and readable typography'],
  ['geometry', 'Shape, proportion and perspective'], ['realism', 'Photorealism and scene integration'], ['style', 'Requested style and composition'],
];
const CHECK_FIELDS: Array<[keyof ReviewChecks, string]> = [
  ['product', 'Correct product, SKU, variant, material and shape'], ['typography', 'Original logo and every readable label, including Chinese text'],
  ['claims', 'No fabricated claims, ingredients, certifications or endorsements'], ['viewpoint', 'No invented unseen viewpoint or packaging face'],
  ['source', 'Rights and original source are available and verifiable'], ['mask', 'Mask and composition preserve all critical product details'],
];
const EMPTY_SCORES: ReviewScores = { design: '', typography: '', geometry: '', realism: '', style: '' };
const UNKNOWN_CHECKS: ReviewChecks = { product: 'UNKNOWN', typography: 'UNKNOWN', claims: 'UNKNOWN', viewpoint: 'UNKNOWN', source: 'UNKNOWN', mask: 'UNKNOWN' };

type History = Awaited<ReturnType<typeof listVisualReviews>>;

type RegionDraft = Record<keyof ReviewRegion, string>;
type FindingDraft = { severity: ReviewFinding['severity']; description: string; location: '' | 'source' | 'output' | 'both' | 'global'; source: RegionDraft; output: RegionDraft };
const emptyRegion = (): RegionDraft => ({ x: '', y: '', width: '', height: '' });
const newFinding = (): FindingDraft => ({ severity: 'WARN', description: '', location: '', source: emptyRegion(), output: emptyRegion() });
const regionFields: Array<keyof ReviewRegion> = ['x', 'y', 'width', 'height'];

function parseRegion(draft: RegionDraft, width: number, height: number): ReviewRegion | null {
  if (regionFields.some((key) => !/^\d+$/.test(draft[key]))) return null;
  const region = { x: Number(draft.x), y: Number(draft.y), width: Number(draft.width), height: Number(draft.height) };
  if (!regionFields.every((key) => Number.isSafeInteger(region[key])) || region.width < 1 || region.height < 1 || region.x + region.width > width || region.y + region.height > height) return null;
  return region;
}

function formatRegion(region: ReviewRegion): string {
  return `x ${region.x}, y ${region.y}, width ${region.width}, height ${region.height}`;
}

export function VisualReviewPanel({ productId, productVersion, attemptId, composite, disabled }: { productId: string; productVersion: string; attemptId: string; composite: StrictComposite; disabled: boolean }) {
  const [source, setSource] = useState<{ blob: Blob; width: number; height: number } | null>(null);
  const [historyState, setHistory] = useState<History | null>(null);
  const [evidenceVersion, setEvidenceVersion] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [scores, setScores] = useState<ReviewScores>(EMPTY_SCORES);
  const [checks, setChecks] = useState<ReviewChecks>(UNKNOWN_CHECKS);
  const styleId = composite.recipe?.styleId;
  const emptyStyleChecks = (): StyleReviewChecks => Object.fromEntries((styleId ? STYLE_REVIEW_FIELDS[styleId] : []).map(([key]) => [key, 'UNKNOWN']));
  const [styleChecks, setStyleChecks] = useState<StyleReviewChecks>(emptyStyleChecks);
  const [variant, setVariant] = useState<ReviewVariant | ''>('');
  const [note, setNote] = useState('');
  const [findings, setFindings] = useState<FindingDraft[]>([]);
  const [reviewed, setReviewed] = useState(false);
  const [choice, setChoice] = useState<'APPROVED' | 'REJECTED' | ''>('');
  const [decisionConfirmed, setDecisionConfirmed] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [nativePixels, setNativePixels] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const running = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const pendingReload = useRef(false);
  const history = evidenceVersion === productVersion ? historyState : null;
  const hasDraft = findings.length > 0 || Boolean(note) || Boolean(variant) || Object.values(scores).some(Boolean) || Object.values(checks).some((value) => value !== 'UNKNOWN') || Object.values(styleChecks).some((value) => value !== 'UNKNOWN');
  const noteRequired = Object.values(checks).some((value) => value !== 'MATCH') || Object.values(styleChecks).some((value) => value !== 'MATCH');
  useUnsavedChanges(busy || reviewed || Boolean(choice) || hasDraft);

  useEffect(() => {
    const invalidate = () => {
      setSource(null); setHistory(null); setEvidenceVersion(null); setReviewed(false); setChoice(''); setDecisionConfirmed(false);
      if (running.current) pendingReload.current = true;
      else setReloadVersion((value) => value + 1);
    };
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('product-image-studio-changes');
    if (channel) channel.onmessage = (event: MessageEvent) => { if (event.data === productId) invalidate(); };
    window.addEventListener('focus', invalidate);
    return () => { channel?.close(); window.removeEventListener('focus', invalidate); };
  }, [productId]);

  useEffect(() => {
    alive.current = true;
    const abort = new AbortController(); controller.current = abort;
    setSource(null); setHistory(null); setEvidenceVersion(null); setError(''); setReviewed(false); setChoice(''); setDecisionConfirmed(false);
    void Promise.all([loadStrictCompositeInputs(productId, attemptId, composite.sceneAssetId, abort.signal), listVisualReviews(productId, attemptId, composite.assetId, abort.signal)]).then(([inputs, records]) => {
      if (abort.signal.aborted || !alive.current) return;
      if (inputs.sourceSha256 !== composite.sourceSha256 || inputs.maskSha256 !== composite.maskSha256 || inputs.sceneSha256 !== composite.sceneSha256 || inputs.maskId !== composite.maskId) throw new Error('The source, active mask or scene changed since this composite.');
      if (records.assetSha256 !== composite.sha256 || records.recipeSha256 !== composite.recipeSha256 || records.adSha256 !== composite.adSha256) throw new Error('The saved composite or recipe changed since it was displayed. Reopen the workspace before reviewing it.');
      setSource({ blob: inputs.source, width: inputs.sourceWidth, height: inputs.sourceHeight }); setHistory(records); setEvidenceVersion(productVersion);
    }).catch((reason) => { if (!abort.signal.aborted && alive.current) setError(reason instanceof Error ? reason.message : 'The review evidence could not be loaded.'); });
    return () => { alive.current = false; abort.abort(); controller.current?.abort(); };
  }, [productId, productVersion, attemptId, composite.assetId, reloadVersion]);

  const findingErrors: string[] = [];
  const parsedFindings: ReviewFinding[] = findings.flatMap((finding, index) => {
    const description = finding.description.trim();
    if (!description || description.length > 500) findingErrors.push(`Finding ${index + 1}: enter a description of 1–500 characters.`);
    if (!finding.location) findingErrors.push(`Finding ${index + 1}: choose a location or explicitly select Global / unlocalized.`);
    const sourceRegion = finding.location === 'source' || finding.location === 'both' ? source && parseRegion(finding.source, source.width, source.height) : undefined;
    const outputRegion = finding.location === 'output' || finding.location === 'both' ? parseRegion(finding.output, 1024, 1024) : undefined;
    if (sourceRegion === null || outputRegion === null) findingErrors.push(`Finding ${index + 1}: enter a whole-pixel rectangle within the selected image bounds.`);
    return [{ severity: finding.severity, description, unlocalized: finding.location === 'global', ...(sourceRegion ? { sourceRegion } : {}), ...(outputRegion ? { outputRegion } : {}) }];
  });
  const allChecks = [...Object.values(checks), ...Object.values(styleChecks)];
  if (allChecks.includes('MISMATCH') && !parsedFindings.some((finding) => finding.severity === 'BLOCKER')) findingErrors.push('A mismatch requires at least one BLOCKER finding.');
  else if (!allChecks.includes('MISMATCH') && allChecks.includes('UNKNOWN') && !parsedFindings.some((finding) => finding.severity === 'WARN' || finding.severity === 'BLOCKER')) findingErrors.push('An unverifiable check requires at least one WARN or BLOCKER finding.');
  let evaluation: VisualReviewEvaluation | null = null;
  try { if (variant && !findingErrors.length) evaluation = evaluateVisualReview(scores, checks, variant, styleId, styleId ? styleChecks : undefined, parsedFindings); } catch { /* incomplete score is not a review */ }
  const latest = history?.reviews.reduce<VisualReviewRecord | null>((current, item) => !current || item.revision > current.revision ? item : current, null) ?? null;
  const currentDecision = latest ? history?.decisions.find((item) => item.reportId === latest.qaId && item.current) : undefined;
  const latestIsCurrent = Boolean(latest && !history?.importedReviewRequired && latest.productSha256 === history?.productSha256 && latest.recipeSha256 === composite.recipeSha256 && latest.adSha256 === composite.adSha256);
  function invalidateDecision() { setReviewed(false); setChoice(''); setDecisionConfirmed(false); }
  function clearDraft() { setScores(EMPTY_SCORES); setChecks(UNKNOWN_CHECKS); setStyleChecks(emptyStyleChecks()); setVariant(''); setNote(''); setFindings([]); invalidateDecision(); }
  function updateFinding(index: number, update: (finding: FindingDraft) => FindingDraft) {
    setFindings((old) => old.map((finding, i) => i === index ? update(finding) : finding)); invalidateDecision();
  }

  async function submitReview(event: FormEvent) {
    event.preventDefault();
    if (running.current || disabled || !source || !history || !evaluation || !variant || !reviewed || (noteRequired && !note.trim())) return;
    running.current = true; setBusy(true); setError(''); setNotice('');
    const abort = new AbortController(); controller.current = abort;
    try {
      await createVisualReview(productId, attemptId, composite.assetId, scores, checks, variant, note, history.productSha256, composite.sha256, abort.signal, composite.recipeSha256, composite.adSha256, styleId ? styleChecks : undefined, parsedFindings);
      if (alive.current) { clearDraft(); setNotice('Review recorded. A passing candidate still requires a separate explicit decision.'); }
      try { const records = await listVisualReviews(productId, attemptId, composite.assetId, abort.signal); if (records.assetSha256 !== composite.sha256 || records.recipeSha256 !== composite.recipeSha256 || records.adSha256 !== composite.adSha256) throw new Error('Composite changed'); if (alive.current) setHistory(records); }
      catch { if (alive.current) { setHistory(null); setError('The review was saved, but history could not be refreshed. Reload the workspace.'); } }
    } catch (reason) { if (alive.current && !abort.signal.aborted) { setHistory(null); setSource(null); setReviewed(false); setError(reason instanceof Error ? reason.message : 'Review could not be saved.'); } }
    finally { if (controller.current === abort) controller.current = null; running.current = false; if (alive.current) { setBusy(false); if (pendingReload.current) { pendingReload.current = false; setReloadVersion((value) => value + 1); } } }
  }

  async function submitDecision() {
    if (running.current || disabled || !source || hasDraft || !latest || !latestIsCurrent || !choice || !decisionConfirmed || currentDecision) return;
    running.current = true; setBusy(true); setError(''); setNotice('');
    const abort = new AbortController(); controller.current = abort;
    try {
      await recordVisualDecision(productId, attemptId, composite.assetId, latest.qaId, choice, abort.signal);
      if (alive.current) { setChoice(''); setDecisionConfirmed(false); setNotice('Your separate decision was recorded for this exact review and image.'); }
      try { const records = await listVisualReviews(productId, attemptId, composite.assetId, abort.signal); if (records.assetSha256 !== composite.sha256 || records.recipeSha256 !== composite.recipeSha256 || records.adSha256 !== composite.adSha256) throw new Error('Composite changed'); if (alive.current) setHistory(records); }
      catch { if (alive.current) { setHistory(null); setError('The decision was saved, but history could not be refreshed. Reload the workspace.'); } }
    } catch (reason) { if (alive.current && !abort.signal.aborted) { setHistory(null); setSource(null); setChoice(''); setDecisionConfirmed(false); setError(reason instanceof Error ? reason.message : 'Decision could not be saved.'); } }
    finally { if (controller.current === abort) controller.current = null; running.current = false; if (alive.current) { setBusy(false); if (pendingReload.current) { pendingReload.current = false; setReloadVersion((value) => value + 1); } } }
  }

  return <section className="visual-review" aria-labelledby={`review-heading-${composite.assetId}`}>
    <h5 id={`review-heading-${composite.assetId}`}>Human visual review</h5>
    <p>Compare the original and this composite. No OCR, model, or score verifies the brand for you. A mismatch blocks approval even with a high score; uncertain details must remain unverifiable.</p>
    {error && <><p className="error-message" role="alert">{error}</p><button type="button" className="secondary-button" disabled={busy} onClick={() => setReloadVersion((value) => value + 1)}>Recheck review evidence</button></>}{notice && <p role="status">{notice}</p>}
    {!history && !error && <p role="status">Checking review evidence…</p>}
    {source && history && <><label className="checkbox-label"><input type="checkbox" checked={nativePixels} onChange={(event) => setNativePixels(event.target.checked)} /><span>View at native pixel size (one image pixel per CSS pixel)</span></label>{!nativePixels && <><label htmlFor={`qa-zoom-${composite.assetId}`}>Review zoom: {zoom}%</label><input id={`qa-zoom-${composite.assetId}`} type="range" min="100" max="400" step="25" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></>}<div className="strict-comparison"><figure><div className="strict-zoom" role="region" tabIndex={0} aria-label="Review original source zoom area"><LocalImage blob={source.blob} alt="Original source for human review" zoom={zoom} nativeWidth={nativePixels ? source.width : undefined} /></div><figcaption>Original source · {source.width} × {source.height}</figcaption></figure><figure><div className="strict-zoom" role="region" tabIndex={0} aria-label="Review composite zoom area"><LocalImage blob={composite.blob} alt="Composite for human review" zoom={zoom} nativeWidth={nativePixels ? 1024 : undefined} /></div><figcaption>Unapproved composite · 1024 × 1024</figcaption></figure></div></>}
    {history && composite.recipe && <div><p>Style: {composite.recipe.styleId} · recipe SHA-256 {composite.recipeSha256}.</p>{composite.recipe.crop && <p>Original-pixel crop: x {composite.recipe.crop.x}, y {composite.recipe.crop.y}, width {composite.recipe.crop.width}, height {composite.recipe.crop.height}. If required identifiers are absent or unreadable, mark them Cannot verify.</p>}{composite.ad && <figure><div className="strict-zoom" role="region" tabIndex={0} aria-label="Complete billboard ad review"><LocalImage blob={composite.ad} alt="Complete advertisement before display placement" nativeWidth={nativePixels ? 1024 : undefined} zoom={zoom} /></div><figcaption>Complete ad · SHA-256 {composite.adSha256} · supplied copy: {composite.recipe.copy || '(none)'}</figcaption></figure>}</div>}
    {history && <><p>Last checked review: {latest ? `${latest.report.status} · score ${latest.report.weightedScore}/100${latestIsCurrent ? '' : history.importedReviewRequired ? ' · imported history' : ' · historical product snapshot'}` : 'none'}{currentDecision ? ` · decision ${currentDecision.decision}` : ' · no current human decision'}. A new review supersedes earlier decisions; evidence is checked again before any decision.</p>
      <div className="qa-product-context"><h6>Product details in this review</h6><p>SKU: {history.product.sku} · Name: {history.product.name} · Category: {history.product.category}</p><p>Original view: {history.product.sourceAssets.find((item) => item.assetId === composite.sourceAssetId)?.cameraView ?? 'UNKNOWN'} · Source rights acknowledged: {history.product.rightsAcknowledged ? 'yes' : 'no'}</p><p>Protected text: {history.product.brandLock.protectedText.join(', ') || 'none recorded'} · Forbidden changes: {history.product.brandLock.forbiddenChanges.join(', ') || 'none recorded'} · Locked colors: {history.product.brandLock.lockedColors?.join(', ') || 'none recorded'}</p><p>Recorded facts:</p>{history.product.facts.length ? <ul>{history.product.facts.map((fact) => <li key={fact.factId}>{fact.name}: {fact.value} ({fact.confirmed ? 'confirmed' : 'unconfirmed'})</li>)}</ul> : <p>None recorded.</p>}<p>Product snapshot SHA-256: {history.productSha256}</p></div>
      {history.reviews.length > 0 && <details><summary>Review history</summary><ol>{history.reviews.map((item) => <li key={item.qaId}><p>Review {item.revision} · {new Date(item.createdAt).toLocaleString()} · {item.report.status} · {item.report.weightedScore}/100</p><p>{SCORE_FIELDS.map(([key, label]) => `${label}: ${item.report.scores[key]}/5`).join(' · ')}</p><p>{CHECK_FIELDS.map(([key, label]) => `${label}: ${item.checks[key]}`).join(' · ')}</p>{item.styleId && item.styleChecks && <p>{item.styleId}: {Object.entries(item.styleChecks).map(([key, value]) => `${key} ${value}`).join(' · ')}</p>}{item.report.reviewerNote && <p>Reviewer notes: {item.report.reviewerNote}</p>}{'findings' in item.report && <div><p>Structured findings:</p>{item.report.findings.length === 0 ? <p>None recorded.</p> : <ol>{item.report.findings.map((finding, index) => <li key={index}><strong>{finding.severity}</strong>: {finding.description}{finding.unlocalized ? <p>Global / unlocalized (no region specified)</p> : <>{finding.sourceRegion && <p>Source: {formatRegion(finding.sourceRegion)}</p>}{finding.outputRegion && <p>Output: {formatRegion(finding.outputRegion)}</p>}</>}</li>)}</ol>}</div>}{item.report.hardVetoFindings.map((finding) => <p className="error-message" key={finding.code}>{finding.description}</p>)}{history.decisions.filter((decision) => decision.reportId === item.qaId).map((decision) => <p key={decision.qaId}>{decision.current ? 'Current' : 'Historical'} decision: {decision.decision} · {new Date(decision.createdAt).toLocaleString()}</p>)}</li>)}</ol></details>}
      <form onSubmit={submitReview}>
        <label htmlFor={`qa-variant-${composite.assetId}`}>Product labeling</label><select id={`qa-variant-${composite.assetId}`} value={variant} disabled={busy || disabled} onChange={(event) => { setVariant(event.target.value as ReviewVariant | ''); invalidateDecision(); }}><option value="">Choose labeling</option><option value="default">Branded or readable label</option><option value="unbranded">Unbranded / no readable text</option></select>
        {variant === 'unbranded' && <p>Unbranded weighting is not yet agreed. Scored review and approval are unavailable until that policy is decided.</p>}
        <p>Enter each score from 0 to 5, with up to six decimal places. No score overrides a mismatch.</p>
        {variant === 'default' && !evaluation && findingErrors.length === 0 && <p>Complete all five scores using decimal values from 0 to 5 with at most six fractional digits.</p>}
        {SCORE_FIELDS.map(([key, label]) => <label key={key}>{label} <input type="number" min="0" max="5" step="any" inputMode="decimal" value={scores[key]} disabled={busy || disabled} onChange={(event) => { setScores((old) => ({ ...old, [key]: event.target.value })); invalidateDecision(); }} /></label>)}
        {CHECK_FIELDS.map(([key, label]) => <label key={key}>{label}<select value={checks[key]} disabled={busy || disabled} onChange={(event) => { setChecks((old) => ({ ...old, [key]: event.target.value as ReviewChecks[typeof key] })); invalidateDecision(); }}><option value="UNKNOWN">Cannot verify</option><option value="MATCH">Verified / no issue</option><option value="MISMATCH">Mismatch / prohibited</option></select></label>)}
        {styleId && <fieldset><legend>Style-specific evidence</legend>{STYLE_REVIEW_FIELDS[styleId].map(([key, label]) => <label key={key}>{label}<select value={styleChecks[key]} disabled={busy || disabled} onChange={(event) => { setStyleChecks((old) => ({ ...old, [key]: event.target.value as ReviewCheck })); invalidateDecision(); }}><option value="UNKNOWN">Cannot verify</option><option value="MATCH">Verified / no issue</option><option value="MISMATCH">Mismatch / prohibited</option></select></label>)}</fieldset>}
        <fieldset>
          <legend>Structured findings ({findings.length}/20)</legend>
          <p>Describe each finding in 1–500 characters. Select Global / unlocalized when no truthful pixel location is available. A BLOCKER rejects the review and prevents approval.</p>
          {findings.map((finding, index) => <fieldset key={index}>
            <legend>Finding {index + 1}</legend>
            <label>Severity<select value={finding.severity} disabled={busy || disabled} onChange={(event) => updateFinding(index, (old) => ({ ...old, severity: event.target.value as ReviewFinding['severity'] }))}><option value="BLOCKER">BLOCKER</option><option value="WARN">WARN</option><option value="INFO">INFO</option></select></label>
            <label>Description<textarea maxLength={500} value={finding.description} disabled={busy || disabled} onChange={(event) => updateFinding(index, (old) => ({ ...old, description: event.target.value }))} /></label>
            <label>Location<select value={finding.location} disabled={busy || disabled} onChange={(event) => updateFinding(index, (old) => ({ ...old, location: event.target.value as FindingDraft['location'] }))}><option value="">Choose…</option><option value="global">Global</option><option value="source">Source</option><option value="output">Output</option><option value="both">Both images</option></select></label>
            {(['source', 'output'] as const).filter((side) => finding.location === side || finding.location === 'both').map((side) => <fieldset key={side}>
              <legend>{side === 'source' ? 'Source' : 'Output'} pixel region</legend>
              <p>Whole pixels, measured from the top-left. {side === 'source' ? `Source bounds: ${source?.width ?? 'unknown'} × ${source?.height ?? 'unknown'}` : 'Output bounds: 1024 × 1024'}. Width and height must be at least 1; the rectangle must fit within the image.</p>
              {regionFields.map((field) => <label key={field}>{side === 'source' ? 'Source' : 'Output'} {field}<input type="number" min={field === 'width' || field === 'height' ? 1 : 0} step="1" value={finding[side][field]} disabled={busy || disabled} onChange={(event) => updateFinding(index, (old) => ({ ...old, [side]: { ...old[side], [field]: event.target.value } }))} /></label>)}
            </fieldset>)}
            <button type="button" className="secondary-button" disabled={busy || disabled} onClick={() => { setFindings((old) => old.filter((_, i) => i !== index)); invalidateDecision(); }}>Remove finding {index + 1}</button>
          </fieldset>)}
          <button type="button" className="secondary-button" disabled={busy || disabled || findings.length >= 20} onClick={() => { setFindings((old) => [...old, newFinding()]); invalidateDecision(); }}>Add finding</button>
          {findingErrors.length > 0 && <div role="status"><p>Review cannot be saved until:</p><ul>{findingErrors.map((message) => <li key={message}>{message}</li>)}</ul></div>}
        </fieldset>
        <label htmlFor={`qa-note-${composite.assetId}`}>Review notes {noteRequired ? '(required)' : '(optional)'} — describe each finding and its source/output region or why it cannot be verified</label><textarea id={`qa-note-${composite.assetId}`} maxLength={2000} value={note} disabled={busy || disabled} onChange={(event) => { setNote(event.target.value); invalidateDecision(); }} />
        {noteRequired && !note.trim() && <p>Review notes are required when any check is mismatched or cannot be verified.</p>}
        {evaluation && <p role="status">Proposed status: {evaluation.status}; weighted score {evaluation.weightedScore}/100. {evaluation.hardVetoFindings.length > 0 && 'A hard veto blocks approval.'}</p>}
        <label className="checkbox-label"><input type="checkbox" checked={reviewed} disabled={busy || disabled || !source || !evaluation || (noteRequired && !note.trim())} onChange={(event) => setReviewed(event.target.checked)} /><span>I personally compared this original and composite and marked uncertain or mismatched details honestly.</span></label>
        <button className="secondary-button" type="submit" disabled={busy || disabled || !source || !evaluation || !reviewed || (noteRequired && !note.trim())}>Save this human review</button>
        {hasDraft && <button type="button" className="secondary-button" disabled={busy} onClick={clearDraft}>Discard unsaved review</button>}
      </form>
      {history.importedReviewRequired ? <p>Imported review history is not trusted. Personally inspect the original and composite, then record a new local review before choosing a separate decision.</p> : latest && !latestIsCurrent && <p>The latest review is for an older product snapshot. Record a new review before choosing a decision.</p>}
      {latest && latestIsCurrent && !currentDecision && <div className="visual-decision"><p>A decision is separate from the review. Only a current PASS_CANDIDATE without a veto may be approved. Save or discard an unsaved review first.</p><div className="strict-actions"><button type="button" className="secondary-button" disabled={busy || disabled || hasDraft || latest.report.status !== 'PASS_CANDIDATE'} onClick={() => { setChoice('APPROVED'); setDecisionConfirmed(false); }}>Choose approval</button><button type="button" className="secondary-button" disabled={busy || disabled || hasDraft} onClick={() => { setChoice('REJECTED'); setDecisionConfirmed(false); }}>Choose rejection</button></div>{choice && <><label className="checkbox-label"><input type="checkbox" checked={decisionConfirmed} disabled={busy || disabled || hasDraft} onChange={(event) => setDecisionConfirmed(event.target.checked)} /><span>I explicitly {choice === 'APPROVED' ? 'approve' : 'reject'} this exact reviewed image.</span></label><button type="button" className="primary-button" disabled={busy || disabled || hasDraft || !decisionConfirmed} onClick={() => void submitDecision()}>Record {choice.toLowerCase()} decision</button></>}</div>}
    </>}
  </section>;
}
