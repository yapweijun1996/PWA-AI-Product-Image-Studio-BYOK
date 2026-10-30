import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'vite';
import { createGateway } from '../../gateway.mjs';
import { ZipReader, Uint8ArrayReader, Uint8ArrayWriter } from '@zip.js/zip.js/lib/zip-core-native.js';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const chrome = process.env.CHROME_BIN || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find(existsSync);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(read, description) {
  for (let i = 0; i < 150; i++) {
    const result = await read();
    if (result) return result;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function connect(url) {
  const socket = new WebSocket(url), pending = new Map(), events = []; let next = 0;
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data), handler = pending.get(message.id);
    if (!handler) { if (['Runtime.consoleAPICalled','Runtime.exceptionThrown','Log.entryAdded'].includes(message.method)) events.push(message); return; }
    pending.delete(message.id);
    message.error ? handler.reject(new Error(message.error.message)) : handler.resolve(message.result);
  });
  socket.addEventListener('close', () => { for (const entry of pending.values()) entry.reject(new Error('DevTools connection closed.')); pending.clear(); });
  return {
    events,
    call(method, params = {}) {
      return new Promise((resolve, reject) => { const id = ++next; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
    },
    close() { socket.close(); },
  };
}

async function evaluate(client, expression) {
  const response = await client.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  return response.result.value;
}

test('production gateway serves a synthetic creation-to-export journey without origin rewriting', {timeout: 90000}, async () => {
  assert.ok(chrome && existsSync(chrome), 'Set CHROME_BIN to a Chromium executable.');
  const root=await mkdtemp(join(tmpdir(),'studio-direct-browser-'));
  const web=join(root,'web'),journal=join(root,'journal'),profile=join(root,'profile');
  await mkdir(journal,{mode:0o700});await mkdir(profile);
  let gateway,browser,client,browserClient,restoreClient;let providerCalls=0,providerImage='', failNext=false;const providerPrompts=[];
  const token=randomBytes(32).toString('base64url');
  try {
    await build({root:appRoot,configFile:join(appRoot,'vite.config.ts'),logLevel:'silent',build:{outDir:web,emptyOutDir:true}});
    gateway=await createGateway({authTokenHash:createHash('sha256').update(token).digest('hex'),providerConfigured:true,staticDirectory:web,imageGeneration:{enabled:true,apiKey:'synthetic-provider-fixture',journalDirectory:journal,transport:async(_url,request)=>{providerCalls++;providerPrompts.push(JSON.parse(request.body).prompt);if(failNext){failNext=false;throw new Error('synthetic-provider-fixture');}return new Response(JSON.stringify({data:[{b64_json:providerImage}]}),{status:200,headers:{'content-type':'application/json'}});}}});
    await new Promise((resolve,reject)=>{gateway.once('error',reject);gateway.listen(0,'127.0.0.1',resolve)});
    const origin=`http://127.0.0.1:${gateway.address().port}`;
    const crossOrigin=await fetch(`${origin}/api/v2/auth/login`,{method:'POST',headers:{'content-type':'application/json',origin:'http://untrusted.invalid'},body:JSON.stringify({token})});
    assert.equal(crossOrigin.status,403,'A different origin cannot sign in.');assert.equal(providerCalls,0);

    browser=spawn(chrome,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-networking','about:blank'],{stdio:'ignore'});
    const port=await until(async()=>{try{return Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);}catch{return null}},'isolated Chromium');
    const target=(await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(x=>x.type==='page');
    client=await connect(target.webSocketDebuggerUrl);await client.call('Runtime.enable');await client.call('Log.enable');await client.call('Page.enable');await client.call('Page.bringToFront');
    await client.call('Emulation.setDeviceMetricsOverride',{width:320,height:800,deviceScaleFactor:1,mobile:true});
    await client.call('Page.navigate',{url:origin});await until(()=>evaluate(client,`location.origin===${JSON.stringify(origin)} && document.readyState==='complete'`),'app load');
    await evaluate(client, `console.info('studio-log-capture-probe')`);
    await until(()=>client.events.some(e=>e.method==='Runtime.consoleAPICalled'&&JSON.stringify(e).includes('studio-log-capture-probe')),'console capture');
    providerImage=await evaluate(client,`(() => {const c=document.createElement('canvas');c.width=1024;c.height=1024;const x=c.getContext('2d');x.fillStyle='#225588';x.fillRect(0,0,1024,1024);return c.toDataURL('image/png').split(',')[1]})()`);
    await until(()=>evaluate(client, `!!navigator.serviceWorker.controller`),'active service worker');
    const cachedRoutes=await evaluate(client, `(async()=>{const out=[];for(const name of await caches.keys())for(const request of await (await caches.open(name)).keys())out.push(new URL(request.url).pathname);return out;})()`);
    assert.ok(cachedRoutes.some(path=>/\/assets\/ProductDetails-.*\.js$/.test(path)),'The lazy product page is cached before offline use.');
    assert.equal(await evaluate(client, `performance.getEntriesByType('resource').some(e=>e.name.includes('/assets/ProductDetails-'))`),false,'The workspace has not loaded the product page module.');
    await client.call('Network.enable');await client.call('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
    await until(()=>evaluate(client, `!navigator.onLine`),'offline state');
    await until(()=>evaluate(client,`[...document.querySelectorAll('a')].some(a=>a.textContent==='Create product')`),'product creation link');
    await evaluate(client,`[...document.querySelectorAll('a')].find(a=>a.textContent==='Create product').click()`);
    await until(()=>evaluate(client,`!!document.querySelector('#product-sku')`),'product form');
    await evaluate(client,`(() => {const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;for(const [id,value] of [['product-sku',crypto.randomUUID()],['product-name','Synthetic direct gateway test'],['product-category','Test']]){const e=document.getElementById(id);set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}))}document.querySelector('.form-card input[type="checkbox"]').click();document.querySelector('.form-card button[type="submit"]').click()})()`);
    const productId=await until(()=>evaluate(client,`location.pathname.startsWith('/products/') && location.pathname!=='/products/new' && location.pathname.split('/')[2]`),'created product');
    await until(()=>evaluate(client,`!!document.querySelector('#source-file')`),'source upload');
    const sourceHash=await evaluate(client,`(async()=>{const c=document.createElement('canvas');c.width=200;c.height=100;const x=c.getContext('2d');x.fillStyle='#a31';x.fillRect(0,0,200,100);const blob=await new Promise(r=>c.toBlob(r,'image/png'));const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('');const d=new DataTransfer();d.items.add(new File([blob],'synthetic.png',{type:'image/png'}));const f=document.querySelector('#source-file');f.files=d.files;f.dispatchEvent(new Event('change',{bubbles:true}));return hash})()`);
    await until(()=>evaluate(client,`!!document.querySelector('#camera-view')`),'source preview');
    await evaluate(client,`(() => {const e=document.querySelector('#camera-view');e.value='FRONT';e.dispatchEvent(new Event('change',{bubbles:true}));[...document.querySelectorAll('.source-panel button')].find(b=>b.textContent==='Save original').click()})()`);
    await until(()=>evaluate(client,`document.querySelector('#mask-source')?.options.length>1`),'saved source');
    await evaluate(client,`(() => {const s=document.querySelector('#mask-source');s.value=s.options[1].value;s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await until(()=>evaluate(client,`document.querySelector('.mask-regions')&&!document.querySelector('.mask-regions').disabled`),'mask editor');
    await evaluate(client,`[...document.querySelectorAll('.mask-regions button')].find(b=>b.textContent==='Add protected area').click()`);
    await until(()=>evaluate(client,`document.querySelectorAll('.mask-region').length===1`),'protected region');
    await evaluate(client,`[...document.querySelectorAll('.mask-editor button')].find(b=>b.textContent==='Review mask').click()`);
    await until(()=>evaluate(client,`[...document.querySelectorAll('.mask-editor button')].some(b=>b.textContent==='Save mask')`),'mask review');
    await evaluate(client,`[...document.querySelectorAll('.mask-editor button')].find(b=>b.textContent==='Save mask').click()`);
    await until(()=>evaluate(client,`document.querySelector('.mask-editor')?.innerText.includes('Mask saved')`),'saved mask');
    await client.call('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
    await until(()=>evaluate(client, `navigator.onLine`),'online state');
    await client.call('Page.navigate',{url:`${origin}/settings`});
    await until(()=>evaluate(client,`!!document.querySelector('#local-access-token')`),'local sign-in');
    await evaluate(client,`(() => {const e=document.querySelector('#local-access-token');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'  sk-synthetic-not-a-key');e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    assert.equal(await evaluate(client,`document.querySelector('#local-access-token').value`),'','A provider-like value with leading whitespace is cleared.');
    assert.match(await evaluate(client,`document.querySelector('.provider-session [role="alert"]').innerText`),/not a local app access token/i);
    assert.equal(await evaluate(client,`document.querySelector('.provider-login button').disabled`),true,'The rejected value cannot be submitted.');
    await evaluate(client,`(() => {const e=document.querySelector('#local-access-token');e.focus();e.blur()})()`);
    await evaluate(client,`(() => {const e=document.querySelector('#local-access-token');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(token)});e.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.provider-login button').click()})()`);
    await until(()=>evaluate(client,`[...document.querySelectorAll('.provider-session button')].some(b=>b.textContent==='Connect provider'&&!b.disabled)`),'provider connect');
    await evaluate(client,`[...document.querySelectorAll('.provider-session button')].find(b=>b.textContent==='Connect provider').click()`);
    await until(()=>evaluate(client,`document.querySelector('.provider-session')?.innerText.includes('Provider authorization active')`),'provider authorization');
    await client.call('Page.navigate',{url:`${origin}/products/${productId}`});
    await until(()=>evaluate(client,`[...document.querySelectorAll('.style-plan label')].some(l=>l.innerText.includes('I authorize this single Studio attempt')&&!l.querySelector('input').disabled)`),'generation authorization');
    assert.equal(providerCalls,0);assert.equal(await evaluate(client,`[...document.querySelectorAll('.studio-panel button')].find(b=>b.textContent==='Authorize and generate selected scenes').disabled`),true);
    await evaluate(client,`[...document.querySelectorAll('.style-plan label')].find(l=>l.innerText.includes('I authorize this single Studio attempt')).querySelector('input').click()`);
    await until(()=>evaluate(client,`![...document.querySelectorAll('.studio-panel button')].find(b=>b.textContent==='Authorize and generate selected scenes').disabled`),'generation ready');
    await evaluate(client,`[...document.querySelectorAll('.studio-panel button')].find(b=>b.textContent==='Authorize and generate selected scenes').click()`);
    await until(()=>evaluate(client,`document.querySelector('.studio-history')?.innerText.includes('Studio · DEFINITIVE_SUCCESS')`),'generated scene');assert.equal(providerCalls,1);
    await until(()=>evaluate(client,`[...document.querySelectorAll('.strict-composite button')].some(b=>b.textContent==='Prepare local composite'&&!b.disabled)`),'composition ready');
    await evaluate(client,`[...document.querySelectorAll('.strict-composite button')].find(b=>b.textContent==='Prepare local composite').click()`);
    await until(()=>evaluate(client,`[...document.querySelectorAll('.strict-composite button')].some(b=>b.textContent==='Save unapproved composite')`),'composite preview');
    await evaluate(client,`[...document.querySelectorAll('.strict-composite button')].find(b=>b.textContent==='Save unapproved composite').click()`);
    await until(()=>evaluate(client,`[...document.querySelectorAll('summary')].some(s=>s.textContent==='Review this composite')`),'saved composite');
    await evaluate(client,`[...document.querySelectorAll('summary')].find(s=>s.textContent==='Review this composite').click()`);
    await until(()=>evaluate(client,`!!document.querySelector('.visual-review form')`),'review form');
    await evaluate(client,`(() => {const f=document.querySelector('.visual-review form'),set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;for(const e of f.querySelectorAll('input[type="number"]')){set.call(e,'5');e.dispatchEvent(new Event('input',{bubbles:true}))}for(const e of f.querySelectorAll('select')){e.value=e.id.startsWith('qa-variant-')?'default':'MATCH';e.dispatchEvent(new Event('change',{bubbles:true}))}})()`);
    await until(()=>evaluate(client,`document.querySelector('.visual-review form')?.innerText.includes('Proposed status: PASS_CANDIDATE')`),'review evaluation');
    await evaluate(client,`[...document.querySelectorAll('.visual-review form label')].find(l=>l.innerText.includes('I personally compared')).querySelector('input').click()`);
    await until(()=>evaluate(client,`![...document.querySelectorAll('.visual-review form button')].find(b=>b.textContent==='Save this human review').disabled`),'review consent');
    await evaluate(client,`[...document.querySelectorAll('.visual-review form button')].find(b=>b.textContent==='Save this human review').click()`);
    await until(()=>evaluate(client,`[...document.querySelectorAll('.visual-review button')].some(b=>b.textContent==='Choose approval'&&!b.disabled)`),'review saved');
    await evaluate(client,`[...document.querySelectorAll('.visual-review button')].find(b=>b.textContent==='Choose approval').click()`);
    await evaluate(client,`[...document.querySelectorAll('.visual-review label')].find(l=>l.innerText.includes('I explicitly approve')).querySelector('input').click()`);
    await until(()=>evaluate(client,`![...document.querySelectorAll('.visual-review button')].find(b=>b.textContent==='Record approved decision').disabled`),'approval consent');
    await evaluate(client,`[...document.querySelectorAll('.visual-review button')].find(b=>b.textContent==='Record approved decision').click()`);
    await until(()=>evaluate(client,`document.querySelector('.visual-review')?.innerText.includes('decision APPROVED')`),'approved composite');
    await client.call('Page.reload');await until(()=>evaluate(client,`document.querySelectorAll('.approved-export fieldset input[type="checkbox"]').length===1`),'export candidate');
    await evaluate(client,`(() => {const p=document.querySelector('.approved-export');p.querySelector('fieldset input').click();[...p.querySelectorAll('button')].find(b=>b.textContent==='Prepare converted previews').click()})()`);
    await until(()=>evaluate(client,`document.querySelector('.approved-export')?.innerText.includes('Inspect converted outputs')`),'converted output');
    await client.call('Page.setDownloadBehavior',{behavior:'allow',downloadPath:root});
    await evaluate(client,`(() => {const p=document.querySelector('.approved-export');[...p.querySelectorAll('label')].find(l=>l.innerText.includes('I inspected every converted output')).querySelector('input').click();[...p.querySelectorAll('button')].find(b=>b.textContent==='Download approved output bundle').click()})()`);
    const filename=await until(async()=>(await readdir(root)).find(n=>n.startsWith('approved-outputs-')&&n.endsWith('.zip')),'downloaded bundle');
    const zip=new ZipReader(new Uint8ArrayReader(await readFile(join(root,filename))));
    try {const entries=await zip.getEntries(),proof=entries.find(e=>e.filename.startsWith('provenance/')&&e.filename.endsWith('.json')),output=entries.find(e=>e.filename.startsWith('outputs/')&&e.filename.endsWith('.png'));assert.ok(proof&&output);const receipt=JSON.parse(new TextDecoder().decode(await proof.getData(new Uint8ArrayWriter()))),bytes=await output.getData(new Uint8ArrayWriter());assert.equal(receipt.sourceSha256,sourceHash);assert.equal(receipt.sceneSha256,createHash('sha256').update(Buffer.from(providerImage,'base64')).digest('hex'));assert.equal(receipt.outputSha256,createHash('sha256').update(bytes).digest('hex'));assert.ok(receipt.reviewId&&receipt.decisionId);
      for(const entry of entries) {if(entry.directory) continue;const content=await entry.getData(new Uint8ArrayWriter());const text=new TextDecoder().decode(content);assert.equal(text.includes(token)||text.includes('synthetic-provider-fixture'),false,'Downloaded ZIP entries must not contain the synthetic credentials.');}}finally{await zip.close()}
    assert.equal(providerCalls,1,'No automatic resend during review or download.');
    failNext=true;
    await until(()=>evaluate(client,`[...document.querySelectorAll('.style-plan label')].some(l=>l.innerText.includes('I authorize this single Studio attempt')&&!l.querySelector('input').disabled)`),'new attempt consent');
    await evaluate(client,`[...document.querySelectorAll('.style-plan label')].find(l=>l.innerText.includes('I authorize this single Studio attempt')).querySelector('input').click()`);
    await until(()=>evaluate(client,`![...document.querySelectorAll('.studio-panel button')].find(b=>b.textContent==='Authorize and generate selected scenes').disabled`),'new attempt ready');
    await evaluate(client,`[...document.querySelectorAll('.studio-panel button')].find(b=>b.textContent==='Authorize and generate selected scenes').click()`);
    await until(()=>evaluate(client,`document.querySelector('.studio-history')?.innerText.includes('Studio · UNKNOWN')`),'unknown outcome');
    assert.equal(providerCalls,2,'An ambiguous response causes no automatic resend.');
    const unknownId=await evaluate(client,`[...document.querySelectorAll('.studio-history li')].find(li=>li.innerText.includes('Studio · UNKNOWN')).innerText.match(/[0-9a-f-]{36}/i)[0]`);
    await client.call('Page.reload');
    await until(()=>evaluate(client,`[...document.querySelectorAll('.studio-history li')].some(li=>li.innerText.includes(${JSON.stringify(unknownId)})&&li.innerText.includes('UNKNOWN'))`),'persisted unknown');
    assert.equal(providerCalls,2,'Reload does not resend an unknown attempt.');
    const unknownSelector=`.studio-history li`;
    assert.equal(await evaluate(client,`[...[...document.querySelectorAll(${JSON.stringify(unknownSelector)})].find(li=>li.innerText.includes(${JSON.stringify(unknownId)})).querySelectorAll('button')].find(b=>b.textContent==='Record review of this attempt').disabled`),true,'Unreviewed uncertainty cannot be acknowledged.');
    await evaluate(client,`(() => {const li=[...document.querySelectorAll('.studio-history li')].find(x=>x.innerText.includes(${JSON.stringify(unknownId)}));[...li.querySelectorAll('label')].find(l=>l.innerText.includes('I have reviewed provider billing')).querySelector('input').click()})()`);
    await until(()=>evaluate(client,`(() => {const li=[...document.querySelectorAll('.studio-history li')].find(x=>x.innerText.includes(${JSON.stringify(unknownId)}));return [...li.querySelectorAll('button')].some(b=>b.textContent==='Record review of this attempt'&&!b.disabled)})()`),'unknown review ready');
    await evaluate(client,`(() => {const li=[...document.querySelectorAll('.studio-history li')].find(x=>x.innerText.includes(${JSON.stringify(unknownId)}));[...li.querySelectorAll('button')].find(b=>b.textContent==='Record review of this attempt').click()})()`);
    await until(()=>evaluate(client,`(() => {const li=[...document.querySelectorAll('.studio-history li')].find(x=>x.innerText.includes(${JSON.stringify(unknownId)}));return li.innerText.includes('Reviewed at')&&[...li.querySelectorAll('button')].some(b=>b.textContent.startsWith('Prepare retry for Studio')&&!b.disabled)})()`),'unknown reviewed');
    assert.equal(providerCalls,2,'Reviewing an unknown attempt does not send a request.');
    await evaluate(client,`(() => {const li=[...document.querySelectorAll('.studio-history li')].find(x=>x.innerText.includes(${JSON.stringify(unknownId)}));[...li.querySelectorAll('button')].find(b=>b.textContent.startsWith('Prepare retry for Studio')).click()})()`);
    await until(()=>evaluate(client,`document.querySelector('.studio-panel')?.innerText.includes('Retry of attempt ${unknownId}')`),'prepared retry');
    assert.equal(providerCalls,2,'Preparing a retry does not send a request.');
    assert.equal(await evaluate(client,`[...document.querySelectorAll('.studio-panel button')].find(b=>b.textContent==='Authorize and generate selected scenes').disabled`),true,'Retry needs fresh consent.');
    await evaluate(client,`[...document.querySelectorAll('.style-plan label')].find(l=>l.innerText.includes('I authorize this single Studio attempt')).querySelector('input').click()`);
    await until(()=>evaluate(client,`![...document.querySelectorAll('.studio-panel button')].find(b=>b.textContent==='Authorize and generate selected scenes').disabled`),'retry consent');
    await evaluate(client,`[...document.querySelectorAll('.studio-panel button')].find(b=>b.textContent==='Authorize and generate selected scenes').click()`);
    await until(()=>evaluate(client,`[...document.querySelectorAll('.studio-history li')].some(li=>li.innerText.includes('Studio · DEFINITIVE_SUCCESS')&&li.innerText.includes('Retry of attempt ${unknownId}'))`),'successful separately authorized retry');
    const retryId=await evaluate(client,`[...document.querySelectorAll('.studio-history li')].find(li=>li.innerText.includes('Studio · DEFINITIVE_SUCCESS')&&li.innerText.includes('Retry of attempt ${unknownId}')).innerText.match(/[0-9a-f-]{36}/i)[0]`);
    assert.notEqual(retryId,unknownId);assert.equal(providerCalls,3,'A separately authorized retry makes exactly one new synthetic request.');
    await evaluate(client,`window.__beforeRetryReload=true`);
    await client.call('Page.reload');
    await until(()=>evaluate(client,`window.__beforeRetryReload!==true && [...document.querySelectorAll('.studio-history li')].some(li=>li.innerText.includes(${JSON.stringify(unknownId)})&&li.innerText.includes('UNKNOWN')&&li.innerText.includes('Reviewed at'))&&[...document.querySelectorAll('.studio-history li')].some(li=>li.innerText.includes(${JSON.stringify(retryId)})&&li.innerText.includes('DEFINITIVE_SUCCESS'))`),'reloaded retry lineage');
    assert.equal(providerCalls,3,'Reload preserves both outcomes without another request.');
    const attemptsBefore=await evaluate(client, `(async()=>{const db=await new Promise((resolve,reject)=>{const q=indexedDB.open('product-image-studio');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)});try{return await new Promise((resolve,reject)=>{const q=db.transaction('attempts').objectStore('attempts').getAll();q.onsuccess=()=>resolve(q.result.map(x=>x.attemptId));q.onerror=()=>reject(q.error)})}finally{db.close()}})()`);
    for(const style of ['Hero','Lifestyle','Flat Lay','Macro','UGC','Billboard']) {
      await evaluate(client, `(() => {const group=[...document.querySelectorAll('.studio-panel fieldset')].find(f=>f.querySelector('legend')?.textContent==='Choose styles');const label=[...group.querySelectorAll('label')].find(l=>l.innerText.trim()===${JSON.stringify(style)});if(!label.querySelector('input').checked)label.querySelector('input').click()})()`);
    }
    await until(()=>evaluate(client,`document.querySelectorAll('.style-plan').length===7`),'seven independent style plans');
    assert.match(await evaluate(client,`document.querySelector('.queue-consent-progress').innerText`),/Style authorizations: 0 of 7/);
    for (const width of [320,390,1280]) {
      await client.call('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:width<600});
      const layout=await evaluate(client, `(() => {const p=document.querySelector('.style-plan > p');const submit=document.querySelector('.studio-panel button[type="submit"]');const comparison=document.querySelector('.studio-scene-comparison');const labels=[...comparison.querySelectorAll(':scope > label')];const rect=e=>e.getBoundingClientRect();return {lineHeight:parseFloat(getComputedStyle(p).lineHeight),fontSize:parseFloat(getComputedStyle(p).fontSize),gap:rect(comparison).top-rect(submit).bottom,labelGap:rect(labels[1]).top-rect(labels[0]).bottom,overflow:document.documentElement.scrollWidth>innerWidth}})()`);
      assert.ok(layout.lineHeight >= layout.fontSize*1.49, `Readable plan text at ${width}px`);
      assert.ok(layout.gap >= 20 && layout.labelGap >= 10, `Separate comparison controls at ${width}px`);
      assert.equal(layout.overflow,false, `No page overflow at ${width}px`);
    }
    await client.call('Emulation.setDeviceMetricsOverride',{width:320,height:800,deviceScaleFactor:1,mobile:true});
    for(const style of ['Studio','Hero','Lifestyle','Flat Lay','Macro','UGC']) {
      await evaluate(client, `[...document.querySelectorAll('.style-plan label')].find(l=>l.innerText.includes(${JSON.stringify('I authorize this single '+style+' attempt')})).querySelector('input').click()`);
    }
    assert.equal(await evaluate(client,`[...document.querySelectorAll('.studio-panel button')].find(b=>b.textContent==='Authorize and generate selected scenes').disabled`),true,'Every style needs its own consent.');
    assert.match(await evaluate(client,`document.querySelector('.queue-consent-progress').innerText`),/Style authorizations: 6 of 7\. Still needed: Billboard\./);
    assert.equal(providerCalls,3,'Partial queue consent sends nothing.');
    await evaluate(client, `[...document.querySelectorAll('.style-plan label')].find(l=>l.innerText.includes('I authorize this single Billboard attempt')).querySelector('input').click()`);
    await until(()=>evaluate(client,`![...document.querySelectorAll('.studio-panel button')].find(b=>b.textContent==='Authorize and generate selected scenes').disabled`),'seven-style consent');
    assert.match(await evaluate(client,`document.querySelector('.queue-consent-progress').innerText`),/Style authorizations: 7 of 7\. Other required confirmations and gateway checks still apply\./);
    await evaluate(client,`[...document.querySelectorAll('.studio-panel button')].find(b=>b.textContent==='Authorize and generate selected scenes').click()`);
    await until(()=>evaluate(client,`document.querySelector('.studio-panel')?.innerText.includes('7 independent scene attempts completed') && [...document.querySelectorAll('.studio-panel button')].some(b=>b.textContent==='Authorize and generate selected scenes')`),'completed seven-style queue');
    assert.equal(providerCalls,10,'Exactly seven new synthetic provider calls occur.');
    assert.equal(new Set(providerPrompts.slice(3)).size,7,'Each style has a distinct provider prompt.');
    const queue=await evaluate(client, `(async()=>{const db=await new Promise((resolve,reject)=>{const q=indexedDB.open('product-image-studio');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)});try{return await new Promise((resolve,reject)=>{const q=db.transaction('attempts').objectStore('attempts').getAll();q.onsuccess=()=>resolve(q.result.filter(x=>!${JSON.stringify(attemptsBefore)}.includes(x.attemptId)).map(x=>({id:x.attemptId,job:x.jobId,style:x.styleId,status:x.status,source:x.sourceSha256,mask:x.maskId})));q.onerror=()=>reject(q.error)})}finally{db.close()}})()`);
    assert.equal(queue.length,7);assert.equal(new Set(queue.map(x=>x.id)).size,7);assert.equal(new Set(queue.map(x=>x.job)).size,7);
    assert.deepEqual(queue.map(x=>x.style).sort(),['billboard','flat_lay','hero','lifestyle','macro','studio','ugc']);
    assert.ok(queue.every(x=>x.status==='DEFINITIVE_SUCCESS'&&x.source===sourceHash));assert.equal(new Set(queue.map(x=>x.mask)).size,1);
    const queueIds=queue.map(x=>x.id);
    const scenes=await evaluate(client, `(async()=>{const db=await new Promise((resolve,reject)=>{const q=indexedDB.open('product-image-studio');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)});try{return await new Promise((resolve,reject)=>{const q=db.transaction('generatedAssets').objectStore('generatedAssets').getAll();q.onsuccess=()=>resolve(q.result.filter(x=>!x.kind&&${JSON.stringify(queueIds)}.includes(x.attemptId)).map(x=>({asset:x.assetId,attempt:x.attemptId,hash:x.sha256})));q.onerror=()=>reject(q.error)})}finally{db.close()}})()`);
    assert.equal(scenes.length,7);assert.equal(new Set(scenes.map(x=>x.asset)).size,7);assert.deepEqual(scenes.map(x=>x.attempt).sort(),[...queueIds].sort());
    assert.ok(scenes.every(x=>x.hash===createHash('sha256').update(Buffer.from(providerImage,'base64')).digest('hex')),'Each attempt retains its own synthetic scene record.');

    await client.call('Page.reload');await until(()=>evaluate(client,`document.querySelectorAll('.studio-history li').length>=10`),'persisted seven-style history');
    assert.equal(providerCalls,10,'Reload does not resend the seven-style queue.');



    await until(()=>evaluate(client, `(async()=> (await caches.keys()).length>0)()`),'installed shell cache');
    const browserExposure=await evaluate(client, `(async()=>{
      const needles=[${JSON.stringify(token)},'synthetic-provider-fixture'];
      const scan=async value=>{if(typeof value==='string')return needles.some(n=>value.includes(n));if(value instanceof Blob)return scan(await value.text());if(value instanceof ArrayBuffer||ArrayBuffer.isView(value))return scan(new TextDecoder().decode(value));if(value&&typeof value==='object'){for(const [k,v] of Object.entries(value))if(await scan(k)||await scan(v))return true}return false};
      const result={probe:await scan({nested:new Blob([needles[0]])}),dom:await scan(document.documentElement.outerHTML),local:await scan({...localStorage}),session:await scan({...sessionStorage}),indexedDB:false,cache:false,dbCount:0,rowCount:0,cacheCount:0,cacheEntries:0};
      for(const info of await indexedDB.databases()){if(!info.name)continue;result.dbCount++;const db=await new Promise((resolve,reject)=>{const q=indexedDB.open(info.name);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)});try{for(const name of db.objectStoreNames){const rows=await new Promise((resolve,reject)=>{const t=db.transaction(name,'readonly'),q=t.objectStore(name).getAll();q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)});result.rowCount+=rows.length;if(await scan(rows))result.indexedDB=true}}finally{db.close()}}
      for(const name of await caches.keys()){result.cacheCount++;const cache=await caches.open(name);for(const request of await cache.keys()){result.cacheEntries++;const response=await cache.match(request);if(await scan(request.url)||await scan(await response.clone().text()))result.cache=true}}
      return result;
    })()`);
    const {probe,dbCount,rowCount,cacheCount,cacheEntries,...exposure}=browserExposure;
    assert.equal(probe,true,'The scanner detects a synthetic credential embedded in a Blob.');
    assert.ok(dbCount>0 && rowCount>0 && cacheCount>0 && cacheEntries>0,'The scan examined populated databases and caches.');
    assert.deepEqual(exposure,{dom:false,local:false,session:false,indexedDB:false,cache:false},'Synthetic credentials are absent from browser-visible storage and shell caches.');
    const logText=JSON.stringify(client.events);assert.equal(logText.includes(token)||logText.includes('synthetic-provider-fixture'),false,'Console and exception events contain no synthetic credentials.');
    assert.equal(client.events.filter(e=>e.method==='Runtime.exceptionThrown').length,0,'No uncaught page exceptions occurred.');

    assert.equal(await evaluate(client,'document.documentElement.scrollWidth===innerWidth'),true);
    await evaluate(client, `(() => {window.confirm=()=>true;const create=URL.createObjectURL;URL.createObjectURL=function(blob){window.__backup=blob;return create.call(this,blob)};const click=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download.startsWith('product-backup-')){window.__backupUrl=this.href;return}return click.call(this)};[...document.querySelectorAll('button')].find(b=>b.textContent==='Download full backup').click()})()`);
    await until(()=>evaluate(client, `!!window.__backupUrl`),'synthetic backup');
    const backupData=await evaluate(client, `new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.onerror=()=>reject(r.error);r.readAsDataURL(window.__backup)})`);
    await evaluate(client, `(async()=>{[...document.querySelectorAll('a')].find(a=>a.textContent.includes('All products')).click()})()`);
    await until(()=>evaluate(client, `location.pathname==='/' && [...document.querySelectorAll('a')].some(a=>a.textContent==='Import backup')`),'workspace after backup');
    await evaluate(client, `[...document.querySelectorAll('a')].find(a=>a.textContent==='Import backup').click()`);
    await until(()=>evaluate(client, `!!document.querySelector('#backup-file')`),'backup import');
    await evaluate(client, `(() => {const d=new DataTransfer();d.items.add(new File([window.__backup],'synthetic-backup.zip',{type:'application/zip'}));const input=document.querySelector('#backup-file');input.files=d.files;input.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await until(()=>evaluate(client, `!!document.querySelector('.import-preview')`),'backup preview');
    for (const width of [320,390,1280]) {
      await client.call('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:width<600});
      const preview=await evaluate(client, `(() => {const card=document.querySelector('.import-preview');const actions=[...card.querySelectorAll('.form-actions button')].map(b=>{const r=b.getBoundingClientRect();return {left:r.left,right:r.right,height:r.height,disabled:b.disabled}});const r=card.getBoundingClientRect();return {actions,card:{left:r.left,right:r.right},overflow:document.documentElement.scrollWidth>innerWidth,conflict:card.innerText.includes('conflicts with existing project data')}})()`);
      assert.equal(preview.conflict,true,'The existing synthetic project is protected from overwrite.');
      assert.equal(preview.actions[0].disabled,true,'Conflicting import is disabled.');
      assert.equal(preview.overflow,false,`The backup preview fits at ${width}px.`);
      assert.ok(preview.actions.every(b=>b.left>=preview.card.left&&b.right<=preview.card.right&&b.height>=44),`Both actions fit within the preview at ${width}px.`);
    }
    await evaluate(client, `[...document.querySelectorAll('.import-preview button')].find(b=>b.textContent==='Discard preview').click()`);
    assert.equal(await evaluate(client, `!!document.querySelector('.import-preview')`),false,'Discard closes the preview.');
    await evaluate(client, `[...document.querySelectorAll('a')].find(a=>a.textContent.includes('All products')).click()`);
    await until(()=>evaluate(client, `location.pathname==='/' && document.body.innerText.includes('Synthetic direct gateway test')`),'original product remains after discard');
    assert.equal(providerCalls,10,'Backup inspection and discard make no provider calls.');
    const browserPath=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[1];
    browserClient=await connect(`ws://127.0.0.1:${port}${browserPath}`);
    const {browserContextId}=await browserClient.call('Target.createBrowserContext');
    const {targetId}=await browserClient.call('Target.createTarget',{url:'about:blank',browserContextId});
    const restoreTarget=await until(async()=> (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(x=>x.id===targetId),'isolated restore tab');
    restoreClient=await connect(restoreTarget.webSocketDebuggerUrl);await restoreClient.call('Runtime.enable');await restoreClient.call('Page.enable');
    await restoreClient.call('Emulation.setDeviceMetricsOverride',{width:320,height:800,deviceScaleFactor:1,mobile:true});
    await restoreClient.call('Page.navigate',{url:`${origin}/import`});
    await until(()=>evaluate(restoreClient, `!!document.querySelector('#backup-file')`),'fresh profile import');
    await evaluate(restoreClient, `(() => {const bytes=Uint8Array.from(atob(${JSON.stringify(backupData)}),c=>c.charCodeAt(0));const d=new DataTransfer();d.items.add(new File([bytes],'synthetic-backup.zip',{type:'application/zip'}));const input=document.querySelector('#backup-file');input.files=d.files;input.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await until(async()=>{const state=await evaluate(restoreClient, `document.querySelector('[role=alert]')?.innerText || (document.querySelector('.import-preview') ? 'ready' : '')`);if(state && state!=='ready') throw new Error('Import error: '+state);return state==='ready'},'fresh profile backup preview');
    assert.equal(await evaluate(restoreClient, `document.querySelector('.import-preview button').disabled`),false,'A non-conflicting backup can be imported.');
    await evaluate(restoreClient, `(() => {window.__restoreAdd=IDBObjectStore.prototype.add;IDBObjectStore.prototype.add=function(...args){const request=window.__restoreAdd.apply(this,args);if(this.name==='products'&&args[0].productId===${JSON.stringify(productId)})request.addEventListener('success',()=>{window.__restoreWriteObserved=true;const button=[...document.querySelectorAll('.import-preview button')].find(b=>b.textContent==='Cancel import');const r=button.getBoundingClientRect();window.__cancelLayout={left:r.left,right:r.right,height:r.height,overflow:document.documentElement.scrollWidth>innerWidth};button.click()},{once:true});return request}})()`);
    await evaluate(restoreClient, `document.querySelector('.import-preview button').click()`);
    await until(()=>evaluate(restoreClient, `document.querySelector('.import-preview [role="alert"]')?.innerText.includes('Operation cancelled. No local data was changed.')`),'cancelled import');
    assert.equal(await evaluate(restoreClient, `window.__restoreWriteObserved`),true,'Cancellation occurred after the product write was queued.');
    const cancelLayout=await evaluate(restoreClient, `window.__cancelLayout`);
    assert.ok(cancelLayout.left>=0 && cancelLayout.right<=320 && cancelLayout.height>=44 && !cancelLayout.overflow,'Cancel remains usable at 320 px.');
    const afterCancel=await evaluate(restoreClient, `(async()=>{const db=await new Promise((resolve,reject)=>{const q=indexedDB.open('product-image-studio');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)});try{return await Promise.all(['products','attempts','sourceAssets'].map(name=>new Promise((resolve,reject)=>{const q=db.transaction(name).objectStore(name).count();q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)})))}finally{db.close()}})()`);
    assert.deepEqual(afterCancel,[0,0,0],'The cancelled transaction leaves no partial product, attempt or source.');
    await evaluate(restoreClient, `IDBObjectStore.prototype.add=window.__restoreAdd`);
    await evaluate(restoreClient, `document.querySelector('.import-preview button').click()`);
    await until(()=>evaluate(restoreClient, `location.pathname===${JSON.stringify('/products/'+productId)} && !!document.querySelector('.studio-history')`),'restored product history');
    const restored=await evaluate(restoreClient, `(async()=>{const db=await new Promise((resolve,reject)=>{const q=indexedDB.open('product-image-studio');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)});try{const rows=await Promise.all(['attempts','sourceAssets'].map(name=>new Promise((resolve,reject)=>{const q=db.transaction(name).objectStore(name).getAll();q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)})));return {attempts:rows[0].map(x=>x.attemptId),sources:await Promise.all(rows[1].map(async x=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await x.blob.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join(''))),untrusted:document.body.innerText.includes('untrusted'),overflow:document.documentElement.scrollWidth>innerWidth}}finally{db.close()}})()`);
    assert.equal(restored.attempts.length,10,'Every synthetic attempt survives the restore.');
    assert.ok(queueIds.every(id=>restored.attempts.includes(id)),'All seven queue identities survive the restore.');
    assert.ok(restored.sources.includes(sourceHash),'The restored source bytes retain their original hash.');
    assert.equal(restored.untrusted,true,'Imported history is identified as untrusted.');
    assert.equal(restored.overflow,false,'The restored product fits the 320 px viewport.');
    assert.equal(providerCalls,10,'Restore does not invoke the provider.');
  } finally {
    restoreClient?.close();browserClient?.close();client?.close();if(browser&&browser.exitCode===null){browser.kill('SIGTERM');await Promise.race([new Promise(r=>browser.once('exit',r)),delay(3000)])}
    if(gateway)await new Promise((resolve,reject)=>gateway.close(e=>e?reject(e):resolve()));
    await rm(root,{recursive:true,force:true});
  }
});

test('an unavailable lazy page offers explicit reload and workspace recovery', {timeout: 60000}, async () => {
  assert.ok(chrome && existsSync(chrome), 'Set CHROME_BIN to a Chromium executable.');
  const root=await mkdtemp(join(tmpdir(),'studio-route-error-')),web=join(root,'web'),profile=join(root,'profile');
  await mkdir(profile);let gateway,browser,client;
  try {
    await build({root:appRoot,configFile:join(appRoot,'vite.config.ts'),logLevel:'silent',build:{outDir:web,emptyOutDir:true}});
    gateway=await createGateway({authTokenHash:createHash('sha256').update(randomBytes(32)).digest('hex'),providerConfigured:false,staticDirectory:web});
    await new Promise((resolve,reject)=>{gateway.once('error',reject);gateway.listen(0,'127.0.0.1',resolve)});
    const origin=`http://127.0.0.1:${gateway.address().port}`;
    browser=spawn(chrome,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-networking','about:blank'],{stdio:'ignore'});
    const port=await until(async()=>{try{return Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);}catch{return null}},'isolated Chromium');
    const target=(await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(x=>x.type==='page');
    client=await connect(target.webSocketDebuggerUrl);await client.call('Page.enable');await client.call('Page.bringToFront');await client.call('Network.enable');
    await client.call('Network.setBypassServiceWorker',{bypass:true});await client.call('Network.setBlockedURLs',{urls:['*BackupPages-*.js']});
    await client.call('Emulation.setDeviceMetricsOverride',{width:320,height:800,deviceScaleFactor:1,mobile:true});
    await client.call('Page.navigate',{url:origin});await until(()=>evaluate(client,`[...document.querySelectorAll('a')].some(a=>a.textContent==='Import backup')`),'workspace');
    await evaluate(client,`[...document.querySelectorAll('a')].find(a=>a.textContent==='Import backup').click()`);
    await until(()=>evaluate(client,`document.querySelector('[role="alert"]')?.innerText.includes('Page unavailable')`),'page failure message');
    assert.equal(await evaluate(client,`location.pathname`),'/import');
    assert.equal(await evaluate(client,`document.querySelector('[role="alert"]')?.innerText.includes('Unsaved changes may be lost')`),true);
    await evaluate(client,`[...document.querySelectorAll('[role="alert"] a')].find(a=>a.textContent.includes('Return to workspace')).click()`);
    await until(()=>evaluate(client,`location.pathname==='/' && document.body.innerText.includes('Your products')`),'return to workspace');
    await evaluate(client,`[...document.querySelectorAll('a')].find(a=>a.textContent==='Import backup').click()`);
    await until(()=>evaluate(client,`document.querySelector('[role="alert"]')?.innerText.includes('Page unavailable')`),'repeated page failure');
    await client.call('Network.setBlockedURLs',{urls:[]});
    await evaluate(client,`[...document.querySelectorAll('[role="alert"] button')].find(b=>b.textContent==='Reload page').click()`);
    await until(()=>evaluate(client,`location.pathname==='/import' && !!document.querySelector('#backup-file') && !document.querySelector('[role="alert"]')`),'explicit reload recovery');
    assert.equal(await evaluate(client,'document.documentElement.scrollWidth===innerWidth'),true);
  } finally {
    client?.close();if(browser&&browser.exitCode===null){browser.kill('SIGTERM');await Promise.race([new Promise(r=>browser.once('exit',r)),delay(3000)])}
    if(gateway)await new Promise((resolve,reject)=>gateway.close(e=>e?reject(e):resolve()));
    await rm(root,{recursive:true,force:true});
  }
});
