import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'vite';
import {ZipReader,Uint8ArrayReader,TextWriter} from '@zip.js/zip.js/lib/zip-core-native.js';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const chrome = process.env.CHROME_BIN || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find(existsSync);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let lastCheckpoint = "initialization";
async function until(read, description, attempts = 150) {
  lastCheckpoint = description;
  for (let i = 0; i < attempts; i++) {
    const result = await read();
    if (result) return result;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function connect(url, { timeoutMs = 20000, socketFactory = (address) => new WebSocket(address) } = {}) {
  const socket = socketFactory(url), pending = new Map(), events = []; let next = 0;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('DevTools connection timed out.')); }, timeoutMs);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', (error) => { clearTimeout(timer); reject(error); }, { once: true });
  });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data), handler = pending.get(message.id);
    if (!handler) { if (['Runtime.consoleAPICalled','Runtime.exceptionThrown','Log.entryAdded','Page.downloadWillBegin','Page.downloadProgress'].includes(message.method)) events.push(message); return; }
    pending.delete(message.id);
    message.error ? handler.reject(new Error(message.error.message)) : handler.resolve(message.result);
  });
  socket.addEventListener('close', () => { for (const entry of pending.values()) entry.reject(new Error('DevTools connection closed.')); pending.clear(); });
  return {
    events,
    call(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++next;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`DevTools ${method} timed out after ${lastCheckpoint}.`)); }, timeoutMs);
        pending.set(id, { resolve(value) { clearTimeout(timer); resolve(value); }, reject(error) { clearTimeout(timer); reject(error); } });
        try { socket.send(JSON.stringify({ id, method, params })); }
        catch (error) { pending.delete(id); clearTimeout(timer); reject(error); }
      });
    },
    close() { socket.close(); },
  };
}

async function stopBrowser(browser) {
  if (!browser || browser.exitCode !== null || browser.signalCode !== null) return;
  await new Promise(resolve => {
    const finish = () => { clearTimeout(timer); browser.removeListener('exit', finish); resolve(); };
    const timer = setTimeout(() => { browser.kill('SIGKILL'); finish(); }, 5000);
    browser.once('exit', finish);
    browser.kill();
    if (browser.exitCode !== null || browser.signalCode !== null) finish();
  });
}

async function evaluate(client, expression) {
  const response = await client.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  return response.result.value;
}

