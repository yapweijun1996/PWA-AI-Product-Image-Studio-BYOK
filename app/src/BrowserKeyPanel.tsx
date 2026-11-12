import { t } from './ui/i18n';
import { Button, Input } from './ui/components';
import { Link } from "react-router-dom";
import { useEffect, useState, type FormEvent } from "react";
import { listAutoRuns } from "./automaticStore";
import { automaticPlan, resolveAutomaticHolds } from "./automaticPipeline";
import { automaticSessionStatus, authorizeAutomaticSession } from "./automaticSession";
import { useUnsavedChanges } from "./useUnsavedChanges";
import {
  browserKeyStatus,
  browserWaitReviewNeeded,
  forgetBrowserKey,
  restoreSavedBrowserKey,
  onBrowserKeyChange,
  saveBrowserKey,
} from "./browserByok";
export function BrowserKeyPanel() {
  const [authorized,setAuthorized]=useState(()=>Boolean(automaticSessionStatus()));
  useEffect(()=>{const update=()=>setAuthorized(Boolean(automaticSessionStatus()));window.addEventListener('studio-auto-session',update);update();return()=>window.removeEventListener('studio-auto-session',update)},[]);
  const [busy,setBusy]=useState(false);
  const [storageReady,setStorageReady]=useState(false);
  useEffect(()=>{restoreSavedBrowserKey().catch(()=>setError("Saved key could not be read. Enter a key to try saving again.")).finally(()=>{setStatus(browserKeyStatus());setStorageReady(true)});},[]);
  const [recovery, setRecovery] = useState(false),
    [hasHolds, setHasHolds] = useState(false);
  useEffect(() => {
    void listAutoRuns()
      .then((rows) =>
        setHasHolds(
          browserWaitReviewNeeded() ||
            rows.some((r) =>
              r.items.some(
                (i) =>
                  (i.status === "UNKNOWN" || i.status === "SUBMITTED") &&
                  !i.reviewedAt,
              ),
            ),
        ),
      )
      .catch(() => setError("Saved request history is unavailable."));
  }, []);
  const [limit, setLimit] = useState("1.00"),
    [consent, setConsent] = useState(false);
  const [value, setValue] = useState(""),
    [status, setStatus] = useState(browserKeyStatus),
    [error, setError] = useState("");
  useUnsavedChanges(Boolean(value));
  useEffect(() => onBrowserKeyChange(() => setStatus(browserKeyStatus())), []);
  async function connect(event: FormEvent) {
    event.preventDefault();
    if(busy)return;
    setBusy(true);
    try {
      if (!consent || Number(limit) <= 0) throw new Error();
      if(value.trim())await saveBrowserKey(value.trim());
      if(!browserKeyStatus().connected)throw new Error();
      if (recovery) await resolveAutomaticHolds(true);
      authorizeAutomaticSession(limit, consent);
      setValue("");
      setError("");
      setHasHolds(false);
    } catch {
      setError(
        "Setup did not finish. Check your key, local storage, estimate limit and consent. A saved key alone does not authorize uploads.",
      );
    }finally{setBusy(false)}
  }
  return (
    <section>
      <h2>{t("Bring your own OpenAI key")}</h2>
      <p>{t("Your key is saved on this device until removed. Browser scripts and extensions may read it.")}</p>
      <p role="status">{!storageReady ? 'Loading saved key…' : status.connected ? 'Key available in this tab. '+(status.saved?'Saved on this device. ':'')+(authorized?'Session ready for uploads. Key not verified with OpenAI.':'Not verified with OpenAI; authorize this session below.') : status.saved ? 'Saved key needs to be reloaded. Reopen Settings to continue.' : t('No key connected. Set up your key and budget to start uploading.')}</p>
      <form onSubmit={connect}>
        {hasHolds && (
          <label>
            <Input
              type="checkbox"
              checked={recovery}
              onChange={(e) => setRecovery(e.target.checked)}
            />{t("I checked provider billing and waiting periods for interrupted requests and authorize new uploads. Previous outcomes remain unknown and will not be retried.")}</label>
        )}
        <label>{t("OpenAI API key")}<Input
            type="password"
            placeholder={status.connected ? "Saved key — enter a new key to replace" : "sk-…"}
            disabled={busy || !storageReady}
            value={value}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <label>{t("Session estimate limit (USD)")}<Input
            type="number"
            min="0.01"
            max="1000"
            step="0.01"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
          />
        </label>
        <label>
          <Input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />{t("I have rights to my uploads and authorize up to seven potentially billable image requests per upload within this session estimate limit. Estimates are not a hard provider spending cap.")}</label>
        <Button
          type="submit"
          disabled={busy || !storageReady || (!value.trim() && !status.connected) || !consent || (hasHolds && !recovery)}
        >{busy ? t("Preparing…") : t("Set up session")}</Button>
      </form>
      <div className="session-actions">
      <Button
        type="button"
        className="secondary-button"
        disabled={busy || (!status.connected && !status.saved)}
        onClick={() => {
          setBusy(true);setValue("");
          void forgetBrowserKey().catch(()=>setError("Key cleared from this tab, but removal from device storage failed. Try removing it again.")).finally(()=>setBusy(false));
        }}
      >{t("Remove saved key")}</Button>
      {status.connected && authorized && (
        <>
          <Link className="primary-button" to="/">{t("Upload a product")}</Link>
        </>
      )}
      </div>
      {error && <p role="alert">{error}</p>}
      <details><summary>{t("Privacy and provider billing")}</summary><p>Each upload starts up to seven potentially billable requests, estimated ${automaticPlan().estimatedUSD} USD. Estimates are not a spending cap. No automatic retries.</p><p>The key is stored in this browser’s IndexedDB without a separate password. It is excluded from backups, caches and exports. Remove it before sharing this browser profile. Spending authorization is not restored after reload.</p><p>Requests go directly to OpenAI. Source images stay local. A saved key is not proof of valid credentials. If OpenAI rejects authentication, replace the key; if the browser cannot read the response, check billing before authorizing a new attempt.</p></details>
    </section>
  );
}
