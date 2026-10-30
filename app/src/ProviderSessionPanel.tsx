import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type FormEvent } from 'react';
import { useUnsavedChanges } from './useUnsavedChanges';

type Status = { connected: boolean; configured: boolean; provider: 'openai'; expiresAt: string | null; stale: boolean };
type State = { kind: 'checking' | 'unavailable' | 'signed-out' } | { kind: 'signed-in'; csrf: string; status: Status };
type Busy = 'checking' | 'login' | 'connect' | 'disconnect' | 'logout';
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

class RequestFailure extends Error {
  constructor(readonly status: number) { super('Gateway request failed.'); }
}

async function request(path: string, signal: AbortSignal, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`/api/v2${path}`, { ...init, signal, cache: 'no-store', credentials: 'same-origin', redirect: 'error' });
  if (!response.ok) throw new RequestFailure(response.status);
  if (response.status === 204) return null;
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new Error('Invalid gateway response.');
  return response.json() as Promise<unknown>;
}

function session(value: unknown): { csrfToken: string } {
  if (!value || typeof value !== 'object') throw new Error('Invalid session response.');
  const record = value as Record<string, unknown>;
  if (record.authenticated !== true || typeof record.csrfToken !== 'string' || !tokenPattern.test(record.csrfToken)) throw new Error('Invalid session response.');
  return { csrfToken: record.csrfToken };
}

function provider(value: unknown): Status {
  if (!value || typeof value !== 'object') throw new Error('Invalid provider response.');
  const record = value as Record<string, unknown>;
  if (record.provider !== 'openai' || typeof record.connected !== 'boolean' || typeof record.configured !== 'boolean' ||
      (record.expiresAt !== null && (typeof record.expiresAt !== 'string' || !Number.isFinite(Date.parse(record.expiresAt)))) ||
      (record.connected && (!record.configured || record.expiresAt === null)) || (!record.connected && record.expiresAt !== null)) {
    throw new Error('Invalid provider response.');
  }
  const expiresAt = record.expiresAt as string | null;
  const connected = record.connected && expiresAt !== null && Date.parse(expiresAt) > Date.now();
  return { connected, configured: record.configured, provider: 'openai', expiresAt: connected ? expiresAt : null, stale: record.connected && !connected };
}

