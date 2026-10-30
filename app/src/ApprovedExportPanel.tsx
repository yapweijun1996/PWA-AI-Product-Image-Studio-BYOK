import { useEffect, useRef, useState } from 'react';
import { commitApprovedExportBatch, listApprovedExportCandidates, loadApprovedExportBatch, type ApprovedExportSelection } from './products';
import { packageApprovedOutputs, renderApprovedOutput } from './approvedExport';
import { LocalImage } from './LocalImage';
import { useUnsavedChanges } from './useUnsavedChanges';

type ExportFormat = 'png' | 'jpeg' | 'webp';
type ExportRatio = '1:1' | '4:5' | '9:16' | '16:9';
type Snapshot = Awaited<ReturnType<typeof loadApprovedExportBatch>>[number];
type Rendered = Awaited<ReturnType<typeof renderApprovedOutput>>;
type Preview = { entry: Snapshot; rendered: Rendered };

export function ApprovedExportPanel({ productId, productVersion, disabled }: { productId: string; productVersion: string; disabled: boolean }) {
  const [candidates, setCandidates] = useState<ApprovedExportSelection[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [format, setFormat] = useState<ExportFormat>('png');
  const [ratio, setRatio] = useState<ExportRatio>('1:1');
  const [previews, setPreviews] = useState<Preview[] | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const [loadedVersion, setLoadedVersion] = useState<string | null>(null);
  const operation = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const hasExportWork = useRef(false);
  const refreshDiscardedWork = useRef(false);
  hasExportWork.current = busy || previews !== null || selected.length > 0;
  const current = loadedVersion === productVersion;
  useUnsavedChanges(busy || previews !== null);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    operation.current?.abort(); operation.current = null;
    const discardedWork = refreshDiscardedWork.current;
    setBusy(false); setCandidates(null); setSelected([]); setPreviews(null); setConfirmed(false); setLoadedVersion(null); setError('');
    setNotice(discardedWork ? 'Approvals are being rechecked because the app was reactivated or the project changed. Select images and prepare previews again.' : '');
    refreshDiscardedWork.current = false;
    void listApprovedExportCandidates(productId, controller.signal).then((items) => {
      if (!controller.signal.aborted && mounted.current) {
        setCandidates(items); setLoadedVersion(productVersion);
        if (discardedWork && items.length === 0) setNotice('Your selection and previews were cleared. No current approved composites are available; review and approve an updated composite before exporting.');
      }
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted && mounted.current) setError(reason instanceof Error ? reason.message : 'Approved images could not be checked.');
    });
    return () => { mounted.current = false; controller.abort(); operation.current?.abort(); operation.current = null; };
  }, [productId, productVersion, revision]);

  useEffect(() => {
    const invalidate = () => { if (hasExportWork.current) refreshDiscardedWork.current = true; operation.current?.abort(); setPreviews(null); setConfirmed(false); setRevision((value) => value + 1); };
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('product-image-studio-changes');
    if (channel) channel.onmessage = (event: MessageEvent) => { if (event.data === productId) invalidate(); };
    window.addEventListener('focus', invalidate);
    return () => { channel?.close(); window.removeEventListener('focus', invalidate); };
  }, [productId]);

  function changeSelection(assetId: string, checked: boolean) {
    setSelected((old) => checked ? [...old, assetId] : old.filter((id) => id !== assetId));
    setPreviews(null); setConfirmed(false); setNotice('');
  }

  async function prepare() {
    if (!current || !candidates || !selected.length || busy || disabled || operation.current) return;
    const chosen = candidates.filter((entry) => selected.includes(entry.assetId));
    if (chosen.length !== selected.length) return;
    const active = new AbortController(); operation.current = active;
    setBusy(true); setError(''); setNotice('Checking approvals and preparing local previews…'); setPreviews(null); setConfirmed(false);
    try {
      const entries = await loadApprovedExportBatch(productId, chosen, active.signal);
      const results: Preview[] = [];
      for (const entry of entries) results.push({ entry, rendered: await renderApprovedOutput(entry.blob, format, ratio, active.signal) });
      if (!active.signal.aborted && mounted.current) { setPreviews(results); setNotice('Inspect every converted preview before downloading.'); }
    } catch (reason) {
      if (!active.signal.aborted && mounted.current) { setNotice(''); setError(reason instanceof Error ? reason.message : 'The export preview could not be prepared.'); }
    } finally {
      if (operation.current === active) { operation.current = null; if (mounted.current) { setBusy(false); if (active.signal.aborted) setNotice('Export cancelled. No bundle was downloaded.'); } }
    }
  }

  async function download() {
    if (!current || !previews?.length || !confirmed || busy || disabled || operation.current) return;
    const active = new AbortController(); operation.current = active;
    setBusy(true); setError(''); setNotice('Preparing the output bundle and rechecking approvals…');
    let started = false;
    let url = '';
    try {
      const entries = previews.map(({ entry, rendered }) => ({ selection: entry.selection, provenance: entry.provenance, rendered, ...(entry.ad ? { ad: entry.ad } : {}), ...(entry.copyLayer ? { copyLayer: entry.copyLayer } : {}) }));
      const archive = await packageApprovedOutputs(productId, entries, active.signal);
      if (active.signal.aborted || !mounted.current) return;
      url = URL.createObjectURL(archive);
      await commitApprovedExportBatch(productId, previews.map(({ entry }) => entry.selection), active.signal, (refreshed) => {
        if (refreshed.length !== previews.length || refreshed.some((entry, index) =>
          JSON.stringify(entry.selection) !== JSON.stringify(previews[index].entry.selection) ||
          JSON.stringify(entry.provenance) !== JSON.stringify(previews[index].entry.provenance))) {
          throw new Error('Approval or provenance changed while preparing the bundle. Review the current images again.');
        }
        if (active.signal.aborted || !mounted.current) throw new DOMException('Export was cancelled.', 'AbortError');
        const link = document.createElement('a');
        link.href = url; link.download = `approved-outputs-${productId}.zip`; link.hidden = true;
        document.body.append(link);
        try { link.click(); started = true; } finally { link.remove(); }
      });
      if (mounted.current) { setConfirmed(false); setPreviews(null); setNotice('Output bundle download started. This is not a complete project backup.'); }
    } catch (reason) {
      if (mounted.current && started) { setConfirmed(false); setPreviews(null); setError('The download may already have started, but its final local check did not complete.'); setNotice(''); }
      else if (!active.signal.aborted && mounted.current) { setConfirmed(false); setPreviews(null); setNotice(''); setError(reason instanceof Error ? reason.message : 'The output bundle could not be created.'); }
    } finally {
      if (url) { if (started) window.setTimeout(() => URL.revokeObjectURL(url), 60_000); else URL.revokeObjectURL(url); }
      if (operation.current === active) { operation.current = null; if (mounted.current) { setBusy(false); if (active.signal.aborted && !started) { setConfirmed(false); setPreviews(null); setNotice('Export cancelled. No bundle was downloaded.'); } } }
    }
  }

  return <section className="product-section approved-export" aria-labelledby="approved-export-heading">
    <span className="section-kicker">LOCAL DELIVERY</span><h2 id="approved-export-heading">Export reviewed images</h2>
    <p><strong>Approval and export require protected mask areas.</strong> Human selection can miss hidden or changed labels, and conversion can alter details. Compare each output against the original; do not use it if a required detail is missing or unclear.</p>
    <p>Only current human-approved composites are eligible. Converted files are separate from your originals; inspect every output before download. New-style ZIPs include the exact prompt, selected confirmed facts and seller ad copy, as well as any complete billboard ad and frozen copy layer. This bundle is unencrypted and is not a project backup.</p>
    <p>All ratios fit the entire image without cropping. PNG and WebP use transparent margins; JPEG uses a white background. Conversion may resample labels and colors and does not guarantee a marketplace's requirements.</p>
    {error && <p className="error-message" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!current || candidates === null ? <p role="status">{error ? 'Approval status unavailable.' : 'Checking local approvals…'}</p> : candidates.length === 0 ? <p>No current approved composites are available.</p> : <>
      <fieldset disabled={busy || disabled}><legend>Select approved composites</legend>{candidates.map((item) => <label className="checkbox-label" key={item.assetId}><input type="checkbox" checked={selected.includes(item.assetId)} onChange={(event) => changeSelection(item.assetId, event.target.checked)} /><span>Image {item.assetId} · attempt {item.attemptId}</span></label>)}</fieldset>
      <div className="approved-export-options"><label>Format<select value={format} disabled={busy || disabled} onChange={(event) => { setFormat(event.target.value as ExportFormat); setPreviews(null); setConfirmed(false); }}><option value="png">PNG</option><option value="jpeg">JPEG — white background</option><option value="webp">WebP</option></select></label><label>Aspect ratio<select value={ratio} disabled={busy || disabled} onChange={(event) => { setRatio(event.target.value as ExportRatio); setPreviews(null); setConfirmed(false); }}><option value="1:1">1:1 — 1024 × 1024</option><option value="4:5">4:5 — 1024 × 1280</option><option value="9:16">9:16 — 900 × 1600</option><option value="16:9">16:9 — 1600 × 900</option></select></label></div>
      <button type="button" className="secondary-button" disabled={busy || disabled || !selected.length} onClick={() => void prepare()}>Prepare converted previews</button>
      {previews && <div><h3>Inspect converted outputs</h3><p>Compare the approved composite with the actual converted file, including labels and margins. Scroll the image areas at native pixel size.</p>{previews.map(({ entry, rendered }) => <div key={entry.selection.assetId}><p>Image {entry.selection.assetId} · style {entry.provenance.styleId} · output SHA-256 {rendered.sha256}</p><p>Output {rendered.conversion.outputWidth} × {rendered.conversion.outputHeight}; margins left/right {rendered.conversion.x}, top/bottom {rendered.conversion.y} pixels.</p><div className="strict-comparison"><figure><div className="strict-zoom" tabIndex={0} role="region" aria-label="Approved composite native pixels"><LocalImage blob={entry.blob} alt="Approved original composite" nativeWidth={1024} /></div><figcaption>Approved composite</figcaption></figure><figure><div className="strict-zoom" tabIndex={0} role="region" aria-label="Converted output native pixels"><LocalImage blob={rendered.blob} alt="Converted output for inspection" nativeWidth={rendered.conversion.outputWidth} /></div><figcaption>{ratio} {format.toUpperCase()} output</figcaption></figure></div></div>)}<label className="checkbox-label"><input type="checkbox" checked={confirmed} disabled={busy || disabled} onChange={(event) => setConfirmed(event.target.checked)} /><span>I inspected every converted output, including readable labels and margins, and want to download this bundle.</span></label><button type="button" className="primary-button" disabled={busy || disabled || !confirmed} onClick={() => void download()}>Download approved output bundle</button></div>}
    </>}
    {busy && <button type="button" className="secondary-button" onClick={() => operation.current?.abort()}>Cancel</button>}
    {error && <button type="button" className="secondary-button" disabled={busy} onClick={() => setRevision((value) => value + 1)}>Recheck approvals</button>}
  </section>;
}
