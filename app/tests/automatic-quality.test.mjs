import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB} from 'fake-indexeddb';
import {createServer} from 'vite';
import {AUTOMATIC_LAYOUTS, automaticPrompt} from '../automatic-policy.mjs';
globalThis.window=new EventTarget();globalThis.indexedDB=indexedDB;
const server=await createServer({root:new URL('..',import.meta.url).pathname,server:{middlewareMode:true},appType:'custom'});
after(()=>server.close());
const imaging=await server.ssrLoadModule('/src/autoImaging.ts');
test('visible detail ROI is a strict subcrop centered on measured opaque pixels, never whole asset',()=>{
 const width=100,height=80,alpha=new Float32Array(width*height);for(let y=15;y<65;y++)for(let x=20;x<80;x++)if(x<40||x>60)alpha[y*width+x]=1;
 const crop={x:18,y:13,width:64,height:54},roi=imaging.chooseDetailRegion(alpha,width,height,crop);
 assert.ok(roi.width<crop.width&&roi.height<crop.height);assert.equal(roi.width,roi.height,"Detail ROI is square to fill the output without dominant padding");assert.ok(roi.x>=0&&roi.y>=0&&roi.x+roi.width<=crop.width&&roi.y+roi.height<=crop.height);
 const cx=Math.floor(crop.x+roi.x+roi.width/2),cy=Math.floor(crop.y+roi.y+roi.height/2);assert.ok(alpha[cy*width+cx]>.5,'ROI focuses on visible foreground, even with transparent center');
 const evidence=imaging.automaticCompositionEvidence({detailRegion:roi,sourceBounds:crop},'macro');assert.deepEqual(evidence.detailRoi,{x:crop.x+roi.x,y:crop.y+roi.y,width:roi.width,height:roi.height});assert.equal(evidence.detailUpscaled,true);assert.equal(evidence.visualAssessment,'NOT_ASSESSED');
});
test('all shared visible-contact anchors appear in corresponding prompts, with distinct style layouts',()=>{
 const anchors=new Set();for(const style of ['studio','hero','lifestyle','flat_lay','ugc','billboard']){const spec=AUTOMATIC_LAYOUTS[style],prompt=automaticPrompt(style);assert.ok(prompt.includes(`x=${spec.centerX}`));assert.ok(prompt.includes(`y=${spec.bottom}`));assert.ok(prompt.includes(spec.surface));anchors.add(JSON.stringify([spec.maxWidth,spec.maxHeight,spec.centerX,spec.bottom]));assert.ok(spec.bottom>=spec.maxHeight);assert.equal(imaging.automaticCompositionEvidence({},style).visualAssessment,'NOT_ASSESSED')}assert.equal(anchors.size,6);
 const evidence=imaging.automaticCompositionEvidence({},'billboard');assert.equal(evidence.artworkLayer,'local-full-text-free-ad-v1');assert.match(automaticPrompt('billboard'),/No billboard, display, frame/);
});
test('automatic database upgrades preserve legacy runs while old binaries fail closed on new reference records',async()=>{
 const legacy={version:1,id:crypto.randomUUID(),createdAt:'2026-11-11T00:00:00Z',filename:'legacy.png',source:new Blob(['original']),sourceSha256:'a'.repeat(64),state:'COMPLETE',items:[],estimatedUSD:'0.010000',sessionId:''};
 let legacyConnection;
 await new Promise((resolve,reject)=>{const req=indexedDB.open('image-studio-automatic',1);req.onupgradeneeded=()=>req.result.createObjectStore('runs',{keyPath:'id'});req.onerror=()=>reject(req.error);req.onsuccess=()=>{const db=req.result;legacyConnection=db;const tx=db.transaction('runs','readwrite');tx.objectStore('runs').put(legacy);tx.oncomplete=()=>resolve()}});
 const store=await server.ssrLoadModule('/src/automaticStore.ts');
 await assert.rejects(()=>store.listAutoRuns(),/Close other app tabs/);legacyConnection.close();
 let runs=await store.listAutoRuns();assert.equal(runs.length,1);assert.equal(runs[0].mode,undefined);assert.equal(await runs[0].source.text(),'original');
 await store.saveAutoRun({...legacy,id:crypto.randomUUID(),mode:'REFERENCE',referenceImages:[{sha256:'b'.repeat(64),width:1024,height:768,mimeType:'image/png'}]});runs=await store.listAutoRuns();assert.equal(runs.length,2);assert.equal(runs.filter(r=>r.mode==='REFERENCE').length,1);
 await assert.rejects(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('image-studio-automatic',1);r.onerror=()=>reject(r.error);r.onsuccess=()=>{r.result.close();resolve()}}),error=>error.name==='VersionError');
 assert.equal((await store.listAutoRuns()).length,2);
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Late rejected open leaked its connection')),1000),r=indexedDB.open('image-studio-automatic',3);r.onsuccess=()=>{clearTimeout(timer);r.result.close();resolve()};r.onerror=()=>{clearTimeout(timer);reject(r.error)}});
});

test('reference output decoder rejects undecodable images and closes decoded wrong-size bitmaps',async()=>{
 const original=globalThis.createImageBitmap,signal=new AbortController().signal;
 try {
   globalThis.createImageBitmap=async()=>{throw Error('Invalid PNG data')};await assert.rejects(()=>imaging.validateAutomaticDecodedImage(new Blob(['bad']),signal),/Invalid PNG/);
   let closed=false;globalThis.createImageBitmap=async()=>({width:1,height:1,close:()=>closed=true});await assert.rejects(()=>imaging.validateAutomaticDecodedImage(new Blob(),signal),/dimensions/);assert.equal(closed,true);
   closed=false;globalThis.createImageBitmap=async()=>({width:1024,height:1024,close:()=>closed=true});await imaging.validateAutomaticDecodedImage(new Blob(),signal);assert.equal(closed,true);
 } finally {globalThis.createImageBitmap=original}
});
