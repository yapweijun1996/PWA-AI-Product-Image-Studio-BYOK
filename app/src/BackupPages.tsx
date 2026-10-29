import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createBackup, inspectBackup, type BackupPreview } from './backup';
import { restoreProduct } from './products';
import { useUnsavedChanges } from './useUnsavedChanges';

function describe(error: unknown): string {
  return error instanceof Error && error.name === 'AbortError' ? 'Operation cancelled. No local data was changed.' : error instanceof Error ? error.message : 'The backup operation failed.';
}

export function BackupExport({ productId }: { productId: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  useUnsavedChanges(busy);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);

  async function download() {
    if (busy || !window.confirm('This unencrypted backup contains product details, original photos including EXIF metadata, and all mask versions. Download it to a trusted location?')) return;
    const active = new AbortController(); controller.current = active;
    setBusy(true); setError(''); setMessage('Preparing backup…');
    try {
      const blob = await createBackup(productId, active.signal, (value) => { if (mounted.current) setMessage(value); });
      if (active.signal.aborted || !mounted.current) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = `product-backup-${productId}.zip`;
      link.hidden = true; document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setMessage('Backup download started. Keep the file private.');
    } catch (reason) {
      if (mounted.current) { setMessage(''); setError(describe(reason)); }
    } finally {
      controller.current = null;
      if (mounted.current) setBusy(false);
    }
  }

  return <section className="notice" aria-labelledby="backup-heading"><h2 id="backup-heading">Portable backup</h2><p>Backups are unencrypted and include originals, product details and all mask versions. This version refuses to omit unsupported project data.</p><div className="form-actions"><button type="button" className="secondary-button" onClick={download} disabled={busy}>Download backup</button>{busy && <button type="button" className="secondary-button" onClick={() => controller.current?.abort()}>Cancel</button>}</div>{message && <p className="muted" role="status">{message}</p>}{error && <p className="error-message" role="alert">{error}</p>}</section>;
}

export function BackupImport() {
  const navigate = useNavigate();
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [previewFilename, setPreviewFilename] = useState('');
  const [busy, setBusy] = useState<'inspect' | 'import' | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const markSaved = useUnsavedChanges(Boolean(preview || busy));
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file || busy) return;
    const active = new AbortController(); controller.current = active;
    setPreview(null); setPreviewFilename('');
    setBusy('inspect'); setError(''); setMessage('Inspecting backup…');
    try {
      const result = await inspectBackup(file, active.signal, (value) => { if (mounted.current) setMessage(value); });
      if (mounted.current && !active.signal.aborted) { setPreview(result); setPreviewFilename(file.name); setMessage('Backup verified. Review the details before importing.'); }
    } catch (reason) {
      if (mounted.current) { setMessage(''); setError(describe(reason)); }
    } finally {
      controller.current = null;
      if (mounted.current) setBusy(null);
    }
  }

  async function commit() {
    if (!preview || preview.conflict || busy) return;
    setBusy('import'); setError(''); setMessage('Saving the project, originals and masks…');
    try {
      await restoreProduct(preview.product, preview.sources, preview.masks);
      markSaved();
      navigate(`/products/${preview.product.productId}`, { replace: true });
    } catch (reason) {
      setMessage(''); setError(describe(reason)); setBusy(null);
    }
  }

  return <><Link className="back-link" to="/">← All products</Link><div className="eyebrow">PORTABLE BACKUP</div><h1>Import a product</h1><p className="lead">Inspect an unencrypted backup locally before choosing to restore it. Nothing is uploaded.</p>
    <section className="form-card" aria-labelledby="import-heading"><h2 id="import-heading">Choose a backup</h2><label htmlFor="backup-file">ZIP file</label><input id="backup-file" type="file" accept=".zip,application/zip" onChange={choose} disabled={Boolean(busy)} /><p className="muted">Backups can contain confidential product details, photos, EXIF metadata and mask versions. Unsupported versions or project data are rejected, not discarded.</p>{busy === 'inspect' && <button type="button" className="secondary-button" onClick={() => controller.current?.abort()}>Cancel inspection</button>}{message && <p className="muted" role="status">{message}</p>}{error && <p className="error-message" role="alert">{error}</p>}</section>
    {preview && <p className="muted">Currently reviewed file: {previewFilename}</p>}
    {preview && <section className="product-section import-preview" aria-labelledby="preview-heading"><span className="section-kicker">REVIEW BEFORE IMPORT</span><h2 id="preview-heading">{preview.product.name}</h2><dl><div><dt>Products</dt><dd>1</dd></div><div><dt>SKU</dt><dd>{preview.product.sku}</dd></div><div><dt>Category</dt><dd>{preview.product.category}</dd></div><div><dt>Original images</dt><dd>{preview.sources.length}</dd></div><div><dt>Mask versions</dt><dd>{preview.masks.length}</dd></div><div><dt>Uncompressed archive data</dt><dd>{preview.totalBytes.toLocaleString()} bytes ({(preview.totalBytes / (1024 * 1024)).toFixed(2)} MiB)</dd></div></dl><p className="muted">Browser storage use may differ from the archive size.</p>{preview.conflict && <p className="error-message" role="alert">This product, SKU, source ID or mask ID already exists. Nothing will be overwritten.</p>}<div className="form-actions"><button className="primary-button" type="button" disabled={Boolean(busy) || preview.conflict} onClick={commit}>{busy === 'import' ? 'Importing…' : 'Import product'}</button><button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={() => { setPreview(null); setMessage(''); }}>Discard preview</button></div></section>}
  </>;
}
