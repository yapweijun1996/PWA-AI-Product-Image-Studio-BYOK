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
  useUnsavedChanges(Boolean(name || value || confirmed || saving));

  useEffect(() => {
    let mounted = true;
    setProduct(undefined);
    setError('');
    getProduct(productId).then((value) => { if (mounted) setProduct(value); })
      .catch((reason: unknown) => { if (mounted) setError(message(reason)); });
    return () => { mounted = false; };
  }, [productId]);

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

  if (error && product === undefined) return <><Link className="back-link" to="/">← All products</Link><p className="error-message" role="alert">{error}</p></>;
  if (product === undefined) return <p className="muted" role="status">Loading product…</p>;
  if (product === null) return <><Link className="back-link" to="/">← All products</Link><h1>Product not found</h1><p className="lead">No local project matches this address.</p></>;
  return <>
    <Link className="back-link" to="/">← All products</Link><div className="eyebrow">PRODUCT WORKSPACE</div><h1>{product.name}</h1>
    <p className="lead">{product.sku} · {product.category}</p>
    <fieldset className="studio-edit-lock" disabled={studioBusy}>
      <SourcePanel product={product} onChange={setProduct} />
      <MaskEditor product={product} onChange={setProduct} />
    </fieldset>
    <StudioPanel product={product} onBusyChange={setStudioBusy} />
    <fieldset className="studio-edit-lock" disabled={studioBusy}>
    <div className="product-layout">
      <section className="product-section" aria-labelledby="facts-heading"><span className="section-kicker">PRODUCT TRUTH</span><h2 id="facts-heading">Confirmed facts</h2><p className="muted">Only record information you can verify. These entries are user-confirmed, not independently certified.</p>
        {product.facts.length === 0 ? <p className="empty-facts">No facts added yet.</p> : <dl className="facts-list">{product.facts.map((fact) => <div key={fact.factId}><dt>{fact.name}</dt><dd>{fact.value}<span className="fact-meta">{fact.confirmed ? 'Confirmed' : 'Not confirmed'}</span><button className="remove-button" type="button" disabled={saving} onClick={() => deleteFact(fact.factId)} aria-label={`Remove fact ${fact.name}`}>Remove</button></dd></div>)}</dl>}
      </section>
      <form className="form-card" onSubmit={submitFact}><h2>Add a fact</h2><label htmlFor="fact-name">Fact name</label><input id="fact-name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={100} autoComplete="off" /><label htmlFor="fact-value">Fact value</label><textarea id="fact-value" value={value} onChange={(event) => setValue(event.target.value)} required maxLength={1000} rows={3} /><label className="checkbox-label"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} required /><span>I confirm this fact is accurate.</span></label>{error && <p className="error-message" role="alert">{error}</p>}<button className="primary-button" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Add confirmed fact'}</button></form>
    </div>
    </fieldset>
    <ApprovedExportPanel productId={product.productId} productVersion={JSON.stringify(product)} disabled={studioBusy} />
    <BackupExport productId={product.productId} />
  </>;
}
