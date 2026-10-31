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

test('an old tab loads its cached lazy route after a user-activated two-build update', {timeout: 90000}, async () => {
  assert.ok(chrome && existsSync(chrome), 'Set CHROME_BIN to a Chromium executable.');
  const root=await mkdtemp(join(tmpdir(),'studio-lazy-update-')),a=join(root,'a'),b=join(root,'b'),profile=join(root,'profile');
  await mkdir(profile);let served=a,server,browser,oldTab,newTab;
  const variations={name:'synthetic-product-build-b',enforce:'pre',transform(code,id){if(id.endsWith('/src/ProductDetails.tsx')){const needle='<h1>{product.name}</h1>';assert.ok(code.includes(needle));return code.replace(needle,`${needle}<span data-test-build="b">Synthetic build B</span>`)} }};
  try {
    await build({root:appRoot,configFile:join(appRoot,'vite.config.ts'),logLevel:'silent',build:{outDir:a,emptyOutDir:true}});
    await build({root:appRoot,configFile:join(appRoot,'vite.config.ts'),logLevel:'silent',plugins:[variations],build:{outDir:b,emptyOutDir:true}});
    const oldName=(await readdir(join(a,'assets'))).find(n=>n.startsWith('ProductDetails-')&&n.endsWith('.js'));
    const newName=(await readdir(join(b,'assets'))).find(n=>n.startsWith('ProductDetails-')&&n.endsWith('.js'));
    assert.ok(oldName&&newName&&oldName!==newName,'The two builds contain different product route modules.');
    const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
    server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://127.0.0.1');const name=url.pathname==='/'||!extname(url.pathname)?'index.html':url.pathname.slice(1);if(name.includes('..'))throw new Error('invalid');const bytes=await readFile(join(served,name));res.writeHead(200,{'content-type':types[extname(name)]||'application/octet-stream','cache-control':'no-store'});res.end(bytes)}catch{res.writeHead(404);res.end()}});
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});const origin=`http://127.0.0.1:${server.address().port}`;
    browser=spawn(chrome,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-networking','about:blank'],{stdio:'ignore'});
    const port=await until(async()=>{try{return Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);}catch{return null}},'isolated Chromium');
    const list=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();oldTab=await connect(list.find(x=>x.type==='page').webSocketDebuggerUrl);
    const target=await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(origin)}`,{method:'PUT'})).json();newTab=await connect(target.webSocketDebuggerUrl);
    for(const tab of [oldTab,newTab]){await tab.call('Page.enable');await tab.call('Emulation.setDeviceMetricsOverride',{width:390,height:800,deviceScaleFactor:1,mobile:true});await tab.call('Page.navigate',{url:origin});await until(()=>evaluate(tab,`location.origin===${JSON.stringify(origin)} && document.readyState==='complete'`),'workspace');await until(()=>evaluate(tab,`!!navigator.serviceWorker.controller`),'active version A worker')}
    assert.equal(await evaluate(oldTab,`performance.getEntriesByType('resource').some(e=>e.name.includes(${JSON.stringify(oldName)}) )`),false,'Old tab has not loaded the lazy page.');
    await evaluate(oldTab,`window.__oldTabSentinel='still-loaded'`);
    await evaluate(oldTab,`[...document.querySelectorAll('a')].find(x=>x.textContent==='Create product').click()`);
    await until(()=>evaluate(oldTab,`!!document.querySelector('#product-name')`),'old tab draft form');
    await evaluate(oldTab,`(() => {const e=document.querySelector('#product-name');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'Synthetic old tab');e.dispatchEvent(new Event('input',{bubbles:true}))})()`);

    served=b;
    assert.equal((await fetch(`${origin}/assets/${oldName}`)).status,404,'The server no longer serves the old lazy module.');
    await evaluate(newTab,`navigator.serviceWorker.getRegistration().then(r=>r.update())`);
    await until(()=>evaluate(newTab,`navigator.serviceWorker.getRegistration().then(r=>!!r.waiting)`),'waiting version B');
    await until(()=>evaluate(newTab,`[...document.querySelectorAll('.update-notice button')].some(x=>x.textContent==='Update now')`),'user update prompt');
    await newTab.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await evaluate(newTab,`(() => {const observer=new MutationObserver(()=>{const spinner=document.querySelector('.update-spinner');if(spinner){sessionStorage.setItem('synthetic-update-motion',JSON.stringify({reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,animation:getComputedStyle(spinner).animationName,notice:document.querySelector('.update-notice')?.innerText}));observer.disconnect()}});observer.observe(document.body,{subtree:true,childList:true})})()`);
    await evaluate(newTab,`[...document.querySelectorAll('.update-notice button')].find(x=>x.textContent==='Update now').click()`);
    await until(()=>evaluate(oldTab,`document.querySelector('.update-notice')?.innerText.includes('Reload when ready')`),'other tab update notice');
    const motion=await until(()=>evaluate(newTab,`JSON.parse(sessionStorage.getItem('synthetic-update-motion')||'null')`),'reduced-motion update indicator');
    assert.equal(motion.reduced,true,'The browser emulates reduced motion.');
    assert.equal(motion.animation,'none','The actual update indicator does not animate with reduced motion.');
    assert.ok(motion.notice.includes('Updating application'),'The updating state remains visible without animation.');
    assert.equal(await evaluate(oldTab,`window.__oldTabSentinel`),'still-loaded','The old tab was not silently reloaded.');
    assert.equal(await evaluate(oldTab,`document.querySelector('#product-name').value`),'Synthetic old tab','The old tab retains its unsaved draft.');
    assert.ok(await evaluate(oldTab,`document.querySelector('.update-notice').innerText.includes('Save or discard your changes')`),'The update notice explains the draft hold.');
    const oldFetch=await evaluate(oldTab,`fetch('/assets/${oldName}',{cache:'no-store'}).then(r=>r.status)`);assert.equal(oldFetch,200,'The active worker serves the old cached module.');
    await evaluate(oldTab,`(() => {const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;for(const [id,v] of [['product-sku',crypto.randomUUID()],['product-category','Test']]){const e=document.getElementById(id);set.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}))}document.querySelector('.form-card input[type="checkbox"]').click();document.querySelector('.form-card button[type="submit"]').click()})()`);
    const productId=await until(()=>evaluate(oldTab,`location.pathname.startsWith('/products/')&&location.pathname!=='/products/new'&&location.pathname.split('/')[2]`),'created product');
    await until(()=>evaluate(oldTab,`!!document.querySelector('#source-file')`),'old lazy product page');
    assert.equal(await evaluate(oldTab,`document.querySelector('.update-notice').innerText.includes('Save or discard your changes before continuing.')`),false,'The saved draft no longer blocks the update notice.');
    assert.equal(await evaluate(oldTab,`!!document.querySelector('[data-test-build="b"]')`),false,'Old tab keeps its old route implementation.');
    assert.equal(await evaluate(oldTab,`window.__oldTabSentinel`),'still-loaded');
    await clientNavigate(newTab,origin,productId);
    await until(()=>evaluate(newTab,`!!document.querySelector('[data-test-build="b"]')`),'new version product page');
    assert.equal(await evaluate(oldTab,`document.documentElement.scrollWidth===innerWidth`),true);
    await evaluate(oldTab,`[...document.querySelectorAll('.update-notice button')].find(x=>x.textContent==='Reload when ready').click()`);
    await until(()=>evaluate(oldTab,`location.pathname===${JSON.stringify('/products/')}+${JSON.stringify(productId)} && !!document.querySelector('[data-test-build="b"]')`),'saved product after explicit reload');
    assert.equal(await evaluate(oldTab,`document.querySelector('h1').textContent`),'Synthetic old tab','The saved product survives the user-initiated update.');
  } finally {
    oldTab?.close();newTab?.close();if(browser&&browser.exitCode===null){browser.kill('SIGTERM');await Promise.race([new Promise(r=>browser.once('exit',r)),delay(3000)])}
    if(server)await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));await rm(root,{recursive:true,force:true});
  }
});
async function clientNavigate(tab,origin,productId){await until(()=>evaluate(tab,`!!navigator.serviceWorker.controller`),'new controller');await tab.call('Page.navigate',{url:`${origin}/products/${productId}`})}

for (const withOtherTab of [false,true]) test(`cache-limit recovery protects drafts ${withOtherTab ? 'and other tabs ' : ''}before explicit update`, {timeout: 90000}, async () => {
  assert.ok(chrome && existsSync(chrome), 'Set CHROME_BIN to a Chromium executable.');
  const root=await mkdtemp(join(tmpdir(),'studio-cache-recovery-')),a=join(root,'a'),b=join(root,'b'),profile=join(root,'profile');
  await mkdir(profile);let served=a,server,browser,tab,otherTab;
  const variation={name:'synthetic-cache-recovery-build-b',enforce:'pre',transform(code,id){if(id.endsWith('/src/ProductDetails.tsx')){const needle='<h1>{product.name}</h1>';assert.ok(code.includes(needle));return code.replace(needle,`${needle}<span data-test-cache-build="b">Synthetic build B</span>`)}}};
  try {
    await build({root:appRoot,configFile:join(appRoot,'vite.config.ts'),logLevel:'silent',build:{outDir:a,emptyOutDir:true}});
    await build({root:appRoot,configFile:join(appRoot,'vite.config.ts'),logLevel:'silent',plugins:[variation],build:{outDir:b,emptyOutDir:true}});
    const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
    server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://127.0.0.1');const name=url.pathname==='/'||!extname(url.pathname)?'index.html':url.pathname.slice(1);if(name.includes('..'))throw new Error('invalid');const bytes=await readFile(join(served,name));res.writeHead(200,{'content-type':types[extname(name)]||'application/octet-stream','cache-control':'no-store'});res.end(bytes)}catch{res.writeHead(404);res.end()}});
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});const origin=`http://127.0.0.1:${server.address().port}`;
    browser=spawn(chrome,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-networking','about:blank'],{stdio:'ignore'});
    const port=await until(async()=>{try{return Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);}catch{return null}},'isolated Chromium');
    const list=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();tab=await connect(list.find(x=>x.type==='page').webSocketDebuggerUrl);
    await tab.call('Page.enable');await tab.call('Emulation.setDeviceMetricsOverride',{width:320,height:800,deviceScaleFactor:1,mobile:true});await tab.call('Page.navigate',{url:origin});
    await until(()=>evaluate(tab,`location.origin===${JSON.stringify(origin)} && !!navigator.serviceWorker.controller`),'active version A');
    await evaluate(tab,`[...document.querySelectorAll('a')].find(x=>x.textContent==='Create product').click()`);
    await until(()=>evaluate(tab,`!!document.querySelector('#product-name')`),'draft form');
    await evaluate(tab,`(() => {const e=document.querySelector('#product-name');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'Synthetic cache recovery');e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    const namesBefore=await evaluate(tab,`(async()=>{for(let i=0;i<7;i++)await caches.open('image-studio-shell-synthetic-old-'+i);await (await caches.open('synthetic-unrelated-data')).put('/synthetic-marker',new Response('preserved'));return (await caches.keys()).filter(n=>n.startsWith('image-studio-shell-')).sort()})()`);
    assert.equal(namesBefore.length,8,'The isolated fixture has eight shell caches.');
    served=b;await evaluate(tab,`navigator.serviceWorker.getRegistration().then(r=>r.update())`);
    await until(()=>evaluate(tab,`document.querySelector('.update-notice')?.innerText.includes('Update paused: old app caches')`),'cache-limit notice');
    await evaluate(tab,`(() => {window.__confirmCount=0;window.confirm=()=>{window.__confirmCount++;return true};[...document.querySelectorAll('.update-notice button')].find(b=>b.textContent==='Clear old app caches').click()})()`);
    await until(()=>evaluate(tab,`document.querySelector('.update-notice')?.innerText.includes('Save or discard your changes')`),'draft blocks cleanup');
    assert.equal(await evaluate(tab,`window.__confirmCount`),0,'A draft blocks cleanup before confirmation.');
    assert.equal(await evaluate(tab,`document.querySelector('#product-name').value`),'Synthetic cache recovery');
    assert.deepEqual(await evaluate(tab,`caches.keys().then(a=>a.filter(n=>n.startsWith('image-studio-shell-')).sort())`),namesBefore,'No shell cache was removed while the draft was open.');
    await evaluate(tab,`(() => {const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;for(const [id,v] of [['product-sku',crypto.randomUUID()],['product-category','Test']]){const e=document.getElementById(id);set.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}))}document.querySelector('.form-card input[type="checkbox"]').click();document.querySelector('.form-card button[type="submit"]').click()})()`);
    const productId=await until(()=>evaluate(tab,`location.pathname.startsWith('/products/')&&location.pathname!=='/products/new'&&location.pathname.split('/')[2]`),'saved product');
    await until(()=>evaluate(tab,`!!document.querySelector('#source-file')`),'saved product page');
    await evaluate(tab,`(() => {window.confirm=()=>false;[...document.querySelectorAll('.update-notice button')].find(b=>b.textContent==='Clear old app caches').click()})()`);
    assert.deepEqual(await evaluate(tab,`caches.keys().then(a=>a.filter(n=>n.startsWith('image-studio-shell-')).sort())`),namesBefore,'Canceling cleanup preserves the caches.');
    if (withOtherTab) {
      const otherTarget=await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(origin)}`,{method:'PUT'})).json();
      otherTab=await connect(otherTarget.webSocketDebuggerUrl);await otherTab.call('Page.enable');
      await until(()=>evaluate(otherTab,`location.origin===${JSON.stringify(origin)} && !!navigator.serviceWorker.controller`),'other controlled tab');
      await until(()=>evaluate(otherTab,`[...document.querySelectorAll('a')].some(a=>a.textContent==='Create product')`),'other tab workspace');
      await evaluate(otherTab,`[...document.querySelectorAll('a')].find(a=>a.textContent==='Create product').click()`);
      await until(()=>evaluate(otherTab,`!!document.querySelector('#product-name')`),'other tab draft form');
      await evaluate(otherTab,`(() => {const e=document.querySelector('#product-name');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'Other synthetic draft');e.dispatchEvent(new Event('input',{bubbles:true}));window.__otherSentinel='unchanged'})()`);
      await evaluate(tab,`(() => {window.confirm=()=>true;[...document.querySelectorAll('.update-notice button')].find(b=>b.textContent==='Clear old app caches').click()})()`);
      await until(()=>evaluate(tab,`document.querySelector('.update-notice [role=status]')?.innerText.includes('Close other app tabs')`),'other tab blocks cleanup');
      assert.deepEqual(await evaluate(tab,`caches.keys().then(a=>a.filter(n=>n.startsWith('image-studio-shell-')).sort())`),namesBefore,'The other open tab prevents cache deletion.');
      assert.deepEqual(await evaluate(otherTab,`({controlled:!!navigator.serviceWorker.controller,draft:document.querySelector('#product-name').value,sentinel:window.__otherSentinel})`),{controlled:true,draft:'Other synthetic draft',sentinel:'unchanged'},'The other tab and its draft remain intact.');
      assert.equal((await fetch(`http://127.0.0.1:${port}/json/close/${otherTarget.id}`)).ok,true,'The isolated second tab closes.');
      otherTab.close();otherTab=undefined;
      await until(async()=>!(await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).some(target=>target.id===otherTarget.id),'second tab closed');
    }
    await evaluate(tab,`(() => {window.confirm=()=>true;[...document.querySelectorAll('.update-notice button')].find(b=>b.textContent==='Clear old app caches').click()})()`);
    await until(()=>evaluate(tab,`navigator.serviceWorker.getRegistration().then(r=>!!r.waiting)`),'version B waits after cleanup');
    await until(()=>evaluate(tab,`[...document.querySelectorAll('.update-notice button')].some(b=>b.textContent==='Update now')`),'explicit update after cleanup');
    assert.equal(await evaluate(tab,`!!document.querySelector('[data-test-cache-build="b"]')`),false,'Cleanup does not activate the new build.');
    const remaining=await evaluate(tab,`caches.keys().then(a=>a.filter(n=>n.startsWith('image-studio-shell-')))`);
    if (remaining.some(n=>n.includes('synthetic-old-'))) {
      assert.equal(withOtherTab,true,'Single-tab cleanup removes all synthetic old shell fixtures.');
      assert.ok(await evaluate(tab,`document.querySelector('.update-notice')?.innerText.includes('cleanup stopped')`),'A partial cleanup is reported when an update starts during cleanup.');
    }
    assert.ok(remaining.includes(namesBefore.find(n=>!n.includes('synthetic-old-'))),'The active shell cache remains available.');
    assert.equal(await evaluate(tab,`caches.open('synthetic-unrelated-data').then(c=>c.match('/synthetic-marker')).then(r=>r?.text())`),'preserved','Unrelated cached data remains available.');
    await evaluate(tab,`[...document.querySelectorAll('.update-notice button')].find(b=>b.textContent==='Update now').click()`);
    await until(()=>evaluate(tab,`location.pathname===${JSON.stringify('/products/')}+${JSON.stringify(productId)} && !!document.querySelector('[data-test-cache-build="b"]')`),'product after explicit update');
    assert.equal(await evaluate(tab,`document.querySelector('h1').textContent`),'Synthetic cache recovery','The saved product survives cleanup and update.');
  } finally {
    otherTab?.close();tab?.close();if(browser&&browser.exitCode===null){browser.kill('SIGTERM');await Promise.race([new Promise(r=>browser.once('exit',r)),delay(3000)])}
    if(server)await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));await rm(root,{recursive:true,force:true});
  }
});
