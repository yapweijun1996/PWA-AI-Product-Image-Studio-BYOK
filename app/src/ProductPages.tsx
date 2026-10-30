import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createProduct, listProducts, type Product } from './products';
import { useUnsavedChanges } from './useUnsavedChanges';

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Local storage is unavailable. Please try again.';
}

export function Workspace() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let mounted = true;
    listProducts().then((value) => { if (mounted) setProducts(value); })
      .catch((reason: unknown) => { if (mounted) setError(message(reason)); });
    return () => { mounted = false; };
  }, []);
  return <>
    <div className="eyebrow">YOUR WORKSPACE</div>
    <div className="page-heading"><div><h1>Product Image Studio</h1><p className="lead">Keep each product's details together, starting with what you know to be true.</p></div><div className="page-actions"><Link className="secondary-button" to="/import">Import backup</Link><Link className="primary-button" to="/products/new">Create product</Link></div></div>
    <section className="product-section" aria-labelledby="projects-heading">
      <div className="section-heading"><div><span className="section-kicker">LOCAL WORKSPACE</span><h2 id="projects-heading">Your products</h2></div><span>Stored in this browser</span></div>
      {error ? <p className="error-message" role="alert">{error}</p> : products === null ? <p className="muted" role="status">Loading products…</p> : products.length === 0 ? <div className="empty-state"><h3>No products yet</h3><p>Create a product to start recording its SKU and confirmed facts.</p><Link className="text-link" to="/products/new">Create your first product <span aria-hidden="true">→</span></Link></div> : <ul className="product-list">{products.map((product) => <li key={product.productId}><Link to={`/products/${product.productId}`}><span className="product-icon" aria-hidden="true">{product.name.slice(0, 1).toUpperCase()}</span><span className="product-summary"><strong>{product.name}</strong><small>{product.sku} · {product.category}</small></span><span aria-hidden="true">→</span></Link></li>)}</ul>}
    </section>
    <p className="workspace-note">Browser data can be cleared or evicted. Keep a private backup of important projects.</p>
  </>;
}

export function NewProduct() {
  const navigate = useNavigate();
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [rights, setRights] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const markSaved = useUnsavedChanges(Boolean(sku || name || category || rights || saving));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const product = await createProduct({ sku, name, category, rightsAcknowledged: rights });
      markSaved();
      navigate(`/products/${product.productId}`, { replace: true });
    } catch (reason) {
      setError(message(reason));
      setSaving(false);
    }
  }

  return <>
    <Link className="back-link" to="/">← All products</Link><div className="eyebrow">NEW PRODUCT</div><h1>Create a product</h1>
    <p className="lead">One product represents one SKU. You can add confirmed details after saving.</p>
    <form className="form-card" onSubmit={submit}>
      <label htmlFor="product-sku">SKU</label><input id="product-sku" value={sku} onChange={(event) => setSku(event.target.value)} required maxLength={160} autoComplete="off" />
      <label htmlFor="product-name">Product name</label><input id="product-name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={300} autoComplete="off" />
      <label htmlFor="product-category">Category</label><input id="product-category" value={category} onChange={(event) => setCategory(event.target.value)} required maxLength={100} autoComplete="off" />
      <label className="checkbox-label"><input type="checkbox" checked={rights} onChange={(event) => setRights(event.target.checked)} required /><span>I have the rights to use the product images and artwork I will add.</span></label>
      {error && <p className="error-message" role="alert">{error}</p>}
      <div className="form-actions"><button className="primary-button" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Create product'}</button><Link className="text-link" to="/">Cancel</Link></div>
    </form>
  </>;
}
