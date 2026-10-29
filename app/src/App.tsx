import { useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes } from 'react-router-dom';
import { useServiceWorker } from './useServiceWorker';
import { NewProduct, ProductDetails, Workspace } from './ProductPages';
import { BackupImport } from './BackupPages';
import { ProviderSessionPanel } from './ProviderSessionPanel';

type Theme = 'system' | 'light' | 'dark';
const themeKey = 'image-studio.theme';

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(themeKey);
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch {
    return 'system';
  }
}

function useAppearance() {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    const preference = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && preference.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', dark ? '#131c1a' : '#f6f7f5');
    };
    apply();
    preference.addEventListener('change', apply);
    try {
      localStorage.setItem(themeKey, theme);
    } catch {
      // Appearance still works for this session when browser storage is unavailable.
    }
    return () => preference.removeEventListener('change', apply);
  }, [theme]);

  return { theme, setTheme };
}

function useNetworkStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

function Mark() {
  return <span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><rect x="4" y="4" width="24" height="24" rx="5" stroke="currentColor" strokeWidth="1.7"/><circle cx="21" cy="11" r="2" fill="currentColor"/><path d="M8 23l7-8 5 5 3-3 3 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg></span>;
}


function Settings({ theme, setTheme }: { theme: Theme; setTheme: (theme: Theme) => void }) {
  return <>
    <div className="eyebrow">PREFERENCES</div>
    <h1>Settings</h1>
    <p className="lead">Adjust the workspace to suit your environment.</p>
    <section className="settings-card" aria-labelledby="appearance-heading">
      <div><span className="section-kicker">DISPLAY</span><h2 id="appearance-heading">Appearance</h2><p>Choose a theme or follow your device setting.</p></div>
      <div className="setting-control"><label htmlFor="theme">Theme</label><select id="theme" value={theme} onChange={(event) => setTheme(event.target.value as Theme)}><option value="system">Use device setting</option><option value="light">Light</option><option value="dark">Dark</option></select></div>
    </section>
    <ProviderSessionPanel />
  </>;
}

function Help() {
  return <>
    <div className="eyebrow">GUIDE</div>
    <h1>Working with care</h1>
    <p className="lead">A few principles for creating product imagery without losing sight of the original.</p>
    <div className="guide-list">
      <section><span className="guide-index">01</span><div><h2>Keep the source</h2><p>Product appearance, readable labels and SKU details matter. A generated image cannot establish product authenticity on its own.</p></div></section>
      <section><span className="guide-index">02</span><div><h2>Know the limits</h2><p>STRICT is intended to preserve the original product foreground while allowing a generated background. It cannot prove an unseen angle or unreadable label.</p></div></section>
      <section><span className="guide-index">03</span><div><h2>Review charges and results</h2><p>Each generation attempt can incur a provider charge. Review the cost and inspect the image before approving it for use.</p></div></section>
    </div>
    <p className="guide-footnote">Mask editing is local. Generation and approved-output export are not available in this build.</p>
  </>;
}

function NotFound() {
  return <><div className="eyebrow">NOT FOUND</div><h1>Page not found</h1><p className="lead">This address does not match a page in the workspace.</p><Link className="text-link" to="/">Return to workspace <span aria-hidden="true">→</span></Link></>;
}

export function App() {
  const { theme, setTheme } = useAppearance();
  const online = useNetworkStatus();
  const update = useServiceWorker();
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside className="sidebar">
      <Link to="/" className="brand"><Mark/><span><strong>IMAGE STUDIO</strong><small>Product workspace</small></span></Link>
      <nav className="navigation" aria-label="Main navigation">
        <NavLink to="/" end>Workspace</NavLink><NavLink to="/settings">Settings</NavLink><NavLink to="/help">Help &amp; guide</NavLink>
      </nav>
      <p className="sidebar-note">Made for a more<br/>considered image.</p>
    </aside>
    <div className="content-shell">
      <header className="topbar"><span>PRODUCT IMAGE STUDIO</span><span className="network" role="status"><span className={online ? 'network-dot' : 'network-dot offline'} aria-hidden="true"/>{online ? 'Browser online' : 'Browser offline'}</span></header>
      {update.state !== 'idle' && <section className="update-notice" aria-label="Application update" aria-live="polite">
        <div>
          <strong>{update.state === 'activating' ? 'Updating application…' : update.state === 'error' ? 'Update unavailable' : update.state === 'activated-elsewhere' ? 'New version active' : 'New version available'}</strong>
          <p>{update.blockedByDraft ? 'Save or discard your changes before reloading.' : update.state === 'activating' ? 'Please keep this page open.' : update.state === 'error' ? 'The update could not be completed. Save your work, check your connection and reload when ready.' : update.state === 'activated-elsewhere' ? 'Save any work, then reload when ready to use the new version.' : 'Save any work before updating. This page will reload only when you choose to update.'}</p>
        </div>
        {update.state === 'activating' && <span className="update-spinner" aria-hidden="true" />}
        {update.state !== 'activating' && (update.state === 'error' || update.state === 'activated-elsewhere'
          ? <button type="button" onClick={update.updateNow}>Reload when ready</button>
          : <button type="button" onClick={update.updateNow}>Update now</button>)}
      </section>}
      <main id="main-content" tabIndex={-1}>
        <Routes><Route path="/" element={<Workspace/>}/><Route path="/import" element={<BackupImport/>}/><Route path="/products/new" element={<NewProduct/>}/><Route path="/products/:productId" element={<ProductDetails/>}/><Route path="/settings" element={<Settings theme={theme} setTheme={setTheme}/>}/><Route path="/help" element={<Help/>}/><Route path="*" element={<NotFound/>}/></Routes>
      </main>
      <footer><span>PRODUCT IMAGE STUDIO</span><span>Local-first by design</span></footer>
    </div>
  </div>;
}
