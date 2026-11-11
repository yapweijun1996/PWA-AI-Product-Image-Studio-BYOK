import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { browserStudioRequest as request, setBrowserKey, clearBrowserKey, browserKeyStatus } from '../src/browserByok.ts';
import { STUDIO_MODEL, STUDIO_QUALITY, STUDIO_SIZE, studioBuildPrompt, studioEstimateUSD } from '../studio-policy.mjs';
const storage=new Map();globalThis.window=new EventTarget();globalThis.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)};
Object.defineProperty(globalThis.navigator,'locks',{configurable:true,value:{request:async(_name,fn)=>fn()}});
const originalFetch=globalThis.fetch,key='sk-synthetic-only-never-real-12345';
afterEach(()=>{clearBrowserKey();storage.clear();globalThis.fetch=originalFetch});
function body(){const sceneContext={productName:'Synthetic lamp',category:'lighting',confirmedFacts:[],sourceView:'OTHER'},prompt=studioBuildPrompt('studio',sceneContext);return {clientAttemptId:crypto.randomUUID(),model:STUDIO_MODEL,quality:STUDIO_QUALITY,size:STUDIO_SIZE,styleId:'studio',sceneContext,prompt,estimatedUSD:studioEstimateUSD(prompt),outputFormat:'png',operation:'generate_scene',lockMode:'STRICT'}}
async function approved(b){b.reviewRevision=(await(await request('/images/revision')).json()).reviewRevision;const a=await(await request('/images/approvals',{method:'POST',body:JSON.stringify(b)})).json();return {method:'POST',body:JSON.stringify(b),headers:{'X-Client-Request-Id':b.clientAttemptId,'X-Attempt-Approval':a.approvalId}}}
test('SDK sends one direct allowlisted request without persisting key',async()=>{
 setBrowserKey(key);let calls=0;globalThis.fetch=async(url,options)=>{calls++;assert.equal(String(url),'https://api.openai.com/v1/images/generations');assert.equal(new Headers(options.headers).get('authorization'),`Bearer ${key}`);assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');const input=JSON.parse(options.body);assert.equal(input.model,STUDIO_MODEL);assert.equal(input.quality,'low');assert.equal(input.n,1);return Response.json({data:[{b64_json:'iVBORw0KGgo='}]})};
 const b=body(),init=await approved(b),result=await(await request('/images/generate',init)).json();assert.equal(result.outcome,'DEFINITIVE_SUCCESS');assert.equal(calls,1);assert.equal((await request('/images/generate',init)).status,409);assert.equal(calls,1);assert.ok(!JSON.stringify([...storage]).includes(key));clearBrowserKey();assert.equal(browserKeyStatus().connected,false);assert.equal((await request('/auth/session')).status,401);
});
test('ambiguous failure is UNKNOWN, blocks new sends and requires explicit review',async()=>{
 setBrowserKey(key);let calls=0;globalThis.fetch=async()=>{calls++;throw new Error(`untrusted ${key}`)};
 const b=body(),result=await(await request('/images/generate',await approved(b))).json();assert.equal(result.error.outcome,'UNKNOWN');assert.equal(calls,1);assert.ok(!JSON.stringify(result).includes(key));const next=body();next.reviewRevision=b.reviewRevision;assert.equal((await request('/images/approvals',{method:'POST',body:JSON.stringify(next)})).status,409);
 const ack=await(await request(`/images/attempts/${b.clientAttemptId}/acknowledgement`,{method:'POST',body:JSON.stringify({acknowledgePossibleCharge:true})})).json();assert.equal(ack.recordedOutcome,'UNKNOWN');assert.equal(calls,1);clearBrowserKey();setBrowserKey(key);assert.ok(storage.size>0);assert.equal((await request('/images/generate',await approved(body()))).status,502);assert.equal(calls,2);
});
test('429 has no automatic retry and delay survives reconnect',async()=>{
 setBrowserKey(key);let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({error:{message:key,type:'rate_limit_error'}},{status:429,headers:{'retry-after':'37'}})};
 const b=body(),result=await(await request('/images/generate',await approved(b))).json();assert.equal(result.error.retryAfterSeconds,37);assert.equal(calls,1);assert.ok(!JSON.stringify(result).includes(key));clearBrowserKey();setBrowserKey(key);const next=body();next.reviewRevision=(await(await request('/images/revision')).json()).reviewRevision;assert.equal((await request('/images/approvals',{method:'POST',body:JSON.stringify(next)})).status,409);
});
test('key replacement invalidates consent and corrupt history fails closed',async()=>{
 setBrowserKey(key);const b=body(),init=await approved(b);clearBrowserKey();setBrowserKey(key);let calls=0;globalThis.fetch=async()=>{calls++;throw new Error()};assert.equal((await request('/images/generate',init)).status,409);assert.equal(calls,0);const next=body();next.model='unapproved';assert.equal((await request('/images/approvals',{method:'POST',body:JSON.stringify(next)})).status,409);storage.set('studio.browser-byok.attempts.v1','broken');await assert.rejects(()=>request('/images/legacy-waits'));assert.equal(calls,0);
});
test('clearing a key aborts the in-flight request and preserves UNKNOWN without leaking errors',async()=>{
 setBrowserKey(key);let started;const dispatched=new Promise(r=>started=r);let calls=0;
 globalThis.fetch=async(_url,options)=>{calls++;started();return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error(key)),{once:true}))};
 const b=body(),init=await approved(b),resultPromise=request('/images/generate',init);await dispatched;clearBrowserKey();const result=await(await resultPromise).json();assert.equal(result.error.outcome,'UNKNOWN');assert.equal(calls,1);assert.ok(!JSON.stringify([...storage]).includes(key));
});
test('401 is definitive and untrusted provider error text is not exposed',async()=>{
 setBrowserKey(key);let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({error:{message:key}},{status:401})};const result=await(await request('/images/generate',await approved(body()))).json();assert.equal(result.error.outcome,'DEFINITIVE_FAILURE');assert.equal(calls,1);assert.ok(!JSON.stringify(result).includes(key));
});