test('Reference mode requires transmission consent, normalizes ordered views, preserves original and supports single-image editing', {timeout:180000}, async()=>{
 const root=await mkdtemp(join(tmpdir(),'studio-pages-')),out=join(root,'dist'),profile=join(root,'profile'),base='/PWA-AI-Product-Image-Studio-BYOK/';
 let server,browser,tab; const requests=[];
 try{
  await build({root:appRoot,configFile:join(appRoot,'vite.config.ts'),mode:'pages',base,logLevel:'silent',build:{outDir:out}}); await mkdir(profile);
  const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
  server=createServer(async(req,res)=>{requests.push(req.url);try{const path=new URL(req.url,'http://localhost').pathname;assert.ok(path.startsWith(base));const name=path.slice(base.length)||'index.html';assert.ok(!name.includes('..'));const bytes=await readFile(join(out,name));res.writeHead(200,{'content-type':types[extname(name)]||'application/octet-stream','cache-control':'no-store'});res.end(bytes)}catch{res.writeHead(404);res.end()}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); const origin=`http://127.0.0.1:${server.address().port}`,url=`${origin}${base}#/settings`;
  browser=spawn(chrome,['--headless=new',...(process.platform==='linux'?['--no-sandbox','--disable-dev-shm-usage']:[]),'--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--disable-background-networking','about:blank'],{stdio:['ignore','ignore','pipe']});
  let chromeDiagnostics='';browser.stderr.on('data',chunk=>{chromeDiagnostics=(chromeDiagnostics+chunk.toString()).slice(-4000);});browser.on('error',error=>{chromeDiagnostics=error.message;});
  const port=await until(async()=>{try{return Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0])}catch{if(browser.exitCode!==null)throw new Error(`Chrome startup failed (${browser.exitCode}): ${chromeDiagnostics}`);return null}},'Chrome');
  const list=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();tab=await connect(list.find(x=>x.type==='page').webSocketDebuggerUrl);
  await tab.call('Page.enable');await tab.call('Runtime.enable');await tab.call('Page.navigate',{url});

  await until(()=>evaluate(tab,`!!document.querySelector('input[type=password]')&&!document.querySelector('input[type=password]').disabled`),'key settings');
  await evaluate(tab,`(()=>{const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;for(const [selector,value] of [['input[type=password]','sk-synthetic-reference-browser-only'],['input[type=number]','5.00']]){const e=document.querySelector(selector);set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}))}document.querySelector('form input[type=checkbox]').click()})()`);
  await until(()=>evaluate(tab,`!document.querySelector('form button[type=submit]').disabled`),'authorized setup form');
  await evaluate(tab,`document.querySelector('form button[type=submit]').click()`);
  await until(()=>evaluate(tab,`document.body.innerText.includes('Key available in this tab')`),'key/session set');
  await evaluate(tab,`location.hash='#/'`);
  await until(()=>evaluate(tab,`!!document.querySelector('input[name=automatic-mode]')`),'mode control');
  assert.equal(await evaluate(tab,`document.querySelector('input[name=automatic-mode]').checked`),true,'STRICT stays default');
  await evaluate(tab,`document.querySelectorAll('input[name=automatic-mode]')[1].click()`);
  await until(()=>evaluate(tab,`document.body.innerText.includes('Reference-guided concepts can change')`),'reference mode explanation');
  assert.equal(await evaluate(tab,`document.querySelector('input[aria-label="Upload product image"]').disabled`),true,'Reference mode cannot start before separate consent');
  await evaluate(tab,`window.__referenceRequests=[];window.__blockedRequests=[];window.__fetch=window.fetch;window.fetch=async(url,options)=>{if(String(url).startsWith('https:')){if(String(url)!=='https://api.openai.com/v1/images/edits'){window.__blockedRequests.push(String(url));throw Error('unexpected remote request')}const form=options.body;if(!(form instanceof FormData))throw Error('expected SDK multipart');const files=[...form.values()].filter(v=>v instanceof Blob);const refs=[];for(const file of files){const bytes=new Uint8Array(await file.arrayBuffer()),view=new DataView(bytes.buffer);let at=8,types=[];while(at+12<=bytes.length){const n=view.getUint32(at),type=String.fromCharCode(...bytes.slice(at+4,at+8));types.push(type);at+=n+12}refs.push({width:view.getUint32(16),height:view.getUint32(20),types,name:file.name,size:file.size,hash:[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('')})}window.__referenceRequests.push({refs,prompt:form.get('prompt'),quality:form.get('quality'),n:form.get('n')});const c=document.createElement('canvas');c.width=c.height=1024;const ctx=c.getContext('2d');ctx.fillStyle='#e0d6c0';ctx.fillRect(0,0,1024,1024);ctx.fillStyle='#663399';ctx.fillRect(360,200,300,620);return Response.json({data:[{b64_json:c.toDataURL('image/png').split(',')[1]}]})}return window.__fetch(url,options)};window.__makeFile=async(name,w,h,color)=>{const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d');ctx.fillStyle=color;ctx.fillRect(w*.2,h*.15,w*.6,h*.7);return new File([await new Promise(r=>c.toBlob(r,'image/png'))],name,{type:'image/png'})};window.__sendPrimary=async()=>{const d=new DataTransfer();d.items.add(await window.__makeFile('private-primary.png',2000,1200,'#aa3311'));const f=document.querySelector('input[aria-label="Upload product image"]');f.files=d.files;f.dispatchEvent(new Event('change',{bubbles:true}))}`);
  await evaluate(tab,`window.__sendPrimary()`);await delay(100);
  assert.equal(await evaluate(tab,`window.__referenceRequests.length`),0,'Consent denial sends no photo');
  await evaluate(tab,`document.querySelector('.automatic-options input[type=checkbox]').click();document.querySelector('.automatic-options details').open=true`);
  await evaluate(tab,`(async()=>{const d=new DataTransfer();d.items.add(await window.__makeFile('private-side-view.png',1600,1000,'#00aa55'));d.items.add(await window.__makeFile('private-back-view.png',800,1600,'#2244bb'));const f=document.querySelector('#additional-reference-images');f.files=d.files;f.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await until(()=>evaluate(tab,`document.querySelector('.automatic-options').innerText.includes('private-back-view.png')`),'selected view filenames visible locally');
  for(const width of [320,390,1280]){await tab.call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<500});assert.equal(await evaluate(tab,'document.documentElement.scrollWidth<=innerWidth'),true,`Reference mode fits at ${width}`)}
  if(process.env.STUDIO_REFERENCE_SCREENSHOT){const shot=await tab.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(`${process.env.STUDIO_REFERENCE_SCREENSHOT}-controls.png`,Buffer.from(shot.data,'base64'))}
  await evaluate(tab,`window.__sendPrimary()`);
  await until(()=>evaluate(tab,`document.querySelector('#auto-results-heading')?.textContent==='7 of 7 ready'&&!document.querySelector('.auto-upload.processing')`),'three-reference complete output');
  const reqs=await evaluate(tab,`window.__referenceRequests`);assert.equal(reqs.length,6);for(const request of reqs){assert.equal(request.refs.length,3);assert.deepEqual(request.refs.map(r=>[r.width,r.height]),[[1024,614],[1024,640],[512,1024]]);assert.equal(new Set(request.refs.map(r=>r.hash)).size,3);for(const ref of request.refs){assert.ok(ref.types.every(t=>['IHDR','IDAT','IEND'].includes(t)));assert.ok(ref.size<=5*1024*1024);assert.ok(!ref.name.includes('private'))}assert.equal(request.n,'1');assert.equal(request.quality,'low');assert.ok(!request.prompt.includes('private-'))}assert.deepEqual(await evaluate(tab,'window.__blockedRequests'),[]);
  const saved=await evaluate(tab,`(async()=>{const r=indexedDB.open('image-studio-automatic',2),db=await new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});try{const rows=await new Promise(resolve=>{const q=db.transaction('runs').objectStore('runs').getAll();q.onsuccess=()=>resolve(q.result)}),run=rows[0];return {mode:run.mode,refs:run.referenceImages,originalHash:[...new Uint8Array(await crypto.subtle.digest('SHA-256',await run.source.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join(''),sourceHash:run.sourceSha256,items:run.items.map(i=>({style:i.style,operation:i.provenance?.operation,visual:i.qa?.visualAssessment,roi:i.provenance?.detailRoi}))}}finally{db.close()}})()`);
  assert.equal(saved.mode,'REFERENCE');assert.equal(saved.originalHash,saved.sourceHash);assert.equal(saved.refs.length,3);assert.equal(saved.items.filter(i=>i.operation==='reference-edit').length,6);assert.ok(saved.items.every(i=>i.visual==='NOT_ASSESSED'));assert.equal(saved.items.find(i=>i.style==='macro').roi.width,saved.items.find(i=>i.style==='macro').roi.height);
  assert.ok(await evaluate(tab,`document.querySelector('.auto-results').innerText.includes('Reference-guided concepts may change')`));
  for(const width of [390,1280]){await tab.call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<500});assert.equal(await evaluate(tab,'document.documentElement.scrollWidth<=innerWidth'),true);if(process.env.STUDIO_REFERENCE_SCREENSHOT){const shot=await tab.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(`${process.env.STUDIO_REFERENCE_SCREENSHOT}-results-${width}.png`,Buffer.from(shot.data,'base64'))}}
  await evaluate(tab,`[...document.querySelectorAll('button')].find(b=>b.textContent==='Clear additional views').click()`);
  await evaluate(tab,`window.__sendPrimary()`);
  await until(()=>evaluate(tab,`window.__referenceRequests.length===12&&document.querySelector('#auto-results-heading')?.textContent==='7 of 7 ready'&&!document.querySelector('.auto-upload.processing')`),'single-reference complete output');
  assert.ok((await evaluate(tab,`window.__referenceRequests.slice(6)`)).every(r=>r.refs.length===1));
  await evaluate(tab,`(()=>{const prior=window.fetch;window.__badOutputCalls=0;window.fetch=async(url,options)=>{if(String(url)==='https://api.openai.com/v1/images/edits'&&window.__badOutputCalls++===0){const c=document.createElement('canvas');c.width=c.height=1024;const binary=atob(c.toDataURL('image/png').split(',')[1]),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0)),view=new DataView(bytes.buffer);let at=8;while(at+12<=bytes.length){const n=view.getUint32(at),type=String.fromCharCode(...bytes.slice(at+4,at+8));if(type==='IDAT'){bytes[at+8]^=255;break}at+=n+12}return Response.json({data:[{b64_json:btoa(String.fromCharCode(...bytes))}]})}return prior(url,options)}})()`);
  await evaluate(tab,`window.__sendPrimary()`);
  await until(()=>evaluate(tab,`document.querySelector('#auto-results-heading')?.textContent==='6 of 7 ready'&&!document.querySelector('.auto-upload.processing')`),'corrupt provider PNG excluded');
  assert.equal(await evaluate(tab,`!!document.querySelector('[aria-label="Studio result"] img')`),false,'A plausible PNG header cannot bypass real reference output decoding');
  assert.equal(await evaluate(tab,`document.querySelector('[aria-label="Studio result"] button')===null`),true,'Corrupt reference image has no download action');
  await evaluate(tab,`(()=>{const prior=window.fetch;window.__unknownCalls=0;window.fetch=(url,options)=>{if(String(url)==='https://api.openai.com/v1/images/edits'){window.__unknownCalls++;return Promise.reject(Error('Synthetic unreadable image response'))}return prior(url,options)}})()`);
  await evaluate(tab,`window.__sendPrimary()`);
  await until(()=>evaluate(tab,`document.querySelector('#auto-results-heading')?.textContent==='1 of 7 ready'&&document.querySelector('.auto-results')?.innerText.includes('unknown')`),'reference unknown keeps local detail');
  assert.equal(await evaluate(tab,`window.__unknownCalls`),1);assert.equal(await evaluate(tab,`document.querySelector('input[aria-label="Upload product image"]').disabled`),true);
  await delay(150);assert.equal(await evaluate(tab,`window.__unknownCalls`),1,'Unknown reference attempt is never retried');
  await tab.call('Page.reload');await until(()=>evaluate(tab,`!!document.querySelector('input[name=automatic-mode]')`),'reload mode');
  assert.equal(await evaluate(tab,`document.querySelector('input[name=automatic-mode]').checked`),true);
  await evaluate(tab,`document.querySelectorAll('input[name=automatic-mode]')[1].click()`);
  assert.equal(await evaluate(tab,`document.querySelector('.automatic-options input[type=checkbox]').checked`),false,'Reload never restores photo-transmission consent');
  assert.equal(await evaluate(tab,`document.querySelector('input[aria-label="Upload product image"]').disabled`),true);
 }catch(error){console.error('Pages journey failure:',error);throw error;}finally{tab?.close();await stopBrowser(browser);if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100})}
});
