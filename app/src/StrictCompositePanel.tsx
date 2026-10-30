import { pixelFieldMax } from './pixelCoordinates';
import { useEffect, useRef, useState } from 'react';
import { listStrictComposites, loadStrictCompositeInputs, saveStrictComposite, type StrictComposite, type StrictCompositeInputs, type StrictMapping, type StudioAsset } from './products';
import { renderStrictComposite, type StrictRecipe } from './strictComposite';
import { sha256 } from './prepareSource';
import { useUnsavedChanges } from './useUnsavedChanges';
import { LocalImage } from './LocalImage';
import { VisualReviewPanel } from './VisualReviewPanel';

type Draft = { inputs: StrictCompositeInputs; blob: Blob; mapping: StrictMapping; ad?: Blob; copyLayer?: Blob; recipe?: StrictRecipe };
function ReviewDisclosure({ productId, productVersion, attemptId, composite, disabled }: { productId: string; productVersion: string; attemptId: string; composite: StrictComposite; disabled: boolean }) {
  const [visited, setVisited] = useState(false);
  return <details onToggle={(event) => { if (event.currentTarget.open) setVisited(true); }}><summary>Review this composite</summary>{visited && <VisualReviewPanel productId={productId} productVersion={productVersion} attemptId={attemptId} composite={composite} disabled={disabled} />}</details>;
}


