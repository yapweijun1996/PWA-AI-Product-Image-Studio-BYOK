import {deflateSync} from 'node:zlib';
import test, {afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {browserStudioRequest as request, setBrowserKey, clearBrowserKey, referenceTransmissionAllowed, setReferenceTransmissionConsent} from '../src/browserByok.ts';
import {stripPngMetadata, validateAutomaticReferences} from '../src/automaticReference.ts';
import {automaticPrompt, automaticEstimateUSD, AUTOMATIC_PROMPT_VERSION, AUTOMATIC_LAYOUTS} from '../automatic-policy.mjs';
import {STUDIO_MODEL, STUDIO_QUALITY, STUDIO_SIZE} from '../studio-policy.mjs';
import {sha256} from '../src/prepareSource.ts';
const storage = new Map();
globalThis.window = new EventTarget();
globalThis.localStorage = {getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)};
const locks = {request:async(_name,fn)=>fn()};
Object.defineProperty(globalThis.navigator,'locks',{configurable:true,value:locks});
const originalFetch=globalThis.fetch, key='sk-synthetic-reference-tests-only';
function pngPixel(red) {
 const chunk=(name,data)=>{const out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);out.write(name,4);data.copy(out,8);let crc=0xffffffff;for(const byte of out.subarray(4,-4)){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}out.writeUInt32BE((crc^0xffffffff)>>>0,out.length-4);return out};
 const header=Buffer.alloc(13);header.writeUInt32BE(1);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;
 return Uint8Array.from(Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.from([0,red,30,70,255]))),chunk('IEND',Buffer.alloc(0))]));
}
const png=pngPixel(100);
async function ref(bytes=png){return {mimeType:'image/png',width:1,height:1,sha256:await sha256(bytes),dataBase64:Buffer.from(bytes).toString('base64')}}
async function body(count=1,mode='REFERENCE'){return {clientAttemptId:crypto.randomUUID(),automaticMode:mode,automaticPromptVersion:AUTOMATIC_PROMPT_VERSION,model:STUDIO_MODEL,quality:STUDIO_QUALITY,size:STUDIO_SIZE,styleId:'studio',prompt:automaticPrompt('studio',mode),estimatedUSD:automaticEstimateUSD('studio',mode,count),outputFormat:'png',operation:mode==='REFERENCE'?'reference_edit':'generate_scene',lockMode:mode==='REFERENCE'?'BALANCED':'STRICT',...(mode==='REFERENCE'?{referenceInputs:await Promise.all(Array.from({length:count},()=>ref()))}:{})}}
async function approve(b){b.reviewRevision=(await(await request('/images/revision')).json()).reviewRevision;return request('/images/approvals',{method:'POST',body:JSON.stringify(b)})}
async function approved(b){const a=await(await approve(b)).json();return {method:'POST',body:JSON.stringify(b),headers:{'X-Client-Request-Id':b.clientAttemptId,'X-Attempt-Approval':a.approvalId}}}
afterEach(()=>{clearBrowserKey();storage.clear();globalThis.fetch=originalFetch;locks.request=async(_name,fn)=>fn()});
test('reference mode denies missing tab consent before any provider transmission',async()=>{
 setBrowserKey(key);let calls=0;globalThis.fetch=async()=>{calls++;throw Error('not allowed')};const b=await body();assert.equal((await approve(b)).status,409);assert.equal(calls,0);assert.equal(referenceTransmissionAllowed(),false);
});
test('actual pinned SDK sends one allowlisted edits multipart with three ordered exact reference PNGs',async()=>{
 setBrowserKey(key);setReferenceTransmissionConsent(true);const b=await body(3);
 // Different valid image bytes prove multipart ordering, without any file name.
 for(let i=0;i<3;i++){const bytes=pngPixel(100+i);b.referenceInputs[i]=await ref(bytes)}
 let calls=0;globalThis.fetch=async(url,options)=>{calls++;assert.equal(String(url),'https://api.openai.com/v1/images/edits');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.ok(options.body instanceof FormData);const form=options.body;assert.equal(form.get('model'),STUDIO_MODEL);assert.equal(form.get('quality'),'low');assert.equal(form.get('output_format'),'png');assert.equal(form.get('n'),'1');const images=[...form.values()].filter(v=>v instanceof Blob);assert.equal(images.length,3);for(let i=0;i<3;i++){assert.deepEqual(new Uint8Array(await images[i].arrayBuffer()),Uint8Array.from(Buffer.from(b.referenceInputs[i].dataBase64,'base64')));assert.ok(!images[i].name?.includes('private'))}return Response.json({data:[{b64_json:Buffer.from(png).toString('base64')}]})};
 const init=await approved(b);assert.equal((await(await request('/images/generate',init)).json()).outcome,'DEFINITIVE_SUCCESS');assert.equal(calls,1);assert.equal((await request('/images/generate',init)).status,409);assert.equal(calls,1);assert.ok(!JSON.stringify([...storage]).includes(b.referenceInputs[0].dataBase64));
});
test('strict automatic sends JSON generations without images and reference payload cannot ride legacy or strict paths',async()=>{
 setBrowserKey(key);let calls=0;globalThis.fetch=async(url,options)=>{calls++;assert.equal(String(url),'https://api.openai.com/v1/images/generations');const sent=JSON.parse(options.body);assert.ok(!JSON.stringify(sent).includes('dataBase64'));assert.equal(sent.image,undefined);return Response.json({data:[{b64_json:Buffer.from(png).toString('base64')}]})};
 const b=await body(1,'STRICT');assert.equal((await request('/images/generate',await approved(b))).status,200);assert.equal(calls,1);
 for(const mode of ['STRICT',undefined]){const bad=await body(1,'STRICT');bad.automaticMode=mode;bad.referenceInputs=[await ref()];assert.equal((await approve(bad)).status,409)}assert.equal(calls,1);
});
test('URL inputs, wrong hash/dimensions, too many references and old text-only estimate fail closed',async()=>{
 setBrowserKey(key);setReferenceTransmissionConsent(true);let calls=0;globalThis.fetch=async()=>{calls++;throw Error()};
 for(const alter of [b=>b.referenceInputs[0].dataBase64='https://example.com/private.png',b=>b.referenceInputs[0].sha256='0'.repeat(64),b=>b.referenceInputs[0].width=2,b=>b.referenceInputs[0].width=2048,b=>b.referenceInputs[0].filename='private.png',b=>b.referenceInputs.push(...b.referenceInputs,...b.referenceInputs,...b.referenceInputs),b=>b.estimatedUSD=automaticEstimateUSD('studio','STRICT'),b=>b.endpoint='https://example.com']){const b=await body();alter(b);const result=await approve(b);if(b.endpoint)assert.equal(result.status,409);else assert.equal(result.status,409)}assert.equal(calls,0);
});
test('approval binds exact content, mode, count and order; consent revoke/re-enable invalidates prior approval',async()=>{
 setBrowserKey(key);setReferenceTransmissionConsent(true);let calls=0;globalThis.fetch=async()=>{calls++;throw Error()};const b=await body(),init=await approved(b);setReferenceTransmissionConsent(false);setReferenceTransmissionConsent(true);assert.equal((await request('/images/generate',init)).status,409);assert.equal(calls,0);
 const next=await body(),nextInit=await approved(next);next.referenceInputs[0].sha256='0'.repeat(64);nextInit.body=JSON.stringify(next);assert.equal((await request('/images/generate',nextInit)).status,409);assert.equal(calls,0);
});
test('key clear during asynchronous reference hash validation cannot regain authorization',async()=>{
 setBrowserKey(key);setReferenceTransmissionConsent(true);const b=await body(),digest=crypto.subtle.digest.bind(crypto.subtle);let release,started;const waiting=new Promise(r=>started=r);crypto.subtle.digest=async(...args)=>{started();await new Promise(r=>release=r);return digest(...args)};
 try{const pending=approve(b);await waiting;clearBrowserKey();setBrowserKey(key);setReferenceTransmissionConsent(true);release();assert.equal((await pending).status,409)}finally{crypto.subtle.digest=digest}
});
test('consent revoked while waiting on dispatch lock prevents SDK transmission',async()=>{
 setBrowserKey(key);setReferenceTransmissionConsent(true);const b=await body(),init=await approved(b);let enter,waiting;const acquired=new Promise(r=>waiting=r);locks.request=async(_name,fn)=>{waiting();await new Promise(r=>enter=r);return fn()};let calls=0;globalThis.fetch=async()=>{calls++;throw Error()};const pending=request('/images/generate',init);await acquired;setReferenceTransmissionConsent(false);setReferenceTransmissionConsent(true);enter();assert.equal((await pending).status,409);assert.equal(calls,0);
});
test('reference request ambiguous network failure is UNKNOWN with no retry or resend',async()=>{
 setBrowserKey(key);setReferenceTransmissionConsent(true);let calls=0;globalThis.fetch=async()=>{calls++;throw Error(key)};const b=await body(),init=await approved(b);const result=await(await request('/images/generate',init)).json();assert.equal(result.error.outcome,'UNKNOWN');assert.equal(calls,1);assert.equal((await request('/images/generate',init)).status,409);assert.equal((await approve(await body())).status,409);assert.equal(calls,1);assert.ok(!JSON.stringify(result).includes(key));
});
test('revoking reference consent aborts in-flight image request and preserves unknown charge',async()=>{
 setBrowserKey(key);setReferenceTransmissionConsent(true);let started;const sent=new Promise(r=>started=r);globalThis.fetch=async(_url,options)=>{started();return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('stopped')),{once:true}))};const b=await body(),pending=request('/images/generate',await approved(b));await sent;setReferenceTransmissionConsent(false);assert.equal((await(await pending).json()).error.outcome,'UNKNOWN');assert.equal(referenceTransmissionAllowed(),false);
});
test('metadata stripping removes text chunks and input allowance scales per reference',async()=>{
 const data=Buffer.from('private-filename-and-location'),chunk=Buffer.alloc(data.length+12);chunk.writeUInt32BE(data.length);chunk.write('tEXt',4);data.copy(chunk,8);let crc=0xffffffff;for(const byte of chunk.subarray(4,-4)){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}chunk.writeUInt32BE((crc^0xffffffff)>>>0,chunk.length-4);const annotated=Uint8Array.from(Buffer.concat([Buffer.from(png.subarray(0,33)),chunk,Buffer.from(png.subarray(33))]));assert.deepEqual(stripPngMetadata(annotated),png);const annotatedRef=await ref(annotated);await assert.rejects(()=>validateAutomaticReferences([annotatedRef]));
 assert.equal(Math.round((Number(automaticEstimateUSD('studio','REFERENCE',3))-Number(automaticEstimateUSD('studio','REFERENCE',1)))*1e6),131072);assert.equal(automaticEstimateUSD('macro','REFERENCE',3),'0.000000');for(const style of ['studio','hero','lifestyle','flat_lay','ugc','billboard']){const prompt=automaticPrompt(style);assert.ok(prompt.includes(`y=${AUTOMATIC_LAYOUTS[style].bottom}`));if(style==='billboard')assert.match(prompt,/WHOLE.*advertisement.*No billboard/)}assert.match(automaticPrompt('flat_lay'),/no unsupported overhead/);
});

test('corrupt normalized PNG and extra endpoint cannot be approved even with recomputed content hash',async()=>{
 setBrowserKey(key);setReferenceTransmissionConsent(true);const damaged=png.slice();damaged[damaged.length-1]^=1;const b=await body();b.referenceInputs=[await ref(damaged)];assert.equal((await approve(b)).status,409);const next=await body();next.endpoint='https://api.openai.com/v1/images/generations';assert.equal((await approve(next)).status,409);
});
