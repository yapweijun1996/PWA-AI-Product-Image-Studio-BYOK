import { regionFromDrag } from './protectedRegion';
import { pixelFieldMax } from './pixelCoordinates';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { getProduct, loadSourceMask, loadOriginalSource, saveMask, type Product } from './products';
import { paintStroke, renderMask, type MaskPoint, type MaskStroke } from './maskRendering';
import { useUnsavedChanges } from './useUnsavedChanges';
import type { StrictRect } from './strictComposite';

type Source = Product['sourceAssets'][number];
type Loaded = { source: Source; sourceUrl: string; original: Blob; base: Blob | null; expectedMaskId: string | null };
type RegionDraft = { id: string; x: string; y: string; width: string; height: string };
const MAX_POINTS = 50000;

export function MaskEditor({ product, onChange }: { product: Product; onChange: (product: Product) => void }) {
  const [sourceId, setSourceId] = useState('');
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [review, setReview] = useState(false);
  const [tool, setTool] = useState<'draw' | 'erase' | 'region'>('draw');
  const [regionPreview, setRegionPreview] = useState<StrictRect | null>(null);
  const [selectingRegion, setSelectingRegion] = useState(false);
  const [size, setSize] = useState(5);
  const [zoom, setZoom] = useState(100);
  const [showMask, setShowMask] = useState(true);
  const [regions, setRegions] = useState<RegionDraft[]>([]);
  const [x, setX] = useState(50);
  const [y, setY] = useState(50);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);
  const previewWork = useRef<HTMLCanvasElement | null>(null);
  const previewSource = useRef<ImageData | null>(null);
  const strokes = useRef<MaskStroke[]>([]);
  const active = useRef<MaskStroke | null>(null);
  const regionDrag = useRef<{ pointerId: number; start: MaskPoint } | null>(null);
  const points = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useUnsavedChanges(dirty || saving || selectingRegion);

  useEffect(() => {
    if (!sourceId) { setLoaded(null); return; }
    let alive = true;
    let url = '';
    setLoading(true); setLoaded(null); setError(''); setStatus(''); setReview(false); setRegions([]);
    strokes.current = []; points.current = 0; active.current = null; regionDrag.current = null; setRegionPreview(null); setSelectingRegion(false); setDirty(false);
    void (async () => {
      try {
        const current = await getProduct(product.productId);
        const source = current?.sourceAssets.find((item) => item.assetId === sourceId);
        if (!current || !source) throw new Error('This source is no longer available.');
        if (source.width > 20000 || source.height > 20000 || source.width * source.height > 24_000_000) throw new Error('The source exceeds the safe mask size limit.');
        const expectedMaskId = current.brandLock.maskAssetId;
        const [original, mask] = await Promise.all([loadOriginalSource(product.productId, source), loadSourceMask(product.productId, source)]);
        const latest = await getProduct(product.productId);
        if (!latest || latest.brandLock.maskAssetId !== expectedMaskId) throw new Error('The active mask changed while loading. Select the source again.');
        if (!alive) return;
        url = URL.createObjectURL(original);
        const image = new Image();
        await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('The verified source could not be decoded.')); image.src = url; });
        if (image.naturalWidth !== source.width || image.naturalHeight !== source.height) throw new Error('This browser could not apply the source orientation safely.');
        if (alive) {
          setRegions((mask?.protectedEvidence?.regions ?? []).map((region) => ({ id: crypto.randomUUID(), x: String(region.x), y: String(region.y), width: String(region.width), height: String(region.height) })));
          setLoaded({ source, sourceUrl: url, original, base: mask?.blob ?? null, expectedMaskId });
        }
      } catch (reason) {
        if (alive) setError(reason instanceof Error ? reason.message : 'The source or mask could not be loaded.');
      } finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; if (url) URL.revokeObjectURL(url); controller.current?.abort(); };
  }, [product.productId, sourceId]);

  useEffect(() => {
    if (!loaded || !canvas.current) return;
    const target = canvas.current;
    const scale = Math.min(1, 1600 / Math.max(loaded.source.width, loaded.source.height));
    target.width = Math.max(1, Math.round(loaded.source.width * scale));
    target.height = Math.max(1, Math.round(loaded.source.height * scale));
    const work = document.createElement('canvas');
    work.width = target.width; work.height = target.height;
    const context = work.getContext('2d', { willReadFrequently: true });
    const display = target.getContext('2d');
    if (!context || !display) { setError('The mask preview is unavailable on this device.'); return; }
    let cancelled = false;
    let baseUrl = '';
    setPreviewReady(false);
    previewWork.current = work;
    previewSource.current = null;
    const decode = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('The mask preview could not be decoded.'));
      image.src = url;
    });
    void (async () => {
      try {
        const sourceImage = await decode(loaded.sourceUrl);
        if (cancelled) return;
        context.drawImage(sourceImage, 0, 0, target.width, target.height);
        const sourcePixels = context.getImageData(0, 0, target.width, target.height);
        previewSource.current = sourcePixels;
        if (loaded.base) {
          baseUrl = URL.createObjectURL(loaded.base);
          const mask = await decode(baseUrl);
          if (cancelled) return;
          if (mask.naturalWidth !== loaded.source.width || mask.naturalHeight !== loaded.source.height) throw new Error('The mask preview dimensions do not match the source.');
          context.clearRect(0, 0, target.width, target.height);
          context.drawImage(mask, 0, 0, target.width, target.height);
        } else {
          context.globalCompositeOperation = 'source-in';
          context.fillStyle = '#fff'; context.fillRect(0, 0, target.width, target.height);
          context.globalCompositeOperation = 'source-over';
        }
        const result = context.getImageData(0, 0, target.width, target.height);
        for (let i = 3; i < result.data.length; i += 4) result.data[i] = Math.min(result.data[i], sourcePixels.data[i]);
        display.putImageData(result, 0, 0);
        setPreviewReady(true);
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'The mask preview could not be created.');
      } finally { if (baseUrl) URL.revokeObjectURL(baseUrl); }
    })();
    return () => {
      cancelled = true;
      if (baseUrl) URL.revokeObjectURL(baseUrl);
      if (previewWork.current === work) { previewWork.current = null; previewSource.current = null; }
      work.width = 0; work.height = 0;
    };
  }, [loaded]);

  function chooseSource(id: string) {
    if (saving || loading || regionDrag.current || id === sourceId) return;
    if (dirty && !window.confirm('Discard unsaved mask changes and switch sources?')) return;
    setSourceId(id);
  }
  function paint(stroke: MaskStroke, skipInitial = false) {
    const target = canvas.current;
    const work = previewWork.current;
    const source = previewSource.current;
    const context = work?.getContext('2d');
    const display = target?.getContext('2d');
    if (!target || !work || !source || !context || !display || !loaded) return;
    const sx = target.width / loaded.source.width;
    const sy = target.height / loaded.source.height;
    context.save();
    context.scale(sx, sy);
    paintStroke(context, stroke, skipInitial);
    context.restore();
    const radius = stroke.size / 2 + 2 / Math.min(sx, sy);
    const xs = stroke.points.map((point) => point.x);
    const ys = stroke.points.map((point) => point.y);
    const left = Math.max(0, Math.floor((Math.min(...xs) - radius) * sx));
    const top = Math.max(0, Math.floor((Math.min(...ys) - radius) * sy));
    const right = Math.min(target.width, Math.ceil((Math.max(...xs) + radius) * sx));
    const bottom = Math.min(target.height, Math.ceil((Math.max(...ys) + radius) * sy));
    if (right <= left || bottom <= top) return;
    const pixels = context.getImageData(left, top, right - left, bottom - top);
    for (let y = 0; y < pixels.height; y++) for (let x = 0; x < pixels.width; x++) {
      const pixel = (y * pixels.width + x) * 4 + 3;
      const original = ((top + y) * target.width + left + x) * 4 + 3;
      pixels.data[pixel] = Math.min(pixels.data[pixel], source.data[original]);
    }
    display.putImageData(pixels, left, top);
  }
  function start(point: MaskPoint) {
    if (!loaded || !previewReady || saving || review || error || tool === 'region' || points.current >= MAX_POINTS) return;
    const stroke: MaskStroke = { tool, size: Math.max(1, Math.min(loaded.source.width, loaded.source.height) * size / 100), points: [point] };
    strokes.current.push(stroke); active.current = stroke; points.current++;
    paint(stroke); setDirty(true); setStatus('');
  }
  function move(point: MaskPoint) {
    const stroke = active.current;
    if (!stroke) return;
    if (points.current >= MAX_POINTS) { active.current = null; setError('The stroke limit was reached. Review and save before adding more.'); return; }
    const previous = stroke.points[stroke.points.length - 1];
    stroke.points.push(point); points.current++;
    paint({ ...stroke, points: [previous, point] }, true);
  }
  function position(event: PointerEvent<HTMLCanvasElement>): MaskPoint {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(loaded!.source.width, (event.clientX - rect.left) / rect.width * loaded!.source.width)), y: Math.max(0, Math.min(loaded!.source.height, (event.clientY - rect.top) / rect.height * loaded!.source.height)) };
  }
  function pointerDown(event: PointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0 || !event.isPrimary || regionDrag.current || active.current || !loaded || !previewReady || saving || review || error) return;
    if (tool === 'region' && regions.length >= 32) { setStatus('A maximum of 32 protected areas is allowed.'); return; }
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === 'region') { regionDrag.current = { pointerId: event.pointerId, start: position(event) }; setRegionPreview(null); setSelectingRegion(true); }
    else start(position(event));
  }
  function pointerMove(event: PointerEvent<HTMLCanvasElement>) {
    if (!event.isPrimary) return;
    const drag = regionDrag.current;
    if (drag && drag.pointerId === event.pointerId && loaded) {
      event.preventDefault(); setRegionPreview(regionFromDrag(drag.start, position(event), loaded.source.width, loaded.source.height));
    } else if (active.current) { event.preventDefault(); move(position(event)); }
  }
  function pointerUp(event: PointerEvent<HTMLCanvasElement>) {
    const drag = regionDrag.current;
    if (drag && drag.pointerId === event.pointerId && loaded) {
      const region = regionFromDrag(drag.start, position(event), loaded.source.width, loaded.source.height);
      regionDrag.current = null; setRegionPreview(null); setSelectingRegion(false);
      if (region) {
        setRegions((current) => current.length >= 32 ? current : [...current, { id: crypto.randomUUID(), x: String(region.x), y: String(region.y), width: String(region.width), height: String(region.height) }]);
        setDirty(true); setStatus('Protected area added. Check the outline and coordinates before saving.');
      } else setStatus('Drag across an area at least one source pixel wide and high, or enter coordinates below.');
    }
    active.current = null;
  }
  function cancelPointer() {
    const abandoned = Boolean(regionDrag.current);
    active.current = null; regionDrag.current = null; setRegionPreview(null); setSelectingRegion(false);
    if (abandoned) setStatus('Unfinished protected area discarded. Draw it again or enter coordinates below.');
  }
  function pointerCancel(event: PointerEvent<HTMLCanvasElement>) {
    if (regionDrag.current && regionDrag.current.pointerId !== event.pointerId) return;
    cancelPointer();
  }
  function parsedRegions(): StrictRect[] {
    return regions.map((region) => {
      const values = [region.x, region.y, region.width, region.height];
      if (values.some((value) => !/^\d+$/.test(value))) throw new Error('Enter whole source-pixel coordinates for each protected area.');
      const [x, y, width, height] = values.map(Number);
      if (![x, y, width, height].every(Number.isSafeInteger) || width < 1 || height < 1 ||
          x + width > loaded!.source.width || y + height > loaded!.source.height)
        throw new Error('Each protected area must have positive dimensions and fit inside the source.');
      return { x, y, width, height };
    });
  }
  async function save() {
    if (!loaded || !review || saving) return;
    setSaving(true); setError(''); setStatus('');
    const abort = new AbortController(); controller.current = abort;
    try {
      const protectedRegions = parsedRegions();
      const blob = await renderMask(loaded.source.width, loaded.source.height, loaded.original, loaded.base, strokes.current, abort.signal);
      if (abort.signal.aborted) return;
      const saved = await saveMask(product.productId, loaded.source, blob, loaded.expectedMaskId, protectedRegions.length ? protectedRegions : undefined);
      if (abort.signal.aborted) return;
      onChange(saved);
      strokes.current = []; points.current = 0;
      setLoaded({ ...loaded, base: blob, expectedMaskId: saved.brandLock.maskAssetId });
      setDirty(false); setReview(false); setStatus('Mask saved locally. The original source was not changed.');
    } catch (reason) { if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : 'The mask could not be saved.'); }
    finally { if (!abort.signal.aborted) setSaving(false); if (controller.current === abort) controller.current = null; }
  }
  return <section className="product-section mask-editor" aria-labelledby="mask-heading">
    <span className="section-kicker">MANUAL SELECTION</span><h2 id="mask-heading">Edit a mask</h2>
    <p className="muted">The initial selection includes the source's visible pixels, including any background. Erase areas you do not want, or draw to restore them. Each save creates a separate mask version and makes it active for this product; the original remains unchanged. No image is sent to a provider.</p>
    {product.sourceAssets.length === 0 ? <p className="muted">Add a source image to begin.</p> : <><label htmlFor="mask-source">Source image</label><select id="mask-source" value={sourceId} disabled={saving || loading || selectingRegion} onChange={(event) => chooseSource(event.target.value)}><option value="">Choose a source</option>{product.sourceAssets.map((source) => <option value={source.assetId} key={source.assetId}>{source.filename}</option>)}</select></>}
    {loading && <p role="status">Verifying the source and loading its mask…</p>}
    {error && !review && <p className="error-message" role="alert">{error}</p>}
    {status && <p role="status">{status}</p>}
    {loaded && <>
      <div className="mask-controls"><label htmlFor="mask-tool">Tool</label><select id="mask-tool" value={tool} disabled={saving || review} onChange={(event) => { cancelPointer(); setTool(event.target.value as 'draw' | 'erase' | 'region'); }}><option value="draw">Draw selection</option><option value="erase">Erase selection</option><option value="region">Select protected area</option></select><label htmlFor="mask-size">Brush size: {size}%</label><input id="mask-size" type="range" min="1" max="30" value={size} disabled={saving || review || tool === 'region'} onChange={(event) => setSize(Number(event.target.value))} /><label htmlFor="mask-zoom">Zoom: {zoom}%</label><input id="mask-zoom" type="range" min="50" max="300" step="25" value={zoom} disabled={selectingRegion} onChange={(event) => setZoom(Number(event.target.value))} /><label className="checkbox-label"><input type="checkbox" checked={showMask} onChange={(event) => setShowMask(event.target.checked)} /> Show mask overlay</label></div>
      <p className="muted">Choose a tool, then drag on the image with a mouse, pen or finger. White overlay indicates selected pixels; the protected-area tool adds a rectangle without changing the mask. Zoom and scroll to inspect edges. Focus the mask viewport and use arrow keys to scroll.</p>
      <div className="mask-viewport" role="region" aria-label="Mask viewport" tabIndex={0}><div className="mask-surface" style={{ width: `${zoom}%`, aspectRatio: `${loaded.source.width} / ${loaded.source.height}` }}><img src={loaded.sourceUrl} alt={`Verified source: ${loaded.source.filename}`} draggable={false} /><canvas ref={canvas} className={showMask ? '' : 'mask-hidden'} aria-label="Mask drawing surface" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerCancel} onLostPointerCapture={pointerCancel} />{regionPreview && <div className="mask-region-outline mask-region-preview" aria-hidden="true" style={{ left: `${regionPreview.x / loaded.source.width * 100}%`, top: `${regionPreview.y / loaded.source.height * 100}%`, width: `${regionPreview.width / loaded.source.width * 100}%`, height: `${regionPreview.height / loaded.source.height * 100}%` }} />}{regions.map((region, index) => {
        const values = [region.x, region.y, region.width, region.height];
        if (values.some((value) => !/^\d+$/.test(value))) return null;
        const [rx, ry, rw, rh] = values.map(Number);
        if (![rx, ry, rw, rh].every(Number.isSafeInteger) || rw < 1 || rh < 1 || rx + rw > loaded.source.width || ry + rh > loaded.source.height) return null;
        return <div key={region.id} className="mask-region-outline" aria-hidden="true" style={{ left: `${rx / loaded.source.width * 100}%`, top: `${ry / loaded.source.height * 100}%`, width: `${rw / loaded.source.width * 100}%`, height: `${rh / loaded.source.height * 100}%` }}><span>{index + 1}</span></div>;
      })}</div></div>
      <fieldset className="mask-stamp" disabled={saving || review || !previewReady || tool === 'region'}><legend>Place a brush mark without dragging</legend><label htmlFor="mask-x">Horizontal position (%)</label><input id="mask-x" type="number" min="0" max="100" value={x} onChange={(event) => setX(Number(event.target.value))} /><label htmlFor="mask-y">Vertical position (%)</label><input id="mask-y" type="number" min="0" max="100" value={y} onChange={(event) => setY(Number(event.target.value))} /><button className="secondary-button" type="button" onClick={() => { start({ x: Math.max(0, Math.min(100, x)) * loaded.source.width / 100, y: Math.max(0, Math.min(100, y)) * loaded.source.height / 100 }); active.current = null; }}>Apply brush mark</button></fieldset>
      <fieldset className="mask-regions" disabled={saving || review || !previewReady || selectingRegion}>
        <legend>Protected areas (optional)</legend>
        <p>Select the protected-area tool and drag a rectangle, or enter source-pixel coordinates below to avoid dragging. Mark every visible label or other required detail. The mask must fully cover each area. Areas are saved with this mask version and required for approval and export. Selecting areas cannot guarantee you found every detail.</p>
        <p>Source: {loaded.source.width} × {loaded.source.height} pixels. Coordinates start at the top-left. Outlines show valid areas on the image above.</p>
        {regions.map((region, index) => <fieldset className="mask-region" key={region.id}>
          <legend>Area {index + 1}</legend>
          <div className="mask-region-fields">{(['x', 'y', 'width', 'height'] as const).map((key) => <label key={key}>{({ x: 'Left', y: 'Top', width: 'Width', height: 'Height' })[key]} (px)<input type="number" inputMode="numeric" min={key === 'width' || key === 'height' ? 1 : 0} max={pixelFieldMax(key, loaded.source.width, loaded.source.height)} step="1" value={region[key]} onChange={(event) => { const value = event.target.value; setRegions((current) => current.map((item) => item.id === region.id ? { ...item, [key]: value } : item)); setDirty(true); setStatus(''); }} /></label>)}</div>
          <button className="secondary-button" type="button" onClick={() => { setRegions((current) => current.filter((item) => item.id !== region.id)); setDirty(true); setStatus(''); }}>Remove area {index + 1}</button>
        </fieldset>)}
        <button className="secondary-button" type="button" disabled={regions.length >= 32} onClick={() => { setRegions((current) => [...current, { id: crypto.randomUUID(), x: '0', y: '0', width: '1', height: '1' }]); setDirty(true); setStatus(''); }}>Add protected area</button>
      </fieldset>
      {error && review && <p className="error-message" role="alert">{error}</p>}
      <div className="form-actions">{review ? <><button className="secondary-button" type="button" disabled={saving} onClick={() => { setError(''); setReview(false); }}>Continue editing</button><button className="primary-button" type="button" disabled={saving} onClick={() => void save()}>{saving ? 'Rendering and saving…' : 'Save mask'}</button></> : <button className="primary-button" type="button" disabled={saving || !previewReady || selectingRegion} onClick={() => { if (regionDrag.current) return; active.current = null; setError(''); setShowMask(true); setReview(true); }}>Review mask</button>}</div>
      {selectingRegion && <p role="status">Finish or cancel the current protected area before reviewing.</p>}
      {review && <p role="status">Review the white selection and its edges above before saving. Saving creates a separate full-resolution PNG mask.</p>}
    </>}
  </section>;
}
