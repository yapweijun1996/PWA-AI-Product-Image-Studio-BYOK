import { useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent } from 'react';
import { loadOriginalSource, saveSource, type Product } from './products';
import { prepareSource, type PreparedSource } from './prepareSource';
import { useUnsavedChanges } from './useUnsavedChanges';

type CameraView = Product['sourceAssets'][number]['cameraView'];

export function SourcePanel({ product, onChange }: { product: Product; onChange: (value: Product) => void }) {
  const [candidate, setCandidate] = useState<PreparedSource | null>(null);
  const [cameraView, setCameraView] = useState<CameraView>('UNKNOWN');
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [original, setOriginal] = useState<{ url: string; name: string } | null>(null);
  const [viewing, setViewing] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(false);
  useUnsavedChanges(Boolean(candidate || processing || saving));

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => () => { if (candidate) URL.revokeObjectURL(candidate.previewUrl); }, [candidate]);
  useEffect(() => () => { if (original) URL.revokeObjectURL(original.url); }, [original]);

  async function selectFile(files: FileList | null) {
    if (!files?.length || busy.current || saving) return;
    if (files.length !== 1) { setError('Choose one source image at a time.'); return; }
    busy.current = true;
    setProcessing(true); setError('');
    try {
      const prepared = await prepareSource(files[0]);
      if (mounted.current) { setCandidate(prepared); setCameraView('UNKNOWN'); }
      else URL.revokeObjectURL(prepared.previewUrl);
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : 'The image could not be prepared.');
    } finally {
      busy.current = false;
      if (mounted.current) setProcessing(false);
    }
  }

  function onInput(event: ChangeEvent<HTMLInputElement>) {
    void selectFile(event.target.files);
    event.target.value = '';
  }
  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    void selectFile(event.dataTransfer.files);
  }
  function onPaste(event: ClipboardEvent<HTMLDivElement>) {
    if (event.clipboardData.files.length) {
      event.preventDefault();
      void selectFile(event.clipboardData.files);
    }
  }
  async function persist() {
    if (!candidate || saving || processing) return;
    setSaving(true); setError('');
    try {
      const saved = await saveSource(product.productId, candidate, cameraView);
      if (mounted.current) { onChange(saved); setCandidate(null); }
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : 'The source could not be saved.');
    } finally {
      if (mounted.current) setSaving(false);
    }
  }
  async function showOriginal(metadata: Product['sourceAssets'][number]) {
    if (viewing) return;
    setViewing(true); setError(''); setOriginal(null);
    try {
      const blob = await loadOriginalSource(product.productId, metadata);
      const url = URL.createObjectURL(blob);
      if (mounted.current) setOriginal({ url, name: metadata.filename });
      else URL.revokeObjectURL(url);
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : 'The source cannot be verified.');
    } finally {
      if (mounted.current) setViewing(false);
    }
  }

  return <section className="product-section source-panel" aria-labelledby="source-heading">
    <span className="section-kicker">ORIGINAL REFERENCE</span><h2 id="source-heading">Source images</h2>
    <p className="muted">Add a product photo you have rights to use. The original file stays unchanged in this browser; it may contain EXIF metadata such as location.</p>
    {product.sourceAssets.length > 0 && <ul className="source-list">{product.sourceAssets.map((asset) => <li key={asset.assetId}><div><strong>{asset.filename}</strong><small>{asset.width} × {asset.height} · {asset.cameraView.toLowerCase()} · SHA-256 {asset.sha256.slice(0, 12)}…</small></div><button type="button" className="secondary-button" disabled={viewing || saving} onClick={() => showOriginal(asset)}>View original</button></li>)}</ul>}
    {original && <div className="source-preview"><img src={original.url} alt={`Original source: ${original.name}`} /><button type="button" className="secondary-button" onClick={() => setOriginal(null)}>Close original</button></div>}
    <div className="source-drop" tabIndex={0} onDragOver={(event) => event.preventDefault()} onDrop={onDrop} onPaste={onPaste} aria-label="Source image drop and paste area">
      <p>Drop or paste one PNG, JPEG or WebP here, or choose a file.</p>
      <label className="secondary-button" htmlFor="source-file">Choose image</label><input id="source-file" type="file" accept="image/png,image/jpeg,image/webp" onChange={onInput} disabled={processing || saving} />
      <small>Maximum 20 MiB and 24 megapixels. Animated images are not supported.</small>
    </div>
    {processing && <p className="muted" role="status">Preparing a local preview…</p>}
    {error && <p className="error-message" role="alert">{error}</p>}
    {candidate && <div className="source-preview"><h3>Review before saving</h3><img src={candidate.previewUrl} alt="Preview of selected source image" /><p className="muted">{candidate.metadata.filename} · {candidate.metadata.width} × {candidate.metadata.height}. Check orientation, labels and contrast before saving.</p><label htmlFor="camera-view">Camera view</label><select id="camera-view" value={cameraView} disabled={processing || saving} onChange={(event) => setCameraView(event.target.value as CameraView)}><option value="UNKNOWN">Unknown</option><option value="FRONT">Front</option><option value="BACK">Back</option><option value="SIDE">Side</option><option value="TOP">Top</option></select><div className="form-actions"><button className="primary-button" type="button" onClick={persist} disabled={saving || processing}>{saving ? 'Saving…' : 'Save original'}</button><button className="secondary-button" type="button" onClick={() => setCandidate(null)} disabled={saving || processing}>Discard preview</button></div></div>}
  </section>;
}
