import test,{beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory,IDBObjectStore} from 'fake-indexeddb';
import {readStoredCredential,writeStoredCredential,authorizeStoredCredential,credentialStore,reserveStoredUpload,markStoredUploadAttempt,recordStoredAttemptOutcome,readMonthlyUsage,utcUsageMonth,estimateMicros,importLegacyUsage} from '../src/browserCredentialStore.ts';
globalThis.window=new EventTarget();
Object.defineProperty(globalThis.navigator,'locks',{configurable:true,value:{request:async(_name,fn)=>fn()}});
const key='sk-synthetic-monthly-usage-only',RealDate=Date;
beforeEach(()=>{globalThis.indexedDB=new IDBFactory()});
afterEach(()=>{globalThis.Date=RealDate});
function run(credential,amount='0.060000'){return {id:crypto.randomUUID(),month:utcUsageMonth(),createdAt:new Date().toISOString(),credentialId:credential.id,authorizationId:credential.authorization.id,attempts:[{id:crypto.randomUUID(),estimatedMicros:estimateMicros(amount),outcome:'RESERVED'}]}}
const reserve=(r,c)=>reserveStoredUpload(r,c.id,c.authorization.id);
const mark=(r,c)=>markStoredUploadAttempt(r.id,r.attempts[0].id,(r.attempts[0].estimatedMicros/1e6).toFixed(6),c.id,c.authorization.id);
test('legacy string keys load without upload permission and require an explicit one-time grant',async()=>{
 await new Promise((resolve,reject)=>{const r=indexedDB.open('image-studio-credentials',1);r.onupgradeneeded=()=>r.result.createObjectStore('credentials');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('credentials','readwrite');tx.objectStore('credentials').put(key,'openai');tx.oncomplete=()=>{db.close();resolve()}}});
 const legacy=await readStoredCredential();assert.equal(legacy.key,key);assert.equal(legacy.authorization,null);assert.equal(legacy.id,'');await assert.rejects(()=>authorizeStoredCredential('',false,''));
 const authorized=await authorizeStoredCredential('',true,'');assert.ok(authorized.id);assert.ok(authorized.authorization.id);assert.equal(authorized.authorization.monthlyCapMicros,null);assert.equal((await readStoredCredential()).authorization.id,authorized.authorization.id);
 await assert.rejects(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('image-studio-credentials',1);r.onerror=()=>reject(r.error);r.onsuccess=()=>{r.result.close();resolve()}}),e=>e.name==='VersionError');
});
test('atomic reservations prevent two simultaneous uploads from exceeding one monthly cap',async()=>{
 const c=await writeStoredCredential(key,true,'0.10'),a=run(c),b=run(c);
 const results=await Promise.allSettled([reserve(a,c),reserve(b,c)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);const usage=await readMonthlyUsage();assert.equal(usage.reservedMicros,60000);assert.equal(usage.recordedRequests,0);
});
test('success, rejection and UNKNOWN keep conservative reservations; recorded counts remain separate',async()=>{
 const c=await writeStoredCredential(key,true,'');
 for(const outcome of ['DEFINITIVE_SUCCESS','DEFINITIVE_FAILURE','UNKNOWN']){const r=run(c);await reserve(r,c);await mark(r,c);await recordStoredAttemptOutcome(r.id,r.attempts[0].id,outcome)}
 await reserve(run(c),c);const usage=await readMonthlyUsage();assert.equal(usage.uploads,4);assert.equal(usage.recordedRequests,3);assert.equal(usage.recordedMicros,180000);assert.equal(usage.reservedMicros,240000);assert.equal(usage.unknownRequests,1);
});
test('key replacement and removal revoke old reservations but preserve usage across keys',async()=>{
 const c=await writeStoredCredential(key,true,'0.10'),r=run(c);await reserve(r,c);
 const replacement=await writeStoredCredential('sk-synthetic-replacement-key',true,'0.10');await assert.rejects(()=>mark(r,c));await assert.rejects(()=>reserve(run(replacement),replacement),/monthly/);
 await credentialStore('delete');await assert.rejects(()=>mark(r,c));assert.equal((await readMonthlyUsage()).reservedMicros,60000);assert.equal(await readStoredCredential(),null);
});
test('changing settings invalidates old authorization and cannot erase spent or reserved estimates',async()=>{
 const c=await writeStoredCredential(key,true,''),r=run(c);await reserve(r,c);
 const updated=await authorizeStoredCredential(c.id,true,'0.01');assert.notEqual(updated.authorization.id,c.authorization.id);await assert.rejects(()=>mark(r,c));await assert.rejects(()=>reserve(run(updated),updated),/monthly/);assert.equal((await readMonthlyUsage()).reservedMicros,60000);
});
test('UTC month rollovers reject a previous-month run without resetting old reservations or reusing attempts',async()=>{
 let instant='2026-11-30T23:59:59.000Z';globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[instant]))}static now(){return new RealDate(instant).valueOf()}};
 const c=await writeStoredCredential(key,true,'0.10'),r=run(c);await reserve(r,c);instant='2026-12-01T00:00:01.000Z';await assert.rejects(()=>mark(r,c));assert.equal((await readMonthlyUsage()).reservedMicros,0);assert.equal((await readMonthlyUsage('2026-11')).reservedMicros,60000);const next=run(c);await reserve(next,c);await mark(next,c);await assert.rejects(()=>mark(next,c));assert.equal((await readMonthlyUsage()).recordedRequests,1);
});
test('legacy history import is atomic and idempotent across tabs, and new usage remains',async()=>{
 const c=await writeStoredCredential(key,true,''),legacy={...run(c),legacy:true};await Promise.all([importLegacyUsage([legacy]),importLegacyUsage([legacy])]);assert.equal((await readMonthlyUsage()).uploads,1);await reserve(run(c),c);await importLegacyUsage([]);assert.equal((await readMonthlyUsage()).uploads,2);
});
test('quota failures cannot create an unrecorded reservation or silently reset usage',async()=>{
 const c=await writeStoredCredential(key,true,''),r=run(c),put=IDBObjectStore.prototype.add;IDBObjectStore.prototype.add=function(){throw new DOMException('synthetic quota','QuotaExceededError')};try{await assert.rejects(()=>reserve(r,c))}finally{IDBObjectStore.prototype.add=put}assert.equal((await readMonthlyUsage()).uploads,0);await reserve(r,c);assert.equal((await readMonthlyUsage()).reservedMicros,60000);
});
test('tampered estimates or attempt identities are blocked before a request receipt',async()=>{
 const c=await writeStoredCredential(key,true,''),r=run(c);await reserve(r,c);await assert.rejects(()=>markStoredUploadAttempt(r.id,crypto.randomUUID(),'0.060000',c.id,c.authorization.id));await assert.rejects(()=>markStoredUploadAttempt(r.id,r.attempts[0].id,'0.000001',c.id,c.authorization.id));assert.equal((await readMonthlyUsage()).recordedRequests,0);
});
