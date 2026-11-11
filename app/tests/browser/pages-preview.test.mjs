import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'vite';

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

test('Pages subpath supports hash routes, scoped worker and offline reload', {timeout:60000}, async()=>{
 const root=await mkdtemp(join(tmpdir(),'studio-pages-')),out=join(root,'dist'),profile=join(root,'profile'),base='/PWA-AI-Product-Image-Studio-BYOK/';
 let server,browser,tab; const requests=[];
 try{
  await build({root:appRoot,configFile:join(appRoot,'vite.config.ts'),mode:'pages',base,logLevel:'silent',build:{outDir:out}}); await mkdir(profile);
  const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
  server=createServer(async(req,res)=>{requests.push(req.url);try{const path=new URL(req.url,'http://localhost').pathname;assert.ok(path.startsWith(base));const name=path.slice(base.length)||'index.html';assert.ok(!name.includes('..'));const bytes=await readFile(join(out,name));res.writeHead(200,{'content-type':types[extname(name)]||'application/octet-stream','cache-control':'no-store'});res.end(bytes)}catch{res.writeHead(404);res.end()}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); const origin=`http://127.0.0.1:${server.address().port}`,url=`${origin}${base}#/settings`;
  browser=spawn(chrome,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--disable-background-networking','about:blank'],{stdio:'ignore'});
  const port=await until(async()=>{try{return Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0])}catch{return null}},'Chrome');
  const list=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();tab=await connect(list.find(x=>x.type==='page').webSocketDebuggerUrl);
  await tab.call('Page.enable');await tab.call('Runtime.enable');await tab.call('Page.navigate',{url});
  await until(()=>evaluate(tab,`!!document.querySelector('h1') && document.body.innerText.includes('Settings')`),'settings route');
  await until(()=>evaluate(tab,'!!navigator.serviceWorker.controller'),'worker');
  assert.equal(await evaluate(tab,'navigator.serviceWorker.ready.then(r=>new URL(r.scope).pathname)'),base);
  const manifest=JSON.parse(await readFile(join(out,'manifest.webmanifest'),'utf8'));assert.equal(new URL(manifest.start_url,`${origin}${base}manifest.webmanifest`).pathname,base);
  await evaluate(tab, `(() => {window.__providerCalls=0;const original=window.fetch;window.fetch=async(url,options)=>{if(String(url)==='https://api.openai.com/v1/images/generations'){window.__providerCalls++;const c=document.createElement('canvas');c.width=c.height=1024;c.getContext('2d').fillRect(0,0,1024,1024);return Response.json({data:[{b64_json:c.toDataURL('image/png').split(',')[1]}]})}return original(url,options)};const e=document.querySelector('input[type=password]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'sk-synthetic-browser-key-not-real');e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await evaluate(tab, `document.querySelector('input[type=password]').closest('form').querySelector('button').click()`);
  await until(()=>evaluate(tab,`document.body.innerText.includes('Key available in this tab')`),'browser key connected');
  assert.equal(await evaluate(tab,`document.querySelector('input[type=password]').value`),'');
  await evaluate(tab,`location.hash='#/'`);
    await until(()=>evaluate(tab,`[...document.querySelectorAll('a')].some(a=>a.textContent==='Create product')`),'product creation link');
    await evaluate(tab,`[...document.querySelectorAll('a')].find(a=>a.textContent==='Create product').click()`);
    await until(()=>evaluate(tab,`!!document.querySelector('#product-sku')`),'product form');
    await evaluate(tab,`(() => {const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;for(const [id,value] of [['product-sku',crypto.randomUUID()],['product-name','Synthetic direct gateway test'],['product-category','Test']]){const e=document.getElementById(id);set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}))}document.querySelector('.form-card input[type="checkbox"]').click();document.querySelector('.form-card button[type="submit"]').click()})()`);
    const productId=await until(()=>evaluate(tab,`location.hash.startsWith('#/products/') && location.hash!=='#/products/new' && location.hash.split('/')[2]`),'created product');
    await until(()=>evaluate(tab,`!!document.querySelector('#source-file')`),'source upload');
    const sourceHash=await evaluate(tab,`(async()=>{const c=document.createElement('canvas');c.width=200;c.height=100;const x=c.getContext('2d');x.fillStyle='#a31';x.fillRect(0,0,200,100);const blob=await new Promise(r=>c.toBlob(r,'image/png'));const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('');const d=new DataTransfer();d.items.add(new File([blob],'synthetic.png',{type:'image/png'}));const f=document.querySelector('#source-file');f.files=d.files;f.dispatchEvent(new Event('change',{bubbles:true}));return hash})()`);
    await until(()=>evaluate(tab,`!!document.querySelector('#camera-view')`),'source preview');
    await evaluate(tab,`(() => {const e=document.querySelector('#camera-view');e.value='TOP';e.dispatchEvent(new Event('change',{bubbles:true}));[...document.querySelectorAll('.source-panel button')].find(b=>b.textContent==='Save original').click()})()`);
    await until(()=>evaluate(tab,`document.querySelector('#mask-source')?.options.length>1`),'saved source');
    await evaluate(tab,`(() => {const s=document.querySelector('#mask-source');s.value=s.options[1].value;s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await until(()=>evaluate(tab,`document.querySelector('.mask-regions')&&!document.querySelector('.mask-regions').disabled`),'mask editor');
    await evaluate(tab,`[...document.querySelectorAll('.mask-regions button')].find(b=>b.textContent==='Add protected area').click()`);
    await until(()=>evaluate(tab,`document.querySelectorAll('.mask-region').length===1`),'protected region');
    await evaluate(tab,`(() => {const tool=document.querySelector('#mask-tool');tool.value='erase';tool.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('.mask-stamp button').click()})()`);
    assert.equal(await evaluate(tab,`document.querySelector('canvas[aria-label="Mask drawing surface"]').getContext('2d').getImageData(100,50,1,1).data[3]`),0,'The offline fixture erases a non-protected center pixel.');
    await evaluate(tab,`[...document.querySelectorAll('.mask-editor button')].find(b=>b.textContent==='Review mask').click()`);
    await until(()=>evaluate(tab,`[...document.querySelectorAll('.mask-editor button')].some(b=>b.textContent==='Save mask')`),'mask review');
    await evaluate(tab,`[...document.querySelectorAll('.mask-editor button')].find(b=>b.textContent==='Save mask').click()`);
    await until(()=>evaluate(tab,`document.querySelector('.mask-editor')?.innerText.includes('Mask saved')`),'saved mask');
  await until(()=>evaluate(tab,`[...document.querySelectorAll('.style-plan label')].some(l=>l.innerText.includes('I authorize this single Studio attempt')&&!l.querySelector('input').disabled)`),'BYOK consent');
  await evaluate(tab,`[...document.querySelectorAll('.style-plan label')].find(l=>l.innerText.includes('I authorize this single Studio attempt')).querySelector('input').click()`);
  await until(()=>evaluate(tab,`![...document.querySelectorAll('.studio-panel button')].find(b=>b.textContent==='Authorize and generate selected scenes').disabled`),'ready to generate');
  await evaluate(tab,`[...document.querySelectorAll('.studio-panel button')].find(b=>b.textContent==='Authorize and generate selected scenes').click()`);
  await until(()=>evaluate(tab,`document.querySelector('.studio-history')?.innerText.includes('Studio · Scene generated; unapproved')`),'browser SDK scene saved');
  assert.equal(await evaluate(tab,'window.__providerCalls'),1);
  assert.equal(await evaluate(tab,`JSON.stringify([localStorage,sessionStorage]).includes('sk-synthetic-browser-key-not-real')`),false);
  const persistedLeak=await evaluate(tab,`(async()=>{const needle='sk-synthetic-browser-key-not-real';const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('product-image-studio');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});try{for(const name of db.objectStoreNames){const rows=await new Promise((resolve,reject)=>{const r=db.transaction(name).objectStore(name).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});if(JSON.stringify(rows).includes(needle))return true}}finally{db.close()}for(const name of await caches.keys()){const cache=await caches.open(name);for(const request of await cache.keys()){if(request.url.includes('api.openai.com')||JSON.stringify([...request.headers]).includes(needle)||(await(await cache.match(request)).text()).includes(needle))return true}}return false})()`);
  assert.equal(persistedLeak,false,'Key and provider requests must not enter IndexedDB or caches');
  await evaluate(tab,`location.hash='#/settings'`);
  await until(()=>evaluate(tab,`!!document.querySelector('input[type=password]')`),'return to settings');
  await tab.call('Page.reload');await until(()=>evaluate(tab,`document.readyState==='complete' && document.body.innerText.includes('Settings')`),'route reload');
  assert.equal(await evaluate(tab,`document.body.innerText.includes('No key connected')`),true,'Reload clears key');
  assert.equal(requests.some(p=>p.startsWith('/api/')),false,'Preview must not call gateway');
  await tab.call('Network.enable');await tab.call('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});await tab.call('Page.reload');
  await until(()=>evaluate(tab,`document.readyState==='complete' && document.body.innerText.includes('Settings')`),'offline reload');assert.equal(tab.events.filter(e=>e.method==='Runtime.exceptionThrown').length,0);
 }finally{tab?.close();if(browser){browser.kill();await new Promise(resolve=>browser.once('exit',resolve));}if(server)await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100})}
});
