import {ErrorNotice} from './ui/components';
import {workspacePath} from './ui/routes';
import { Button, Input, Textarea } from './ui/components';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { addConfirmedFact, getProduct, removeFact, type Product } from './products';
import { SourcePanel } from './SourcePanel';
import { BackupExport } from './BackupPages';
import { useUnsavedChanges } from './useUnsavedChanges';
import { MaskEditor } from './MaskEditor';
import { StudioPanel } from './StudioPanel';
import { ApprovedExportPanel } from './ApprovedExportPanel';

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Local storage is unavailable. Please try again.';
}

export function ProductDetails() {
  const { productId = '' } = useParams();
  const [product, setProduct] = useState<Product | null | undefined>(undefined);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [studioBusy, setStudioBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadVersion, setLoadVersion] = useState(0);
  useUnsavedChanges(Boolean(name || value || confirmed || saving));

  useEffect(() => {
    let mounted = true;
    setProduct(undefined);
    setError('');
    getProduct(productId).then((value) => { if (mounted) setProduct(value); })
      .catch((reason: unknown) => { if (mounted) setError(message(reason)); });
    return () => { mounted = false; };
  }, [productId, loadVersion]);

  async function submitFact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !confirmed) return;
    setSaving(true);
    setError('');
    try {
      const saved = await addConfirmedFact(productId, name, value);
      setProduct(saved);
      setName(''); setValue(''); setConfirmed(false);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setSaving(false);
    }
  }

  async function deleteFact(factId: string) {
    if (saving || !window.confirm('Remove this confirmed fact from the product?')) return;
    setSaving(true);
    setError('');
    try { setProduct(await removeFact(productId, factId)); }
    catch (reason) { setError(message(reason)); }
    finally { setSaving(false); }
  }

  if (error && product === undefined) return <><Link className="back-link" to={workspacePath}>← All products</Link><ErrorNotice title="Needs attention">{error}</ErrorNotice><Button className="secondary-button" type="button" onClick={() => { setError(''); setLoadVersion((value) => value + 1); }}>Retry loading product</Button></>;
  if (product === undefined) return <p className="muted" role="status">Loading product…</p>;
  if (product === null) return <><Link className="back-link" to={workspacePath}>← All products</Link><h1>Product not found</h1><p className="lead">No local project matches this address.</p></>;
  return <>
    <Link className="back-link" to={workspacePath}>← All products</Link><div className="eyebrow">PRODUCT WORKSPACE</div><h1>{product.name}</h1>
    <p className="lead">{product.sku} · {product.category}</p>
    <nav className="section-nav" aria-label="Product sections" onClick={event=>{const link=(event.target as Element).closest("a");if(link){event.preventDefault();const target=document.querySelector<HTMLElement>(link.getAttribute("href")!);target?.scrollIntoView({behavior:"instant",block:"start"});target?.setAttribute("tabindex","-1");target?.focus({preventScroll:true});}}}><a href="#source-stage">Original</a><a href="#mask-stage">Selection</a><a href="#scene-stage">Scenes</a><a href="#facts-stage">Facts</a><a href="#export-stage">Export</a><a href="#backup-stage">Backup</a></nav>
    <fieldset className="studio-edit-lock" disabled={studioBusy}>
      <div id="source-stage"><SourcePanel product={product} onChange={setProduct} /></div>
      <div id="mask-stage"><MaskEditor product={product} onChange={setProduct} /></div>
    </fieldset>
    <div id="scene-stage"><StudioPanel product={product} onBusyChange={setStudioBusy} /></div>
    <fieldset className="studio-edit-lock" disabled={studioBusy}>
    <div className="product-layout" id="facts-stage">
      <section className="product-section" aria-labelledby="facts-heading"><span className="section-kicker">PRODUCT TRUTH</span><h2 id="facts-heading">Confirmed facts</h2><p className="muted">Only record information you can verify. These entries are user-confirmed, not independently certified.</p>
        {product.facts.length === 0 ? <p className="empty-facts">No facts added yet.</p> : <dl className="facts-list">{product.facts.map((fact) => <div key={fact.factId}><dt>{fact.name}</dt><dd>{fact.value}<span className="fact-meta">{fact.confirmed ? 'Confirmed' : 'Not confirmed'}</span><Button className="remove-button" type="button" disabled={saving} onClick={() => deleteFact(fact.factId)} aria-label={`Remove fact ${fact.name}`}>Remove</Button></dd></div>)}</dl>}
      </section>
      <form className="form-card" onSubmit={submitFact}><h2>Add a fact</h2><label htmlFor="fact-name">Fact name</label><Input id="fact-name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={100} autoComplete="off" /><label htmlFor="fact-value">Fact value</label><Textarea id="fact-value" value={value} onChange={(event) => setValue(event.target.value)} required maxLength={1000} rows={3} /><label className="checkbox-label"><Input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} required /><span>I confirm this fact is accurate.</span></label>{error && <ErrorNotice title="Needs attention">{error}</ErrorNotice>}<Button className="primary-button" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Add confirmed fact'}</Button></form>
    </div>
    </fieldset>
    <div id="export-stage"><ApprovedExportPanel productId={product.productId} productVersion={JSON.stringify(product)} disabled={studioBusy} /></div>
    <div id="backup-stage"><BackupExport productId={product.productId} /></div>
  </>;
}
