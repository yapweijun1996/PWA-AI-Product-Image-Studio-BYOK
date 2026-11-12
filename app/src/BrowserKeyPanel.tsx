import {Disclosure,DisclosureSummary,Button,Input,ErrorNotice} from './ui/components';
import {t} from './ui/i18n';
import {Link} from 'react-router-dom';
import {useEffect,useState,type FormEvent} from 'react';
import {listAutoRuns} from './automaticStore';
import {automaticPlan,resolveAutomaticHolds} from './automaticPipeline';
import {automaticSessionStatus} from './automaticSession';
import {AutomaticUsage} from './AutomaticUsage';
import {monthlyCapMicros} from './browserCredentialStore';
import {useUnsavedChanges} from './useUnsavedChanges';
import {browserKeyStatus,providerKeyMismatch,browserWaitReviewNeeded,forgetBrowserKey,restoreSavedBrowserKey,onBrowserKeyChange,saveBrowserKey,saveUploadAuthorization} from './browserByok';
export function BrowserKeyPanel(){
  const [busy,setBusy]=useState(false),[storageReady,setStorageReady]=useState(false),[status,setStatus]=useState(browserKeyStatus),[error,setError]=useState('');
  const [value,setValue]=useState(''),[consent,setConsent]=useState(false),[limit,setLimit]=useState(''),[hasHolds,setHasHolds]=useState(false),[recovery,setRecovery]=useState(false);
  useUnsavedChanges(Boolean(value));
  const authorized=Boolean(status.connected&&status.uploadAuthorization),replacement=Boolean(value.trim()),needsConsent=!authorized||replacement;
  const keyProblem=value.trim().startsWith('sk-or-')?providerKeyMismatch:'';
  let capInvalid=false;try{monthlyCapMicros(limit)}catch{capInvalid=true}
  useEffect(()=>{let alive=true;const refresh=()=>{if(alive)setStatus(browserKeyStatus())};const stop=onBrowserKeyChange(refresh);void restoreSavedBrowserKey().then(()=>{if(alive){const current=browserKeyStatus();setStatus(current);setLimit(current.uploadAuthorization?.monthlyCapMicros?String(current.uploadAuthorization.monthlyCapMicros/1e6):'')}}).catch(()=>{if(alive)setError('Saved key could not be read. Close older app tabs or save your key again.')}).finally(()=>{if(alive)setStorageReady(true)});return()=>{alive=false;stop()}},[]);
  useEffect(()=>{void listAutoRuns().then(rows=>setHasHolds(browserWaitReviewNeeded()||rows.some(r=>r.items.some(i=>(i.status==='UNKNOWN'||i.status==='SUBMITTED')&&!i.reviewedAt)))).catch(()=>setError('Saved request history is unavailable.'))},[]);
  async function save(event:FormEvent){event.preventDefault();if(busy)return;setBusy(true);setError('');try{
    monthlyCapMicros(limit);
    if(needsConsent&&!consent)throw new Error('Authorize future uploads once for this saved key.');
    if(replacement)await saveBrowserKey(value.trim(),true,limit);
    else if(needsConsent||limit!==(status.uploadAuthorization?.monthlyCapMicros?String(status.uploadAuthorization.monthlyCapMicros/1e6):''))await saveUploadAuthorization(needsConsent?consent:true,limit);
    if(hasHolds){if(!recovery)throw new Error('Review interrupted requests before continuing.');await resolveAutomaticHolds(true);setHasHolds(false);setRecovery(false)}
    setValue('');setConsent(false);setStatus(browserKeyStatus());
  }catch(e){setError(e instanceof Error?e.message:'Upload settings could not be saved.')}finally{setBusy(false)}}
  return <section>
    <h2>{t(authorized?'Usage & API key':'Bring your own OpenAI key')}</h2>
    {!authorized&&<p>{t('Save your key and authorize future uploads once. No monthly limit is required.')}</p>}
    {!authorized&&<p>{t('Your key is saved on this device until removed. Browser scripts and extensions may read it.')}</p>}
    <p role="status">{!storageReady?t('Loading saved key…'):status.connected?hasHolds?t('Review interrupted requests before uploading again.'):authorized?t('Ready to create. Your key and upload permission are saved.'):t('Saved key loaded. Authorize future uploads once below.'):status.saved?t('Reload your saved key to continue. Your upload permission is kept.'):t('Add your OpenAI key to get started.')}</p>
    <AutomaticUsage details/>
    {(keyProblem||error)&&<ErrorNotice id="byok-error" title={t(keyProblem||error===providerKeyMismatch?'API key issue':'Setup needs attention')}>{keyProblem||error}</ErrorNotice>}
    {!status.connected&&status.saved&&<Button type="button" className="secondary-button" disabled={busy} onClick={()=>{setBusy(true);void restoreSavedBrowserKey().catch(()=>setError('Saved key could not be read.')).finally(()=>setBusy(false))}}>{t('Reload saved key')}</Button>}
    <Disclosure className="key-management" open={!authorized||hasHolds}><DisclosureSummary>{t("Manage key & limits")}</DisclosureSummary>
    <form onSubmit={save}>
      {hasHolds&&<label><Input type="checkbox" checked={recovery} onChange={e=>setRecovery(e.target.checked)}/>{t('I checked provider billing and waiting periods for interrupted requests and authorize new uploads. Previous outcomes remain unknown and will not be retried.')}</label>}
      <label>{t('OpenAI API key')}<Input type="password" aria-invalid={Boolean(keyProblem)} aria-describedby={keyProblem||error?'byok-error':undefined} placeholder={status.connected?t('Saved key — enter a new key to replace'):'sk-…'} disabled={busy||!storageReady} value={value} autoComplete="off" autoCapitalize="none" spellCheck={false} onChange={e=>{setValue(e.target.value);setConsent(false)}}/></label>
      {needsConsent&&<label><Input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>{t('I have rights to my uploads and authorize future uploads with this saved key to start up to six potentially billable requests each. Keep this permission on this browser until I replace or remove the key. Estimates are not a provider spending cap.')}</label>}
      <Disclosure><DisclosureSummary>{t('Optional monthly estimate limit')}</DisclosureSummary><p>{t('Leave this off to upload without a local monthly limit. Set it once if you want a reminder boundary; it is not an OpenAI account spending cap.')}</p><label>{t('Monthly local estimate limit (USD, optional)')}<Input type="number" min="0.01" max="1000" step="0.01" value={limit} placeholder={t('No limit')} disabled={busy} onChange={e=>setLimit(e.target.value)}/></label>{status.uploadAuthorization?.monthlyCapMicros!==null&&status.uploadAuthorization&&<p>{t('Current optional monthly limit: ${amount} USD.',{amount:(status.uploadAuthorization.monthlyCapMicros/1e6).toFixed(2)})}</p>}</Disclosure>
      <Button type="submit" disabled={busy||!storageReady||Boolean(keyProblem)||capInvalid||(!value.trim()&&!status.connected)||(needsConsent&&!consent)||(hasHolds&&!recovery)}>{busy?t('Preparing…'):needsConsent?t('Save key & allow uploads'):hasHolds?t('Resume new uploads'):t('Save upload settings')}</Button>
    </form></Disclosure>
    <div className="session-actions"><Button type="button" className="secondary-button" disabled={busy||(!status.connected&&!status.saved)} onClick={()=>{setBusy(true);setValue('');void forgetBrowserKey().catch(()=>setError('Key cleared from this tab, but removal from device storage failed. Try removing it again.')).finally(()=>setBusy(false))}}>{t('Remove saved key')}</Button>{authorized&&!hasHolds&&!busy&&<Link className="primary-button" to="/">{t('Upload a product')}</Link>}</div>
    <Disclosure><DisclosureSummary>{t('Privacy and provider billing')}</DisclosureSummary>{authorized&&<p>{t('Your key is saved on this device until removed. Browser scripts and extensions may read it.')}</p>}<p>Each upload makes at most six potentially billable requests and one local detail crop. STRICT estimates ${automaticPlan().estimatedUSD} USD; Reference-guided includes image-input allowances. Estimates use planning assumptions, including an unverified 196-output-token allowance. No automatic retries.</p><p>{t('The key and one-time upload permission stay in dedicated browser storage without a separate password. They are excluded from image exports and backups. Replacing or removing the key revokes that permission. Local usage records are kept.')}</p><p>Requests go directly to OpenAI. STRICT keeps photos local. Reference-guided still requires separate tab-only transmission consent, never restored after reload or key changes. A one-hour memory timeout may require reloading the saved key, without authorizing uploads again. An unreadable provider response may have been charged; check billing before recovery.</p></Disclosure>
  </section>;
}
