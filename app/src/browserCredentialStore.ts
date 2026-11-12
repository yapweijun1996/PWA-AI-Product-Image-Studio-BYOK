// Owner-authorized device-local credentials. Never export this database.
export type UploadAuthorization = { id: string; grantedAt: string; monthlyCapMicros: number | null };
export type StoredCredential = { version: 2; id: string; key: string; authorization: UploadAuthorization | null };
export type UsageAttempt = { id: string; estimatedMicros: number; outcome: 'RESERVED' | 'IN_FLIGHT' | 'DEFINITIVE_SUCCESS' | 'DEFINITIVE_FAILURE' | 'UNKNOWN' };
export type UsageReservation = { id: string; month: string; createdAt: string; authorizationId: string; credentialId: string; attempts: UsageAttempt[]; legacy?: true };
export type MonthlyUsage = { month: string; reservedMicros: number; recordedMicros: number; recordedRequests: number; unknownRequests: number; uploads: number };
const DATABASE = 'image-studio-credentials';
const usageChannel = typeof document !== 'undefined' && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('image-studio-local-usage') : null;
usageChannel?.addEventListener('message', () => { if(typeof window !== 'undefined')window.dispatchEvent(new Event('studio-auto-usage')); });
function notifyUsage(){if(typeof window !== 'undefined')window.dispatchEvent(new Event('studio-auto-usage'));usageChannel?.postMessage('changed');}
export const utcUsageMonth = (date = new Date()) => date.toISOString().slice(0, 7);
export function estimateMicros(value: string) {
  if (!/^\d{1,7}(?:\.\d{1,6})?$/.test(value)) throw new Error('Invalid local estimate.');
  const micros = Math.round(Number(value) * 1e6);
  if (!Number.isSafeInteger(micros) || micros < 0) throw new Error('Invalid local estimate.');
  return micros;
}
export function monthlyCapMicros(value: string) {
  if (!value.trim()) return null;
  const cap = estimateMicros(value);
  if (cap < 1 || cap > 1_000_000_000) throw new Error('Choose a monthly estimate limit up to $1000, or leave it off.');
  return cap;
}
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
function credential(value: unknown): StoredCredential | null {
  if (value === undefined) return null;
  // Legacy strings remain usable as keys, never as upload authorization.
  if (typeof value === 'string') return { version: 2, id: '', key: value, authorization: null };
  const r = value as StoredCredential;
  if (!r || r.version !== 2 || !uuid(r.id) || typeof r.key !== 'string' || !/^sk-[A-Za-z0-9_-]{10,500}$/.test(r.key) ||
      (r.authorization !== null && (!uuid(r.authorization?.id) || !Number.isFinite(Date.parse(r.authorization?.grantedAt)) || (r.authorization.monthlyCapMicros !== null && (!Number.isSafeInteger(r.authorization.monthlyCapMicros) || r.authorization.monthlyCapMicros < 1 || r.authorization.monthlyCapMicros > 1_000_000_000))))) throw new Error('Saved upload settings require recovery.');
  return r;
}
function reservation(value: unknown): UsageReservation {
  const r = value as UsageReservation;
  if (!r || !uuid(r.id) || !/^\d{4}-\d{2}$/.test(r.month) || !Number.isFinite(Date.parse(r.createdAt)) || !Array.isArray(r.attempts) || r.attempts.length > 7 || r.attempts.some(a => !uuid(a.id) || !Number.isSafeInteger(a.estimatedMicros) || a.estimatedMicros < 1 || !['RESERVED','IN_FLIGHT','DEFINITIVE_SUCCESS','DEFINITIVE_FAILURE','UNKNOWN'].includes(a.outcome)) || new Set(r.attempts.map(a=>a.id)).size !== r.attempts.length) throw new Error('Local usage history requires recovery.');
  return r;
}
function totals(rows: UsageReservation[], month: string): MonthlyUsage {
  const selected = rows.filter(r=>r.month===month);
  const attempts = selected.flatMap(r=>r.attempts);
  const sum = (items: UsageAttempt[]) => { const n=items.reduce((n,a)=>n+a.estimatedMicros,0); if(!Number.isSafeInteger(n))throw new Error('Local usage history exceeds safe bounds.');return n; };
  const recorded = attempts.filter(a=>a.outcome!=='RESERVED');
  return { month, reservedMicros: sum(attempts), recordedMicros: sum(recorded), recordedRequests: recorded.length, unknownRequests: recorded.filter(a=>a.outcome==='IN_FLIGHT'||a.outcome==='UNKNOWN').length, uploads: selected.length };
}
async function database() {
  return new Promise<IDBDatabase>((resolve,reject)=>{
    let rejected=false;
    const r=indexedDB.open(DATABASE,2);
    r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('credentials'))r.result.createObjectStore('credentials');if(!r.result.objectStoreNames.contains('usage'))r.result.createObjectStore('usage',{keyPath:'id'});};
    r.onsuccess=()=>{if(rejected){r.result.close();return;}r.result.onversionchange=()=>r.result.close();resolve(r.result);};
    r.onerror=r.onblocked=()=>{rejected=true;reject(new Error('Credential storage is unavailable. Close older app tabs and try again.'));};
  });
}
async function transaction<T>(write: boolean, action: (credentials: IDBObjectStore, usage: IDBObjectStore, finish: (value: T)=>void, fail: (error: Error)=>void)=>void): Promise<T> {
  if (!navigator.locks) throw new Error('This browser cannot safely coordinate local upload settings.');
  return navigator.locks.request('image-studio-credentials',async()=>{
    const db=await database();
    try{return await new Promise<T>((resolve,reject)=>{
      const tx=db.transaction(['credentials','usage'],write?'readwrite':'readonly');let result:T, error:Error|undefined;
      const fail=(value:Error)=>{error=value;try{tx.abort()}catch{reject(value)}};
      tx.oncomplete=()=>resolve(result);tx.onerror=tx.onabort=()=>reject(error??new Error('Local credential or usage storage operation failed.'));
      try{action(tx.objectStore('credentials'),tx.objectStore('usage'),value=>{result=value},fail)}catch(e){fail(e instanceof Error?e:new Error('Local storage operation failed.'))}
    })}finally{db.close()}
  }).then(result=>{if(write)notifyUsage();return result});
}
export function readStoredCredential(): Promise<StoredCredential|null> {
  return transaction(false,(store,_usage,finish,fail)=>{const r=store.get('openai');r.onsuccess=()=>{try{finish(credential(r.result))}catch(e){fail(e as Error)}}});
}
export function writeStoredCredential(key:string, consent=false, cap:string=''): Promise<StoredCredential> {
  const limit=monthlyCapMicros(cap);
  if(!/^sk-[A-Za-z0-9_-]{10,500}$/.test(key)||key.startsWith('sk-or-'))return Promise.reject(new Error('Enter an OpenAI API key.'));
  const record:StoredCredential={version:2,id:crypto.randomUUID(),key,authorization:consent===true?{id:crypto.randomUUID(),grantedAt:new Date().toISOString(),monthlyCapMicros:limit}:null};
  return transaction(true,(store,_usage,finish)=>{store.put(record,'openai');finish(record)});
}
export function authorizeStoredCredential(expectedId:string, consent:boolean, cap:string): Promise<StoredCredential> {
  const limit=monthlyCapMicros(cap);
  if(consent!==true)return Promise.reject(new Error('Authorize future uploads once for this saved key.'));
  return transaction(true,(store,_usage,finish,fail)=>{const r=store.get('openai');r.onsuccess=()=>{try{const current=credential(r.result);if(!current||current.id!==expectedId)throw new Error('The saved key changed. Reload its settings.');const next={...current,id:current.id||crypto.randomUUID(),authorization:{id:crypto.randomUUID(),grantedAt:new Date().toISOString(),monthlyCapMicros:limit}};store.put(next,'openai');finish(next)}catch(e){fail(e as Error)}}});
}
export async function credentialStore(operation:'read'|'write'|'delete',value?:string):Promise<string|null>{
  if(operation==='read')return (await readStoredCredential())?.key??null;
  if(operation==='write'){await writeStoredCredential(value??'');return null;}
  return transaction(true,(store,_usage,finish)=>{store.delete('openai');finish(null)});
}
export function usageImported():Promise<boolean>{return transaction(false,(_store,usage,finish)=>{const r=usage.get('legacy-import-v1');r.onsuccess=()=>finish(r.result?.complete===true)})}
export function importLegacyUsage(rows:UsageReservation[]):Promise<void>{
  return transaction(true,(_store,usage,finish,fail)=>{const marker=usage.get('legacy-import-v1');marker.onsuccess=()=>{try{if(!marker.result){for(const row of rows)usage.put(reservation(row));usage.put({id:'legacy-import-v1',complete:true})}finish()}catch(e){fail(e as Error)}}});
}
export function readMonthlyUsage(month=utcUsageMonth()):Promise<MonthlyUsage>{
  return transaction(false,(_store,usage,finish,fail)=>{const r=usage.getAll();r.onsuccess=()=>{try{finish(totals(r.result.filter(row=>row.id!=='legacy-import-v1').map(reservation),month))}catch(e){fail(e as Error)}}});
}
export function reserveStoredUpload(run:UsageReservation, expectedCredentialId:string, expectedAuthorizationId:string):Promise<void>{
  reservation(run);
  return transaction(true,(store,usage,finish,fail)=>{
    const key=store.get('openai'),records=usage.getAll();let credentialRead=false,usageRead=false;
    const check=()=>{if(!credentialRead||!usageRead)return;try{
      const current=credential(key.result),auth=current?.authorization;
      if(!current||current.id!==expectedCredentialId||!auth||auth.id!==expectedAuthorizationId||run.credentialId!==current.id||run.authorizationId!==auth.id||run.month!==utcUsageMonth())throw new Error('Saved upload authorization changed. Reload before uploading.');
      const rows=records.result.filter(r=>r.id!=='legacy-import-v1').map(reservation);if(rows.some(r=>r.id===run.id))throw new Error('This upload was already reserved.');
      const amount=totals([run],run.month).reservedMicros,used=totals(rows,run.month).reservedMicros;
      if(auth.monthlyCapMicros!==null&&used+amount>auth.monthlyCapMicros)throw new Error('This upload exceeds your optional monthly local estimate limit. Change or turn off the limit in Settings.');
      usage.add(run);finish();
    }catch(e){fail(e as Error)}};
    key.onsuccess=()=>{credentialRead=true;check()};records.onsuccess=()=>{usageRead=true;check()};
  });
}
// Called inside the existing serialized dispatch, immediately before the fetch.
export function markStoredUploadAttempt(runId:string, attemptId:string, amount:string, expectedCredentialId:string, expectedAuthorizationId:string):Promise<void>{
  return transaction(true,(store,usage,finish,fail)=>{
    const key=store.get('openai'),record=usage.get(runId);let keyRead=false,runRead=false;
    const check=()=>{if(!keyRead||!runRead)return;try{const current=credential(key.result),run=reservation(record.result),attempt=run.attempts.find(a=>a.id===attemptId);if(!current?.authorization||current.id!==expectedCredentialId||current.authorization.id!==expectedAuthorizationId||run.credentialId!==current.id||run.authorizationId!==current.authorization.id||run.month!==utcUsageMonth()||!attempt||attempt.estimatedMicros!==estimateMicros(amount)||attempt.outcome!=='RESERVED')throw new Error('Upload authorization or reservation changed. No request was sent.');attempt.outcome='IN_FLIGHT';usage.put(run);finish()}catch(e){fail(e as Error)}};
    key.onsuccess=()=>{keyRead=true;check()};record.onsuccess=()=>{runRead=true;check()};
  });
}
export function recordStoredAttemptOutcome(runId:string,attemptId:string,outcome:UsageAttempt['outcome']):Promise<void>{
  return transaction(true,(_store,usage,finish,fail)=>{const r=usage.get(runId);r.onsuccess=()=>{try{const run=reservation(r.result),attempt=run.attempts.find(a=>a.id===attemptId);if(!attempt||attempt.outcome==='RESERVED')throw new Error('Local attempt receipt is missing.');attempt.outcome=outcome;usage.put(run);finish()}catch(e){fail(e as Error)}}});
}
