import {Disclosure, DisclosureSummary} from './ui/components';
import {Icon} from './ui/Icon';
import { t, useLanguage, translateLabels } from './ui/i18n';
import { TopbarControls } from './ui/TopbarControls';
import { Button, Select, PageHeader, LoadingState } from './ui/components';
import { GuideStep, ComponentGallery } from './ui/components';
import { useScrollChrome } from './ui/useScrollChrome';
import { Component, lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link, matchPath, NavLink, Route, Routes, useLocation, useNavigationType } from 'react-router-dom';
import { useServiceWorker } from './useServiceWorker';
import { NewProduct, Workspace } from './ProductPages';
import { ProviderSessionPanel } from './ProviderSessionPanel';

const ImageLibrary = lazy(() => import('./ImageLibrary').then(module => ({default:module.ImageLibrary})));
const UploadStudio = lazy(() => import('./UploadStudio').then(module => ({default:module.UploadStudio})));
const ProductDetails = lazy(() => import('./ProductDetails').then((module) => ({ default: module.ProductDetails })));
const BackupImport = lazy(() => import('./BackupPages').then((module) => ({ default: module.BackupImport })));

class RouteErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <section role="alert"><h1>Page unavailable</h1><p>The page could not be loaded. Check your connection and reload when ready. Unsaved changes may be lost.</p><Button type="button" className="secondary-button" onClick={() => window.location.reload()}>Reload page</Button><p><Link className="text-link" to="/">Return to workspace</Link></p></section>;
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
  const [dark,setDark] = useState(false);

  useEffect(() => {
    const preference = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && preference.matches);
      setDark(dark);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', getComputedStyle(document.documentElement).getPropertyValue('--page').trim());
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

  return { theme, setTheme, dark };
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

function Mark() { return <span className="brand-mark"><Icon name="image"/></span>; }



function Settings({ theme, setTheme }: { theme: Theme; setTheme: (theme: Theme) => void }) {
  return <>
    <PageHeader eyebrow={t("PREFERENCES")} title={t("Settings")}>{t("Adjust the workspace to suit your environment.")}</PageHeader>
    <div className="settings-layout">
    {import.meta.env.MODE === 'pages' && <div className="provider-settings"><ProviderSessionPanel /></div>}
    <section className="settings-card" aria-labelledby="appearance-heading">
      <div><span className="section-kicker">DISPLAY</span><h2 id="appearance-heading">{t("Appearance")}</h2><p>{t("Choose a theme or follow your device setting.")}</p></div>
      <div className="setting-control"><label htmlFor="theme">{t("Theme")}</label><Select id="theme" value={theme} onChange={(event) => setTheme(event.target.value as Theme)}><option value="system">{t("Use device setting")}</option><option value="light">{t("Light")}</option><option value="dark">{t("Dark")}</option></Select></div>
    </section>
    {import.meta.env.MODE !== 'pages' && <div className="provider-settings"><ProviderSessionPanel /></div>}
    </div>
  </>;
}

function Help() {
  if(import.meta.env.MODE === 'pages') return <><div className="eyebrow">{t("GUIDE")}</div><h1>{t("Upload. Get your images.")}</h1><p className="lead">{t("One product photo becomes seven complete looks.")}</p><div className="guide-list"><GuideStep number="01" title={t("Set up this tab")}><p>Add your OpenAI key and authorize a session estimate limit. Your key is saved in this browser until you remove it. Spending authorization is renewed for each tab session.</p><Link className="text-link" to="/settings">{t("Session settings")}</Link></GuideStep><GuideStep number="02" title={t("Upload a product photo")}><p>Upload starts automatic selection, scene generation and product composition. No product forms, masks, scores or approval steps. First-use selection tools may take longer to download; no image request is sent until product preparation succeeds.</p></GuideStep><GuideStep number="03" title={t("Download your images")}><p>Results appear as they finish. Download one image or all finished images as a ZIP. Partial failures keep successful results and do not cause automatic paid retries. Automated selection and resizing may affect fine details; outputs are not human-reviewed.</p><Link className="primary-button" to="/">{t("Upload image")}</Link></GuideStep></div><Disclosure><DisclosureSummary>Previous projects, installation and recovery</DisclosureSummary><p>Install this app from your browser menu, or use Share → Add to Home Screen on iPhone. After an online visit has cached the app, saved images can be viewed and downloaded offline. Generation requires a connection. Installed and browser copies may keep separate local data.</p><p>Saved uploads and originals stay in this browser. Use the homepage’s previous uploads section to reopen them. A disconnected or ambiguous paid request pauses new uploads; check billing and use the exceptional recovery consent in Settings to authorize new requests. The original outcome remains unknown.</p><Link to="/workspace">Advanced workspace and existing projects</Link></Disclosure></>;
  return <>
    <div className="eyebrow">{t("GUIDE")}</div>
    <h1>Get started</h1>
    <p className="lead">Create and review a product image in your local workspace.</p>
    <section className="notice" aria-labelledby="availability-heading"><h2 id="availability-heading">Current availability</h2><p>{import.meta.env.MODE === 'pages' ? 'This Pages build supports direct OpenAI generation with your own key. Add it in Settings for this tab; requests can incur charges. Local editing works offline, while generation needs a connection. The Pi agent is not part of this browser path.' : 'This is a local development build. The Pi agent and remote mobile gateway are not available yet. The current gateway works only on the same device at its 127.0.0.1 address; use synthetic credentials until the required security review is complete.'}</p></section>
    <section className="notice" aria-labelledby="install-heading"><h2 id="install-heading">Install on a device</h2><p>Where an accessible HTTPS copy is available, iPhone Safari can add the site to the Home Screen from Share; choose “Open as Web App” if offered. Android Chrome may offer Install from its menu. Browser options vary. Installing does not connect a phone to a gateway on another device.</p><p>The app shell can work offline only after it has been successfully cached during an online visit. Projects are stored locally and may not be shared between browsers or installed copies; keep a separate private backup.</p><div className="install-links"><a className="text-link" href="https://support.apple.com/guide/iphone/iphea86e5236/ios" target="_blank" rel="noreferrer">iPhone instructions</a> <a className="text-link" href="https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DAndroid&amp;hl=en" target="_blank" rel="noreferrer">Android instructions</a></div></section>
    <div className="guide-list">
      <GuideStep number="01" title="Create a product"><p>In the workspace, create one project per SKU and confirm that you have rights to use its images and artwork. Add only facts you can verify.</p><Link className="text-link" to="/products/new">Create a product <span aria-hidden="true">→</span></Link></GuideStep>
      <GuideStep number="02" title="Add the original and mask"><p>Upload an original image, choose its view and save it. Edit the mask to keep the product, then mark every visible label and required detail as a protected area. Review and save the mask; the original remains unchanged.</p></GuideStep>
      <section><span className="guide-index">03</span><div><h2>{import.meta.env.MODE === 'pages' ? 'Add your OpenAI key' : 'Connect the local gateway'}</h2><p>{import.meta.env.MODE === 'pages' ? 'Use Settings to enter a dedicated OpenAI key. It is saved on this device until removed. Reload restores the key but requires new session spending consent. Extensions or malicious scripts can read it; configure spending limits with OpenAI. No server or gateway setup is needed.' : "On the device running the development gateway, use Settings to sign in with the separate local app access token and connect the provider session. Never enter an OpenAI API key in the browser. A phone cannot reach a computer's gateway using the phone's own loopback address."}</p><Link className="text-link" to="/settings">Open provider settings <span aria-hidden="true">→</span></Link></div></section>
      <GuideStep number="04" title="Authorize scene attempts"><p>Choose styles and inspect each prompt and estimate. Each authorized attempt can incur a charge; the product name, category and selected confirmed facts are sent to the provider, while the original and mask stay local. A timeout may still be charged, so review the attempt before a separately authorized retry.</p></GuideStep>
      <GuideStep number="05" title="Compose and review"><p>Compose the saved product selection over a generated scene. Compare it with the original, record findings and make a separate approval decision. Protected areas do not prove every label was selected or remains readable; do not approve a mismatched or unclear product.</p></GuideStep>
      <GuideStep number="06" title="Export and back up"><p>Inspect each converted output before downloading an approved-output bundle. For the complete project, use its full backup separately. Backups and output bundles are unencrypted and can contain sensitive images and text; browser data can be cleared or evicted.</p><Link className="text-link" to="/">Open workspace <span aria-hidden="true">→</span></Link></GuideStep>
    </div>
  </>;
}

function NotFound() {
  return <><div className="eyebrow">NOT FOUND</div><h1>Page not found</h1><p className="lead">This address does not match a page in the workspace.</p><Link className="text-link" to="/">Return to workspace <span aria-hidden="true">→</span></Link></>;
}

function pageTitle(pathname: string): string {
  const pages: Array<[string, string]> = [['/', import.meta.env.MODE === 'pages' ? t("Create") : 'Workspace'], ['/images', t("My images")], ['/design-system', 'Design system'], ['/workspace', t("Advanced workspace")], ['/settings', t("Settings")], ['/help', t("Help & guide")], ['/import', 'Import backup'], ['/products/new', 'Create a product'], ['/products/:productId', 'Product workspace']];
  return pages.find(([pattern]) => matchPath(pattern, pathname))?.[1] ?? 'Page not found';
}

export function App() {
  const language=useLanguage();
  useEffect(()=>{if(import.meta.env.MODE==='pages')void import('./browserByok').then(module=>module.restoreSavedBrowserKey()).catch(()=>{});},[]);
  useEffect(translateLabels,[language]);
  const { theme, setTheme, dark } = useAppearance();
  const location = useLocation();
  const navigationType = useNavigationType();
  const previousPath = useRef(location.pathname);
  const mainContent = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    document.title = `${pageTitle(location.pathname)} | Product Image Studio`;
    const changedPage = previousPath.current !== location.pathname;
    previousPath.current = location.pathname;
    if (changedPage && navigationType !== 'POP' && !location.hash) {
      window.scrollTo(0, 0);
      mainContent.current?.focus({ preventScroll: true });
    }
  }, [location.pathname, location.hash, navigationType, language]);
  const online = useNetworkStatus();
  const update = useServiceWorker();
  const chrome = useScrollChrome();
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside className="sidebar">
      <Link to="/" className="brand"><Mark/><span><strong>IMAGE STUDIO</strong><small>Product workspace</small></span></Link>
      <nav className="navigation" aria-label="Main navigation">
        <NavLink to="/" end><Icon name="create"/>{import.meta.env.MODE === 'pages' ? t("Create") : 'Workspace'}</NavLink>{import.meta.env.MODE === 'pages' && <NavLink to="/images"><Icon name="library"/>{t("My images")}</NavLink>}<NavLink to="/settings"><Icon name="settings"/>{t("Settings")}</NavLink><NavLink to="/help"><Icon name="help"/>{t("Help & guide")}</NavLink>
      </nav>
      <div className="sidebar-update"><span className="app-version">v{__APP_VERSION__} · {__APP_REVISION__}</span><Button className="secondary-button" type="button" pending={update.state==='activating'} disabled={update.checkingUpdate} aria-busy={update.checkingUpdate || update.state==='activating'} onClick={()=>update.state==='waiting'||update.state==='activated-elsewhere'?update.updateNow():void update.checkNow()}>{t(update.state==='activating'?'Updating application…':update.state==='waiting'?'Update now':update.state==='activated-elsewhere'?'Reload when ready':'Check for updates')}</Button><span role="status">{t(update.checkMessage)}</span></div>
    </aside>
    <div className="content-shell">
      <header className={`topbar ${chrome.hidden ? "topbar-hidden" : ""}`}><span>PRODUCT IMAGE STUDIO</span><span className="network" role="status"><span className={online ? 'network-dot' : 'network-dot offline'} aria-hidden="true"/>{online ? t("Browser online") : t("Browser offline")}</span><TopbarControls dark={dark} toggleTheme={()=>setTheme(dark?'light':'dark')}/></header>
      {update.state !== 'idle' && <section className="update-notice" aria-label="Application update" aria-live="polite">
        <div>
          <strong>{update.state === 'activating' ? t("Updating application…") : update.state === 'cache-limit' ? 'Update paused: old app caches' : update.state === 'error' ? 'Update unavailable' : update.state === 'activated-elsewhere' ? 'New version active' : t("New version available")}</strong>
          <p>{update.blockedByDraft ? 'Save or discard your changes before continuing.' : update.state === 'cache-limit' ? 'Save your work and close every other app tab before clearing old application caches. Product data is not deleted. Older or still-loading tabs may stop working after cleanup.' : update.state === 'activating' ? 'Please keep this page open.' : update.state === 'error' ? 'The update could not be completed. Save your work, check your connection and reload when ready.' : update.state === 'activated-elsewhere' ? 'Save any work, then reload when ready to use the new version.' : 'Save any work before updating. This page will reload only when you choose to update.'}</p>
          {update.cacheMessage && <p role="status">{update.cacheMessage}</p>}
        </div>
        {update.state === 'activating' && <span className="update-spinner" aria-hidden="true" />}
        {update.state === 'cache-limit' ? <div className="strict-actions"><Button type="button" disabled={update.clearingCaches || !update.cacheCleanupAvailable} onClick={() => void update.clearOldCaches()}>{update.clearingCaches ? 'Clearing old caches…' : 'Clear old app caches'}</Button><Button type="button" disabled={update.clearingCaches} onClick={update.updateNow}>{t("Reload when ready")}</Button></div> :
          update.state !== 'activating' && (update.state === 'error' || update.state === 'activated-elsewhere'
            ? <Button type="button" onClick={update.updateNow}>{t("Reload when ready")}</Button>
            : <Button type="button" onClick={update.updateNow}>{t("Update now")}</Button>)}
      </section>}
      <main id="main-content" tabIndex={-1} ref={mainContent}>
        <RouteErrorBoundary key={location.pathname}><Suspense fallback={<LoadingState>Loading page…</LoadingState>}><Routes><Route path="/" element={import.meta.env.MODE === 'pages' ? <UploadStudio/> : <Workspace/>}/><Route path="/images" element={<ImageLibrary/>}/><Route path="/design-system" element={<ComponentGallery/>}/><Route path="/workspace" element={<Workspace/>}/><Route path="/import" element={<BackupImport/>}/><Route path="/products/new" element={<NewProduct/>}/><Route path="/products/:productId" element={<ProductDetails/>}/><Route path="/settings" element={<Settings theme={theme} setTheme={setTheme}/>}/><Route path="/help" element={<Help/>}/><Route path="*" element={<NotFound/>}/></Routes></Suspense></RouteErrorBoundary>
      </main>
      <footer><span>PRODUCT IMAGE STUDIO</span><Link to="/workspace">{t("Advanced workspace")}</Link><span>{t("Local-first by design")}</span></footer>
      {chrome.showTop && <Button variant="secondary" className="scroll-top" onClick={()=>window.scrollTo({top:0,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'})}>{t("Back to top ↑")}</Button>}
    </div>
  </div>;
}
