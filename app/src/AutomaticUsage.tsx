import {useEffect,useState} from 'react';
import {monthlyAutomaticUsage,type MonthlyUsage} from './automaticSession';
import {Disclosure,DisclosureSummary} from './ui/components';
import {t} from './ui/i18n';
export function AutomaticUsage({details=false}:{details?:boolean}){
  const [usage,setUsage]=useState<MonthlyUsage|null>(null),[failed,setFailed]=useState(false);
  useEffect(()=>{let alive=true;const refresh=()=>{void monthlyAutomaticUsage().then(value=>{if(alive){setUsage(value);setFailed(false)}}).catch(()=>{if(alive)setFailed(true)})};refresh();window.addEventListener('studio-auto-usage',refresh);window.addEventListener('focus',refresh);return()=>{alive=false;window.removeEventListener('studio-auto-usage',refresh);window.removeEventListener('focus',refresh)}},[]);
  if(failed)return <p className="muted" role="status">{t('Local usage unavailable. Uploads require working local records.')}</p>;
  if(!usage)return <p className="muted" role="status">{t('Loading local usage…')}</p>;
  return <div className="automatic-usage" aria-label={t('This month on this browser')}>
    <p><strong>{t('This month · {month} UTC',{month:usage.month})}</strong> · {t('{count} recorded requests · estimated ${amount} USD',{count:usage.recordedRequests,amount:(usage.recordedMicros/1e6).toFixed(2)})}</p>
    <p className="muted">{t('Local estimate, not your OpenAI bill.')}</p>
    {details&&<Disclosure><DisclosureSummary>{t('Local estimate details')}</DisclosureSummary><p>{t('Automatic uploads on this browser only. Local estimates are not your OpenAI bill or account-wide usage.')}</p><p>{t('Reserved estimate: ${amount} USD across {count} uploads.',{amount:(usage.reservedMicros/1e6).toFixed(6),count:usage.uploads})}</p><p>{t('Reservations include failed, uncertain and unsent attempts. Recorded requests may include a request stopped immediately before transmission. Nothing is automatically retried.')}</p>{usage.unknownRequests>0&&<p>{t('{count} request outcomes remain uncertain.',{count:usage.unknownRequests})}</p>}<p>{t('Months use UTC. Replacing or removing a key keeps this local history. Advanced workspace requests are outside this upload estimate.')}</p></Disclosure>}
  </div>;
}
