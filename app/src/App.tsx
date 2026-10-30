import { Component, lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useNavigationType } from 'react-router-dom';
import { useServiceWorker } from './useServiceWorker';
import { NewProduct, Workspace } from './ProductPages';
import { ProviderSessionPanel } from './ProviderSessionPanel';

const ProductDetails = lazy(() => import('./ProductDetails').then((module) => ({ default: module.ProductDetails })));
const BackupImport = lazy(() => import('./BackupPages').then((module) => ({ default: module.BackupImport })));

class RouteErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <section role="alert"><h1>Page unavailable</h1><p>The page could not be loaded. Check your connection and reload when ready. Unsaved changes may be lost.</p><button type="button" className="secondary-button" onClick={() => window.location.reload()}>Reload page</button><p><Link className="text-link" to="/">Return to workspace</Link></p></section>;
    return this.props.children;
  }
}

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
    <h1>Get started</h1>
    <p className="lead">Create and review a product image in your local workspace.</p>
    <section className="notice" aria-labelledby="availability-heading"><h2 id="availability-heading">Current availability</h2><p>This is a local development build. The Pi agent and remote mobile gateway are not available yet. The current gateway works only on the same device at its 127.0.0.1 address; use synthetic credentials until the required security review is complete.</p></section>
    <section className="notice" aria-labelledby="install-heading"><h2 id="install-heading">Install on a device</h2><p>Where an accessible HTTPS copy is available, iPhone Safari can add the site to the Home Screen from Share; choose “Open as Web App” if offered. Android Chrome may offer Install from its menu. Browser options vary. Installing does not connect a phone to a gateway on another device.</p><p>The app shell can work offline only after it has been successfully cached during an online visit. Projects are stored locally and may not be shared between browsers or installed copies; keep a separate private backup.</p><div className="install-links"><a className="text-link" href="https://support.apple.com/guide/iphone/iphea86e5236/ios" target="_blank" rel="noreferrer">iPhone instructions</a> <a className="text-link" href="https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DAndroid&amp;hl=en" target="_blank" rel="noreferrer">Android instructions</a></div></section>
    <div className="guide-list">
      <section><span className="guide-index">01</span><div><h2>Create a product</h2><p>In the workspace, create one project per SKU and confirm that you have rights to use its images and artwork. Add only facts you can verify.</p><Link className="text-link" to="/products/new">Create a product <span aria-hidden="true">→</span></Link></div></section>
      <section><span className="guide-index">02</span><div><h2>Add the original and mask</h2><p>Upload an original image, choose its view and save it. Edit the mask to keep the product, then mark every visible label and required detail as a protected area. Review and save the mask; the original remains unchanged.</p></div></section>
      <section><span className="guide-index">03</span><div><h2>Connect the local gateway</h2><p>On the device running the development gateway, use Settings to sign in with the separate local app access token and connect the provider session. Never enter an OpenAI API key in the browser. A phone cannot reach a computer's gateway using the phone's own loopback address.</p><Link className="text-link" to="/settings">Open provider settings <span aria-hidden="true">→</span></Link></div></section>
      <section><span className="guide-index">04</span><div><h2>Authorize scene attempts</h2><p>Choose styles and inspect each prompt and estimate. Each authorized attempt can incur a charge; the product name, category and selected confirmed facts are sent to the provider, while the original and mask stay local. A timeout may still be charged, so review the attempt before a separately authorized retry.</p></div></section>
      <section><span className="guide-index">05</span><div><h2>Compose and review</h2><p>Compose the saved product selection over a generated scene. Compare it with the original, record findings and make a separate approval decision. Protected areas do not prove every label was selected or remains readable; do not approve a mismatched or unclear product.</p></div></section>
      <section><span className="guide-index">06</span><div><h2>Export and back up</h2><p>Inspect each converted output before downloading an approved-output bundle. For the complete project, use its full backup separately. Backups and output bundles are unencrypted and can contain sensitive images and text; browser data can be cleared or evicted.</p><Link className="text-link" to="/">Open workspace <span aria-hidden="true">→</span></Link></div></section>
    </div>
  </>;
}

function NotFound() {
  return <><div className="eyebrow">NOT FOUND</div><h1>Page not found</h1><p className="lead">This address does not match a page in the workspace.</p><Link className="text-link" to="/">Return to workspace <span aria-hidden="true">→</span></Link></>;
}

export function App() {
  const { theme, setTheme } = useAppearance();
  const location = useLocation();
  const navigationType = useNavigationType();
  const previousPath = useRef(location.pathname);
  useLayoutEffect(() => {
    const changedPage = previousPath.current !== location.pathname;
    previousPath.current = location.pathname;
    if (changedPage && navigationType !== 'POP' && !location.hash) window.scrollTo(0, 0);
  }, [location.pathname, location.hash, navigationType]);
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
          <strong>{update.state === 'activating' ? 'Updating application…' : update.state === 'cache-limit' ? 'Update paused: old app caches' : update.state === 'error' ? 'Update unavailable' : update.state === 'activated-elsewhere' ? 'New version active' : 'New version available'}</strong>
          <p>{update.blockedByDraft ? 'Save or discard your changes before continuing.' : update.state === 'cache-limit' ? 'Save your work and close every other app tab before clearing old application caches. Product data is not deleted. Older or still-loading tabs may stop working after cleanup.' : update.state === 'activating' ? 'Please keep this page open.' : update.state === 'error' ? 'The update could not be completed. Save your work, check your connection and reload when ready.' : update.state === 'activated-elsewhere' ? 'Save any work, then reload when ready to use the new version.' : 'Save any work before updating. This page will reload only when you choose to update.'}</p>
          {update.cacheMessage && <p role="status">{update.cacheMessage}</p>}
        </div>
        {update.state === 'activating' && <span className="update-spinner" aria-hidden="true" />}
        {update.state === 'cache-limit' ? <div className="strict-actions"><button type="button" disabled={update.clearingCaches || !update.cacheCleanupAvailable} onClick={() => void update.clearOldCaches()}>{update.clearingCaches ? 'Clearing old caches…' : 'Clear old app caches'}</button><button type="button" disabled={update.clearingCaches} onClick={update.updateNow}>Reload when ready</button></div> :
          update.state !== 'activating' && (update.state === 'error' || update.state === 'activated-elsewhere'
            ? <button type="button" onClick={update.updateNow}>Reload when ready</button>
            : <button type="button" onClick={update.updateNow}>Update now</button>)}
      </section>}
      <main id="main-content" tabIndex={-1}>
        <RouteErrorBoundary key={location.pathname}><Suspense fallback={<p role="status">Loading page…</p>}><Routes><Route path="/" element={<Workspace/>}/><Route path="/import" element={<BackupImport/>}/><Route path="/products/new" element={<NewProduct/>}/><Route path="/products/:productId" element={<ProductDetails/>}/><Route path="/settings" element={<Settings theme={theme} setTheme={setTheme}/>}/><Route path="/help" element={<Help/>}/><Route path="*" element={<NotFound/>}/></Routes></Suspense></RouteErrorBoundary>
      </main>
      <footer><span>PRODUCT IMAGE STUDIO</span><span>Local-first by design</span></footer>
    </div>
  </div>;
}