export function StrictCompositePanel({ productId, productVersion, attemptId, scene, disabled }: { productId: string; productVersion: string; attemptId: string; scene: StudioAsset; disabled: boolean }) {
  const [saved, setSaved] = useState<StrictComposite[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [available, setAvailable] = useState<StrictCompositeInputs | null>(null);
  const [rect, setRect] = useState({ x: '', y: '', width: '', height: '' });
  const [copy, setCopy] = useState('');
  const [frontFacing, setFrontFacing] = useState(false);
  const [nativePlacement, setNativePlacement] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const running = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const alive = useRef(true);
  useUnsavedChanges(busy || draft !== null || Object.values(rect).some(Boolean) || Boolean(copy) || frontFacing);

  useEffect(() => {
    let active = true;
    const loading = new AbortController();
    alive.current = true;
    setSaved(null);
    setAvailable(null);
    void loadStrictCompositeInputs(productId, attemptId, scene.assetId, loading.signal).then((inputs) => { if (active) setAvailable(inputs); }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Inputs are unavailable.'); });
    void listStrictComposites(productId, attemptId).then((items) => { if (active) setSaved(items); }).catch(() => { if (active) setError('Saved composites could not be read.'); });
    return () => { active = false; loading.abort(); alive.current = false; controller.current?.abort(); };
  }, [productId, attemptId, scene.assetId]);

  async function prepare() {
    if (running.current || disabled) return;
    running.current = true; setBusy(true); setError(''); setNotice(''); setDraft(null);
    const abort = new AbortController(); controller.current = abort;
    try {
      const inputs = await loadStrictCompositeInputs(productId, attemptId, scene.assetId, abort.signal);
      if (abort.signal.aborted) return;
      let recipe: StrictRecipe | undefined;
      if (inputs.styleId && inputs.sourceView) {
        recipe = { version: 1, styleId: inputs.styleId, sourceView: inputs.sourceView, ...(inputs.topViewConfirmed ? { topViewConfirmed: true } : {}) };
        if (inputs.styleId === 'macro' || inputs.styleId === 'billboard') {
          if (Object.values(rect).some((value) => !/^\d+$/.test(value))) throw new Error('Enter all four rectangle coordinates as whole pixels.');
          const selection = { x: Number(rect.x), y: Number(rect.y), width: Number(rect.width), height: Number(rect.height) };
          if (inputs.styleId === 'macro') recipe.crop = selection;
          else { recipe.display = selection; if (frontFacing) recipe.displayFrontFacing = true; recipe.copy = copy; }
        }
      }
      const rendered = await renderStrictComposite({ source: inputs.source, mask: inputs.mask, scene: inputs.scene, sourceWidth: inputs.sourceWidth, sourceHeight: inputs.sourceHeight, signal: abort.signal, recipe, protectedEvidence: inputs.protectedEvidence });
      if (recipe && rendered.copyLayer) recipe = { ...recipe, copyLayerSha256: await sha256(new Uint8Array(await rendered.copyLayer.arrayBuffer())) };
      if (!abort.signal.aborted && alive.current) setDraft({ inputs, ...rendered, recipe });
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
      await saveStrictComposite(productId, attemptId, draft.inputs, draft.blob, draft.mapping, abort.signal, draft.recipe, draft.copyLayer);
      if (alive.current) { setDraft(null); setRect({ x: '', y: '', width: '', height: '' }); setCopy(''); setFrontFacing(false); setNotice('Unapproved composite saved locally. Review the original label, geometry, mask and scene before any approval.'); }
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
    {available && <p>{available.protectedEvidence ? `${available.protectedEvidence.regions.length} protected ${available.protectedEvidence.regions.length === 1 ? 'area' : 'areas'} will be checked during preview and save and required for approval and export. This cannot prove every detail is selected or legible.` : 'This mask has no protected areas. Preview and save cannot verify label coverage; this composite cannot be approved or exported.'}</p>}
    {available?.styleId && <p>Recipe: {available.styleId}; source viewpoint: {available.sourceView}. {available.styleId === 'flat_lay' && available.sourceView === 'OTHER' && 'The original non-top viewpoint is retained; this is an adapted arrangement, not an invented top view.'}</p>}
    {(available?.styleId === 'macro' || available?.styleId === 'billboard') && <fieldset disabled={busy || draft !== null}>
      <legend>{available.styleId === 'macro' ? 'Choose an oriented source-pixel crop' : 'Inspect the scene and select the rectangular display in 1024 × 1024 scene pixels'}</legend>
      <label className="checkbox-label"><input type="checkbox" checked={nativePlacement} onChange={(event) => setNativePlacement(event.target.checked)} /><span>View selection at native pixel size</span></label>
      <figure><div className="strict-zoom" role="region" tabIndex={0} aria-label={available.styleId === 'macro' ? 'Source crop selection' : 'Billboard display selection'}><div style={{ position: 'relative', width: nativePlacement ? (available.styleId === 'macro' ? available.sourceWidth : 1024) : 'min(100%, 420px)' }}><LocalImage blob={available.styleId === 'macro' ? available.source : available.scene} alt={available.styleId === 'macro' ? 'Original source for crop selection' : 'Scene for display inspection'} nativeWidth={nativePlacement ? (available.styleId === 'macro' ? available.sourceWidth : 1024) : undefined} />{Object.values(rect).every((value) => /^\d+$/.test(value)) && <div className="strict-selection-outline" aria-hidden="true" style={{ left: `${Number(rect.x) / (available.styleId === 'macro' ? available.sourceWidth : 1024) * 100}%`, top: `${Number(rect.y) / (available.styleId === 'macro' ? available.sourceHeight : 1024) * 100}%`, width: `${Number(rect.width) / (available.styleId === 'macro' ? available.sourceWidth : 1024) * 100}%`, height: `${Number(rect.height) / (available.styleId === 'macro' ? available.sourceHeight : 1024) * 100}%` }} />}</div></div><figcaption>{available.styleId === 'macro' ? `Source ${available.sourceWidth} × ${available.sourceHeight}; the outline follows the entered coordinates.` : 'Select only an unobstructed, front-facing display; the outline follows the entered coordinates.'}</figcaption></figure>
      <div className="strict-rect-fields">{(['x', 'y', 'width', 'height'] as const).map((key) => <label key={key}>{key}<input type="number" min={key === 'width' || key === 'height' ? 1 : 0} max={pixelFieldMax(key, available.styleId === 'macro' ? available.sourceWidth : 1024, available.styleId === 'macro' ? available.sourceHeight : 1024)} step="1" value={rect[key]} onChange={(event) => setRect({ ...rect, [key]: event.target.value })} /></label>)}</div>
      {available.styleId === 'macro' ? <p>Only visible source pixels are used. Cropping can exclude required labels; inspect them and the effective resolution before approval.</p> : <>
        <label className="checkbox-label"><input type="checkbox" checked={frontFacing} onChange={(event) => setFrontFacing(event.target.checked)} /><span>I inspected this display and it is front-facing and unobstructed.</span></label>
        <label>Exact ad copy (optional, one line)<input type="text" maxLength={100} value={copy} onChange={(event) => setCopy(event.target.value)} /></label>
      </>}
    </fieldset>}
    <button className="secondary-button" type="button" disabled={disabled || busy || draft !== null || !available} onClick={() => void prepare()}>{busy ? 'Working…' : 'Prepare local composite'}</button>
    {busy && <button className="secondary-button" type="button" onClick={() => controller.current?.abort()}>Cancel rendering or save</button>}
    {error && <p className="error-message" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {draft && <div>
      <p>Compare the original with the unapproved composite. Check every label and edge: the mask can hide product details and no automated score can approve them.</p>
      <label htmlFor={`strict-zoom-${attemptId}`}>Comparison zoom: {zoom}%</label><input id={`strict-zoom-${attemptId}`} type="range" min="100" max="400" step="25" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
      {draft.recipe?.crop && <p>Native crop: {draft.recipe.crop.width} × {draft.recipe.crop.height} source pixels. The output is 1024 × 1024 and does not add source detail; labels outside the crop are not verifiable.</p>}
      <div className="strict-comparison"><figure><div className="strict-zoom" role="region" aria-label="Original source zoom area" tabIndex={0}><LocalImage blob={draft.inputs.source} alt="Original product reference" zoom={zoom} /></div><figcaption>Original source</figcaption></figure><figure><div className="strict-zoom" role="region" aria-label="Composite zoom area" tabIndex={0}><LocalImage blob={draft.blob} alt="Unapproved source-layer composite" zoom={zoom} /></div><figcaption>Unapproved composite</figcaption></figure></div>
      {draft.ad && <figure><LocalImage blob={draft.ad} alt="Complete locally composed billboard advertisement" /><figcaption>Complete advertisement before uniform placement on the inspected display.</figcaption></figure>}
      <p>Source {draft.mapping.sourceWidth} × {draft.mapping.sourceHeight}; mapped to {draft.mapping.width.toFixed(2)} × {draft.mapping.height.toFixed(2)} at ({draft.mapping.x.toFixed(2)}, {draft.mapping.y.toFixed(2)}) on a 1024 × 1024 background. Resampling may change pixels.</p>
      <div className="strict-actions"><button className="primary-button" type="button" disabled={disabled || busy} onClick={() => void save()}>Save unapproved composite</button><button className="secondary-button" type="button" disabled={busy} onClick={() => setDraft(null)}>Discard preview</button></div>
    </div>}
    {saved === null ? <p role="status">Loading saved composites…</p> : saved.length > 0 && <div><h5>Saved composites</h5>{saved.map((item) => <div key={item.assetId}><figure><LocalImage blob={item.blob} alt="Saved source-layer composite" /><figcaption>{new Date(item.createdAt).toLocaleString()} · SHA-256 {item.sha256.slice(0, 12)}… · source {item.sourceSha256.slice(0, 12)}… · mask {item.maskSha256.slice(0, 12)}… · scene {item.sceneSha256.slice(0, 12)}…</figcaption></figure>{item.ad && <figure><LocalImage blob={item.ad} alt="Saved complete advertisement" /><figcaption>Complete local ad · SHA-256 {item.adSha256?.slice(0, 12)}…</figcaption></figure>}<ReviewDisclosure productId={productId} productVersion={productVersion} attemptId={attemptId} composite={item} disabled={disabled || busy} /></div>)}</div>}
  </div>;
}
