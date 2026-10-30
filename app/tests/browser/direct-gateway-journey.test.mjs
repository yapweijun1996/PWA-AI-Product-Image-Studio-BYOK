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
  const socket = new WebSocket(url), pending = new Map(); let next = 0;
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data), handler = pending.get(message.id);
    if (!handler) return;
    pending.delete(message.id);
    message.error ? handler.reject(new Error(message.error.message)) : handler.resolve(message.result);
  });
  socket.addEventListener('close', () => { for (const entry of pending.values()) entry.reject(new Error('DevTools connection closed.')); pending.clear(); });
  return {
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
  let gateway,browser,client;let providerCalls=0,providerImage='';
  const token=randomBytes(32).toString('base64url');
  try {
    await build({root:appRoot,configFile:join(appRoot,'vite.config.ts'),logLevel:'silent',build:{outDir:web,emptyOutDir:true}});
    gateway=await createGateway({authTokenHash:createHash('sha256').update(token).digest('hex'),providerConfigured:true,staticDirectory:web,imageGeneration:{enabled:true,apiKey:'synthetic-provider-fixture',journalDirectory:journal,transport:async()=>{providerCalls++;return new Response(JSON.stringify({data:[{b64_json:providerImage}]}),{status:200,headers:{'content-type':'application/json'}});}}});
    await new Promise((resolve,reject)=>{gateway.once('error',reject);gateway.listen(0,'127.0.0.1',resolve)});
    const origin=`http://127.0.0.1:${gateway.address().port}`;
    const crossOrigin=await fetch(`${origin}/api/v2/auth/login`,{method:'POST',headers:{'content-type':'application/json',origin:'http://untrusted.invalid'},body:JSON.stringify({token})});
    assert.equal(crossOrigin.status,403,'A different origin cannot sign in.');assert.equal(providerCalls,0);

    browser=spawn(chrome,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-networking','about:blank'],{stdio:'ignore'});
    const port=await until(async()=>{try{return Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);}catch{return null}},'isolated Chromium');
    const target=(await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(x=>x.type==='page');
    client=await connect(target.webSocketDebuggerUrl);await client.call('Page.enable');await client.call('Page.bringToFront');
    await client.call('Emulation.setDeviceMetricsOverride',{width:320,height:800,deviceScaleFactor:1,mobile:true});
    await client.call('Page.navigate',{url:origin});await until(()=>evaluate(client,`location.origin===${JSON.stringify(origin)} && document.readyState==='complete'`),'app load');
    providerImage=await evaluate(client,`(() => {const c=document.createElement('canvas');c.width=1024;c.height=1024;const x=c.getContext('2d');x.fillStyle='#225588';x.fillRect(0,0,1024,1024);return c.toDataURL('image/png').split(',')[1]})()`);
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
    await client.call('Page.navigate',{url:`${origin}/settings`});
    await until(()=>evaluate(client,`!!document.querySelector('#local-access-token')`),'local sign-in');
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
    try {const entries=await zip.getEntries(),proof=entries.find(e=>e.filename.startsWith('provenance/')&&e.filename.endsWith('.json')),output=entries.find(e=>e.filename.startsWith('outputs/')&&e.filename.endsWith('.png'));assert.ok(proof&&output);const receipt=JSON.parse(new TextDecoder().decode(await proof.getData(new Uint8ArrayWriter()))),bytes=await output.getData(new Uint8ArrayWriter());assert.equal(receipt.sourceSha256,sourceHash);assert.equal(receipt.sceneSha256,createHash('sha256').update(Buffer.from(providerImage,'base64')).digest('hex'));assert.equal(receipt.outputSha256,createHash('sha256').update(bytes).digest('hex'));assert.ok(receipt.reviewId&&receipt.decisionId);}finally{await zip.close()}
    assert.equal(providerCalls,1,'No automatic resend during review or download.');
    assert.equal(await evaluate(client,'document.documentElement.scrollWidth===innerWidth'),true);
  } finally {
    client?.close();if(browser&&browser.exitCode===null){browser.kill('SIGTERM');await Promise.race([new Promise(r=>browser.once('exit',r)),delay(3000)])}
    if(gateway)await new Promise((resolve,reject)=>gateway.close(e=>e?reject(e):resolve()));
    await rm(root,{recursive:true,force:true});
  }
});
