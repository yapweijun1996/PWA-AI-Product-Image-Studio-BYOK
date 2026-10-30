import { useEffect, useRef, useState } from 'react';
import { listStrictComposites, loadStrictCompositeInputs, saveStrictComposite, type StrictComposite, type StrictCompositeInputs, type StrictMapping, type StudioAsset } from './products';
import { renderStrictComposite } from './strictComposite';
import { useUnsavedChanges } from './useUnsavedChanges';
import { LocalImage } from './LocalImage';
import { VisualReviewPanel } from './VisualReviewPanel';

type Draft = { inputs: StrictCompositeInputs; blob: Blob; mapping: StrictMapping };
function ReviewDisclosure({ productId, productVersion, attemptId, composite, disabled }: { productId: string; productVersion: string; attemptId: string; composite: StrictComposite; disabled: boolean }) {
  const [visited, setVisited] = useState(false);
  return <details onToggle={(event) => { if (event.currentTarget.open) setVisited(true); }}><summary>Review this composite</summary>{visited && <VisualReviewPanel productId={productId} productVersion={productVersion} attemptId={attemptId} composite={composite} disabled={disabled} />}</details>;
}


export function StrictCompositePanel({ productId, productVersion, attemptId, scene, disabled }: { productId: string; productVersion: string; attemptId: string; scene: StudioAsset; disabled: boolean }) {
  const [saved, setSaved] = useState<StrictComposite[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [zoom, setZoom] = useState(100);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const running = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const alive = useRef(true);
  useUnsavedChanges(busy || draft !== null);

  useEffect(() => {
    alive.current = true;
    setSaved(null);
    void listStrictComposites(productId, attemptId).then((items) => { if (alive.current) setSaved(items); }).catch(() => { if (alive.current) setError('Saved composites could not be read.'); });
    return () => { alive.current = false; controller.current?.abort(); };
  }, [productId, attemptId]);

  async function prepare() {
    if (running.current || disabled) return;
    running.current = true; setBusy(true); setError(''); setNotice(''); setDraft(null);
    const abort = new AbortController(); controller.current = abort;
    try {
      const inputs = await loadStrictCompositeInputs(productId, attemptId, scene.assetId, abort.signal);
      if (abort.signal.aborted) return;
      const rendered = await renderStrictComposite({ source: inputs.source, mask: inputs.mask, scene: inputs.scene, sourceWidth: inputs.sourceWidth, sourceHeight: inputs.sourceHeight, signal: abort.signal });
      if (!abort.signal.aborted && alive.current) setDraft({ inputs, ...rendered });
    } catch (reason) {
      if (!abort.signal.aborted && alive.current) setError(reason instanceof Error ? reason.message : 'The composite could not be prepared.');
    } finally {
      if (controller.current === abort) controller.current = null;
      running.current = false;
      if (alive.current) setBusy(false);
    }
  }

  async function save() {
    if (running.current || disabled || !draft) return;
    running.current = true; setBusy(true); setError(''); setNotice('');
    const abort = new AbortController(); controller.current = abort;
    try {
      await saveStrictComposite(productId, attemptId, draft.inputs, draft.blob, draft.mapping, abort.signal);
      if (alive.current) { setDraft(null); setNotice('Unapproved composite saved locally. Review the original label, geometry, mask and scene before any approval.'); }
      try {
        const items = await listStrictComposites(productId, attemptId);
        if (alive.current) setSaved(items);
      } catch {
        if (alive.current) { setSaved(null); setError('The composite was saved, but its history could not be refreshed. Reload the workspace to view it.'); }
      }
    } catch (reason) {
      if (alive.current) setError(reason instanceof Error ? reason.message : 'The composite could not be saved.');
    } finally {
      if (controller.current === abort) controller.current = null;
      running.current = false;
      if (alive.current) setBusy(false);
    }
  }

  return <div className="strict-composite">
    <h4>STRICT source-layer composite</h4>
    <p><strong>Original product layer; AI-generated environment.</strong></p>
    <p>Place the verified original and its saved mask over this background locally. The original viewpoint is retained; resizing can change sampled pixels. No perspective or hidden face is invented. This is not a QA approval.</p>
    <button className="secondary-button" type="button" disabled={disabled || busy || draft !== null} onClick={() => void prepare()}>{busy ? 'Working…' : 'Prepare local composite'}</button>
    {error && <p className="error-message" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {draft && <div>
      <p>Compare the original with the unapproved composite. Check every label and edge: the mask can hide product details and no automated score can approve them.</p>
      <label htmlFor={`strict-zoom-${attemptId}`}>Comparison zoom: {zoom}%</label><input id={`strict-zoom-${attemptId}`} type="range" min="100" max="400" step="25" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
      <div className="strict-comparison"><figure><div className="strict-zoom" role="region" aria-label="Original source zoom area" tabIndex={0}><LocalImage blob={draft.inputs.source} alt="Original product reference" zoom={zoom} /></div><figcaption>Original source</figcaption></figure><figure><div className="strict-zoom" role="region" aria-label="Composite zoom area" tabIndex={0}><LocalImage blob={draft.blob} alt="Unapproved source-layer composite" zoom={zoom} /></div><figcaption>Unapproved composite</figcaption></figure></div>
      <p>Source {draft.mapping.sourceWidth} × {draft.mapping.sourceHeight}; uniformly mapped to {draft.mapping.width.toFixed(2)} × {draft.mapping.height.toFixed(2)} at ({draft.mapping.x.toFixed(2)}, {draft.mapping.y.toFixed(2)}) on a 1024 × 1024 background.</p>
      <div className="strict-actions"><button className="primary-button" type="button" disabled={disabled || busy} onClick={() => void save()}>Save unapproved composite</button><button className="secondary-button" type="button" disabled={busy} onClick={() => setDraft(null)}>Discard preview</button></div>
    </div>}
    {saved === null ? <p role="status">Loading saved composites…</p> : saved.length > 0 && <div><h5>Saved composites</h5>{saved.map((item) => <div key={item.assetId}><figure><LocalImage blob={item.blob} alt="Saved source-layer composite" /><figcaption>{new Date(item.createdAt).toLocaleString()} · SHA-256 {item.sha256.slice(0, 12)}… · source {item.sourceSha256.slice(0, 12)}… · mask {item.maskSha256.slice(0, 12)}… · scene {item.sceneSha256.slice(0, 12)}…</figcaption></figure><ReviewDisclosure productId={productId} productVersion={productVersion} attemptId={attemptId} composite={item} disabled={disabled || busy} /></div>)}</div>}
  </div>;
}
