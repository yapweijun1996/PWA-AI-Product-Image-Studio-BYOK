import { useEffect, useState, type FormEvent } from 'react';
import { useUnsavedChanges } from './useUnsavedChanges';
import { browserKeyStatus, clearBrowserKey, onBrowserKeyChange, setBrowserKey } from './browserByok';
export function BrowserKeyPanel() {
  const [value,setValue] = useState(''), [status,setStatus] = useState(browserKeyStatus), [error,setError] = useState('');
  useUnsavedChanges(Boolean(value));
  useEffect(() => onBrowserKeyChange(() => setStatus(browserKeyStatus())), []);
  function connect(event: FormEvent) { event.preventDefault(); try { setBrowserKey(value.trim()); setValue(''); setError(''); } catch { setError('Enter a valid OpenAI API key.'); } }
  return <section><h2>Bring your own OpenAI key</h2>
    <p>Requests go directly from this browser to OpenAI and are billed to your account. Product images and masks stay local; the selected product name, category and facts are sent in scene prompts.</p>
    <p>Your key is kept in this tab’s memory for up to one hour. Refreshing or closing the page clears it. Browser extensions or malicious scripts can still read it. Use a dedicated project key and set spending limits in your OpenAI account.</p>
    <p role="status">{status.connected ? `Key available in this tab until ${status.expiresAt}. It has not been verified with OpenAI.` : 'No key connected. Add your key to generate images on GitHub Pages.'}</p>
    <form onSubmit={connect}><label>OpenAI API key<input type="password" value={value} autoComplete="off" autoCapitalize="none" spellCheck={false} onChange={e=>setValue(e.target.value)} /></label><button type="submit" disabled={!value.trim()}>Use key in this tab</button></form>
    <button type="button" className="secondary-button" disabled={!status.connected} onClick={()=>{clearBrowserKey();setValue('');}}>Clear key</button>
    {error && <p role="alert">{error}</p>}<p>No automatic retries. A timeout or interrupted request may still be charged. Reconnect after a refresh, inspect saved history and provider billing before authorizing another attempt.</p>
  </section>;
}