export function ProviderSessionPanel() {
  const [state, setState] = useState<State>({ kind: 'checking' });
  const [busy, setBusy] = useState<Busy | null>(null);
  const [accessToken, setAccessToken] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const operation = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const rejectUntilBlur = useRef(false);
  useUnsavedChanges(Boolean(accessToken) || (busy !== null && busy !== 'checking'));

  const start = useCallback((name: Busy): AbortController | null => {
    if (operation.current) return null;
    const active = new AbortController(); operation.current = active;
    setBusy(name); setError(''); setMessage('');
    return active;
  }, []);
  const finish = useCallback((active: AbortController) => {
    if (operation.current === active) { operation.current = null; if (mounted.current) setBusy(null); }
  }, []);
  const failed = useCallback((reason: unknown, fallback: string) => {
    if (!mounted.current || (reason instanceof DOMException && reason.name === 'AbortError')) return;
    if (reason instanceof RequestFailure && reason.status === 401) { setState({ kind: 'signed-out' }); setError('Your local app session ended. Sign in again.'); }
    else if (reason instanceof RequestFailure && reason.status === 429) setError('Too many attempts. Wait before trying again.');
    else if (reason instanceof RequestFailure && reason.status === 409) setError('The session changed. Refresh its status before trying again.');
    else if (reason instanceof RequestFailure && reason.status === 503) setError('The provider is not configured or the local gateway is unavailable.');
    else { setState({ kind: 'unavailable' }); setError(fallback); }
  }, []);

  const refresh = useCallback(async () => {
    const active = start('checking'); if (!active) return;
    if (window.location.protocol !== 'http:' || window.location.hostname !== '127.0.0.1') {
      setState({ kind: 'unavailable' }); finish(active); return;
    }
    setState({ kind: 'checking' });
    try {
      const app = session(await request('/auth/session', active.signal));
      const status = provider(await request('/session/status', active.signal));
      if (mounted.current && !active.signal.aborted) setState({ kind: 'signed-in', csrf: app.csrfToken, status });
    } catch (reason) {
      if (mounted.current && !(reason instanceof DOMException && reason.name === 'AbortError')) {
        if (reason instanceof RequestFailure && reason.status === 401) setState({ kind: 'signed-out' });
        else { setState({ kind: 'unavailable' }); setError('The local gateway could not be reached.'); }
      }
    } finally { finish(active); }
  }, [finish, start]);

  useEffect(() => {
    mounted.current = true; void refresh();
    const online = () => { void refresh(); };
    const offline = () => {
      operation.current?.abort(); operation.current = null;
      setBusy(null); setMessage(''); setState({ kind: 'unavailable' }); setError('The browser is offline. Recheck the local gateway when online.');
    };
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('online', online); window.addEventListener('offline', offline); document.addEventListener('visibilitychange', visible);
    return () => { mounted.current = false; operation.current?.abort(); operation.current = null; window.removeEventListener('online', online); window.removeEventListener('offline', offline); document.removeEventListener('visibilitychange', visible); };
  }, [refresh]);

  useEffect(() => {
    if (state.kind !== 'signed-in' || !state.status.connected || !state.status.expiresAt) return;
    const delay = Math.max(0, Date.parse(state.status.expiresAt) - Date.now());
    const timer = window.setTimeout(() => { setState((current) => current.kind === 'signed-in' ? { ...current, status: { ...current.status, connected: false, expiresAt: null, stale: true } } : current); void refresh(); }, delay);
    return () => window.clearTimeout(timer);
  }, [state, refresh]);

  function onToken(value: string) {
    if (rejectUntilBlur.current) return;
    if (/^\s*sk-/i.test(value)) { rejectUntilBlur.current = true; setAccessToken(''); setError('This is not a local app access token. Leave and return to this field before entering the correct token.'); return; }
    setAccessToken(value); setError('');
  }
  function onPaste(event: ClipboardEvent<HTMLInputElement>) {
    if (/^\s*sk-/i.test(event.clipboardData.getData('text'))) { event.preventDefault(); setAccessToken(''); setError('Do not paste a provider API key here. Use the separate local app access token.'); }
  }
  async function signIn(event: FormEvent) {
    event.preventDefault();
    if (!tokenPattern.test(accessToken)) { setError('Enter the 43-character local app access token. Never enter a provider API key.'); return; }
    const active = start('login'); if (!active) return;
    try {
      const app = session(await request('/auth/login', active.signal, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Request': 'login' }, body: JSON.stringify({ token: accessToken }) }));
      setAccessToken('');
      const status = provider(await request('/session/status', active.signal));
      if (mounted.current && !active.signal.aborted) { setState({ kind: 'signed-in', csrf: app.csrfToken, status }); setMessage('Signed in to the local app session.'); }
    } catch (reason) {
      setAccessToken('');
      if (reason instanceof RequestFailure && reason.status === 401 && mounted.current) setError('The local access token was not accepted.');
      else failed(reason, 'The local gateway could not complete sign-in.');
    } finally { finish(active); }
  }
  async function change(action: 'connect' | 'disconnect' | 'logout') {
    if (state.kind !== 'signed-in') return;
    const active = start(action); if (!active) return;
    try {
      const headers: Record<string, string> = { 'X-CSRF-Token': state.csrf };
      if (action === 'connect') {
        headers['Content-Type'] = 'application/json'; headers['X-Client-Request-Id'] = crypto.randomUUID();
        const status = provider(await request('/session/connect', active.signal, { method: 'POST', headers, body: JSON.stringify({ provider: 'openai' }) }));
        if (mounted.current && !active.signal.aborted) setState({ ...state, status });
      } else if (action === 'disconnect') {
        await request('/session', active.signal, { method: 'DELETE', headers });
        const status = provider(await request('/session/status', active.signal));
        if (mounted.current && !active.signal.aborted) setState({ ...state, status });
      } else {
        await request('/auth/logout', active.signal, { method: 'POST', headers });
        if (mounted.current && !active.signal.aborted) { setState({ kind: 'signed-out' }); setMessage('Signed out. Provider authorization was revoked.'); }
      }
    } catch (reason) { failed(reason, 'The local gateway could not complete the request.'); }
    finally { finish(active); }
  }

  return <section className="notice provider-session" aria-labelledby="provider-heading"><h2 id="provider-heading">Provider connection</h2>
    <p>Local development only. Billable image generation is disabled by default; enabling it can incur provider charges. Use synthetic credentials until security review is complete. This gateway is not approved for production.</p>
    {state.kind === 'checking' && <p role="status">Checking local gateway…</p>}
    {state.kind === 'unavailable' && <><p>The local gateway is unavailable. Start the app using the loopback gateway, then check again.</p><button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => void refresh()}>Check gateway</button></>}
    {state.kind === 'signed-out' && <form className="provider-login" onSubmit={signIn}><p>Sign in with the separate local app access token. Never enter your OpenAI API key in the browser.</p><label htmlFor="local-access-token">Local app access token</label><input id="local-access-token" type="password" autoComplete="off" maxLength={128} value={accessToken} onChange={(event) => onToken(event.target.value)} onBlur={() => { rejectUntilBlur.current = false; }} onPaste={onPaste} disabled={Boolean(busy)} /><button type="submit" className="primary-button" disabled={Boolean(busy) || !accessToken}>Sign in locally</button></form>}
    {state.kind === 'signed-in' && <><p role="status">{state.status.connected ? `Provider authorization active until ${new Date(state.status.expiresAt!).toLocaleString()}.` : state.status.stale ? 'Provider authorization may have expired. Refresh to verify.' : 'Provider authorization is disconnected.'}</p><p>{state.status.configured ? 'A server key is configured; its validity has not been checked.' : 'No server key was configured at startup. Configure it outside the browser and restart the gateway.'}</p><p>Disconnecting does not remove the server key or revoke it at OpenAI.</p><div className="form-actions provider-actions">{state.status.connected ? <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => void change('disconnect')}>Disconnect provider</button> : <button type="button" className="secondary-button" disabled={Boolean(busy) || !state.status.configured} onClick={() => void change('connect')}>Connect provider</button>}<button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => void refresh()}>Refresh status</button><button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => void change('logout')}>Sign out</button></div></>}
    {busy && busy !== 'checking' && <p role="status">Working…</p>}{message && <p role="status">{message}</p>}{error && <p className="error-message" role="alert">{error}</p>}
  </section>;
}
