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

test('Pages upload produces seven downloadable composites, retains partial results and works offline', {timeout:240000}, async()=>{
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
  await until(()=>evaluate(tab,`!!document.querySelector('h1') && document.body?.innerText.includes('Settings')`),'settings route');
  await until(()=>evaluate(tab,'!!navigator.serviceWorker.controller'),'worker');
  await until(()=>evaluate(tab,`!!document.querySelector('input[type=password]')`),'loaded key form');
  assert.equal(await evaluate(tab,`document.documentElement.lang`),'en');
  assert.match(await evaluate(tab,`document.querySelector('.app-version').textContent`),/^v0\.4\.0 · /);
  for(const [lang,title] of [['zh','设置'],['ms','Tetapan'],['ja','設定'],['ko','설정'],['vi','Cài đặt'],['en','Settings']]){
    await evaluate(tab,`document.querySelector('.language-control>.icon-button').click()`);
    await until(()=>evaluate(tab,`!!document.querySelector('.language-options')`),'language choices');
    await evaluate(tab,`document.querySelector('.language-option[lang="${lang}"]').click()`);
    await until(()=>evaluate(tab,`document.querySelector('h1')?.textContent===${JSON.stringify(title)}`),`${lang} translated settings`);
    assert.equal(await evaluate(tab,`localStorage.getItem('image-studio.language')`),lang);
    await tab.call('Emulation.setDeviceMetricsOverride',{width:320,height:900,deviceScaleFactor:1,mobile:true});
    assert.equal(await evaluate(tab,'document.documentElement.scrollWidth<=innerWidth'),true,`${lang} narrow settings`);
  }
  await evaluate(tab,`document.querySelector('.topbar-controls>.icon-button').click()`);
  await until(()=>evaluate(tab,`document.documentElement.dataset.theme==='dark'`),'icon dark mode');
  assert.equal(await evaluate(tab,`document.querySelector('meta[name="theme-color"]').content===getComputedStyle(document.documentElement).getPropertyValue('--page').trim()`),true);
  await evaluate(tab,`document.querySelector('.topbar-controls>.icon-button').click()`);
  await until(()=>evaluate(tab,`document.documentElement.dataset.theme==='light'`),'icon light mode');
  const updateBounds=()=>evaluate(tab,`(()=>{const box=document.querySelector('.sidebar-update').getBoundingClientRect(),button=document.querySelector('.sidebar-update button').getBoundingClientRect();return [box.x,box.y,box.width,box.height,button.x,button.y,button.width,button.height]})()`);
  const beforeUpdate=await updateBounds();
  await evaluate(tab,`window.__manualUpdateSentinel=true;document.querySelector('.sidebar-update button').click()`);
  await until(()=>evaluate(tab,`document.querySelector('.sidebar-update [role=status]').textContent==='No new version found.'`),'manual update check');
  assert.equal(await evaluate(tab,'window.__manualUpdateSentinel'),true,'Checking alone never reloads');
  await evaluate(tab,`(()=>{window.__originalUpdate=ServiceWorkerRegistration.prototype.update;window.__originalTimeout=window.setTimeout;ServiceWorkerRegistration.prototype.update=()=>new Promise(()=>{});window.setTimeout=(fn,ms,...args)=>window.__originalTimeout(fn,ms===15000?10:ms,...args);document.querySelector('.sidebar-update button').click()})()`);
  await until(()=>evaluate(tab,`document.querySelector('.sidebar-update [role=status]').textContent==='Update check failed. Try again.'&&!document.querySelector('.sidebar-update button').disabled`),'stalled update check recovers');
  assert.deepEqual(await updateBounds(),beforeUpdate,'Update failure must not shift the sidebar or resize the button');
  await evaluate(tab,`ServiceWorkerRegistration.prototype.update=window.__originalUpdate;window.setTimeout=window.__originalTimeout`);
  for(const width of [320,1280]){
    await tab.call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<500});
    const before=await updateBounds();
    await evaluate(tab,`ServiceWorkerRegistration.prototype.update=()=>new Promise(resolve=>window.__finishUpdate=resolve);document.querySelector('.sidebar-update button').click()`);
    await until(()=>evaluate(tab,`document.querySelector('.sidebar-update button').getAttribute('aria-busy')==='true' && !!window.__finishUpdate`),'checking update');
    assert.deepEqual(await updateBounds(),before,`Checking must preserve layout at ${width}px`);
    await evaluate(tab,`window.__finishUpdate();delete window.__finishUpdate;ServiceWorkerRegistration.prototype.update=window.__originalUpdate`);
    await until(()=>evaluate(tab,`!document.querySelector('.sidebar-update button').disabled`),'completed update');
    assert.deepEqual(await updateBounds(),before,`Completed check must preserve layout at ${width}px`);
  }


  await evaluate(tab,`location.hash='#/help'`);
  await until(()=>evaluate(tab,`document.querySelector('h1')?.textContent==='Upload. Get your images.'`),'Pages help route');
  for(const width of [320,375,1280]){
    await tab.call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<500});
    const layout=await evaluate(tab,`({overflow:document.documentElement.scrollWidth>innerWidth,steps:[...document.querySelectorAll('.guide-list section')].map(s=>({index:s.firstElementChild?.textContent,contentWidth:s.querySelector('div')?.getBoundingClientRect().width}))})`);
    assert.equal(layout.overflow,false,`Help page overflows at ${width}px`);
    assert.deepEqual(layout.steps.map(step=>step.index),['01','02','03']);
    assert.ok(layout.steps.every(step=>step.contentWidth>=Math.min(width-150,200)),`Help text is squeezed at ${width}px: ${JSON.stringify(layout.steps)}`);
    if(process.env.STUDIO_HELP_SCREENSHOT && width===1280){const shot=await tab.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(process.env.STUDIO_HELP_SCREENSHOT,Buffer.from(shot.data,'base64'));}
  }
  await evaluate(tab,`location.hash='#/settings'`);
  await until(()=>evaluate(tab,`!!document.querySelector('input[type=password]')`),'return to settings from help');
  for(const route of ['settings','images','design-system','help','workspace','import','products/new','missing-page']){
    await evaluate(tab,`location.hash='#/${route}'`);
    await until(()=>evaluate(tab,`!!document.querySelector('h1') && !document.body?.innerText.includes('Loading page…')`),'redesigned route');
    await delay(150);
    for(const theme of ['light','dark']){
      await evaluate(tab,`if(document.documentElement.dataset.theme!=='${theme}')document.querySelector('.topbar-controls>.icon-button').click()`);
      await until(()=>evaluate(tab,`document.documentElement.dataset.theme==='${theme}'`),'theme applied through control');
      for(const width of [320,390,768,1280]){
        await tab.call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<500});
        assert.equal(await evaluate(tab,'document.documentElement.scrollWidth<=innerWidth'),true,`${route} ${theme} overflows at ${width}`);
        if(route==='settings')assert.equal(await evaluate(tab,`[...document.querySelectorAll('input:not([type=checkbox])')].every(i=>parseFloat(getComputedStyle(i).fontSize)>=16)`),true,'iOS input text avoids focus zoom');
        if(process.env.STUDIO_UI_SHOTS && (width===390||width===1280)){
          const shot=await tab.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(`${process.env.STUDIO_UI_SHOTS}-${route.replaceAll('/','-')}-${theme}-${width}.png`,Buffer.from(shot.data,'base64'));
        }
      }
    }
  }
  await evaluate(tab,`if(document.documentElement.dataset.theme!=='light')document.querySelector('.topbar-controls>.icon-button').click();location.hash='#/settings'`);
  await until(()=>evaluate(tab,`!!document.querySelector('input[type=password]')`),'settings after visual checks');
  assert.equal(await evaluate(tab,'navigator.serviceWorker.ready.then(r=>new URL(r.scope).pathname)'),base);
  const manifest=JSON.parse(await readFile(join(out,'manifest.webmanifest'),'utf8'));assert.equal(new URL(manifest.start_url,`${origin}${base}manifest.webmanifest`).pathname,base);

  await evaluate(tab,`(()=>{const e=document.querySelector('input[type=password]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'sk-or-v1-synthetic-invalid-provider');e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await until(()=>evaluate(tab,`document.querySelector('#byok-error .error-badge')?.textContent==='API key issue'`),'wrong provider key badge before submission');
  assert.equal(await evaluate(tab,`document.querySelector('input[type=password]').getAttribute('aria-invalid')`),'true');
  if(process.env.STUDIO_UI_SHOTS){const shot=await tab.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(`${process.env.STUDIO_UI_SHOTS}-key-error.png`,Buffer.from(shot.data,'base64'));}
  assert.equal(await evaluate(tab,`document.querySelector('form button[type=submit]').disabled`),true);
  await evaluate(tab, `(() => {window.__providerCalls=0;const original=window.fetch;window.fetch=async(url,options)=>{if(String(url)==='https://api.openai.com/v1/images/generations'){window.__providerCalls++;if(window.__providerCalls===1)await new Promise(resolve=>window.__releaseFirst=resolve);const c=document.createElement('canvas');c.width=c.height=1024;c.getContext('2d').fillRect(0,0,1024,1024);return Response.json({data:[{b64_json:c.toDataURL('image/png').split(',')[1]}]})}return original(url,options)};const e=document.querySelector('input[type=password]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'sk-synthetic-browser-key-not-real');e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await evaluate(tab, `document.querySelector('input[type=password]').closest('form').querySelector('input[type=checkbox]').click();document.querySelector('input[type=password]').closest('form').querySelector('button').click()`);
  await until(()=>evaluate(tab,`document.body?.innerText.includes('Key available in this tab')`),'browser key connected');
  assert.equal(await evaluate(tab,`document.querySelector('input[type=password]').value`),'');
  const actionSpacing=await evaluate(tab,`(()=>{const buttons=[...document.querySelector('.session-actions').children].map(e=>e.getBoundingClientRect());return buttons.length===2 && (buttons[1].left-buttons[0].right>=10 || buttons[1].top-buttons[0].bottom>=10)})()`);
  assert.equal(actionSpacing,true,'Clear key and upload actions have a visible gap, including when wrapped');
  if(process.env.STUDIO_ACTIONS_SCREENSHOT){const shot=await tab.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(process.env.STUDIO_ACTIONS_SCREENSHOT,Buffer.from(shot.data,'base64'));}

  await evaluate(tab,`(()=>{const Original=Worker;window.Worker=class extends Original{constructor(...args){super(...args);this.addEventListener('message',e=>{if(e.data?.diagnostic)window.__matteDiagnostic=e.data.diagnostic})}}})()`);
  await evaluate(tab,`location.hash='#/'`);
  await until(()=>evaluate(tab,`!!document.querySelector('input[aria-label="Upload product image"]') && !document.querySelector('input[aria-label="Upload product image"]').disabled`),'automatic uploader');
  assert.equal(await evaluate(tab,`!!document.querySelector('#product-sku') || !!document.querySelector('#mask-tool') || !!document.querySelector('.style-plan')`),false);
  await evaluate(tab,`(async()=>{const c=document.createElement('canvas');c.width=200;c.height=100;const ctx=c.getContext('2d');${process.env.STUDIO_MATTE_SMOKE ? "ctx.fillStyle='white';ctx.fillRect(0,0,200,100);" : ''}ctx.fillStyle='#aa3311';ctx.fillRect(40,10,120,80);const blob=await new Promise(r=>c.toBlob(r,'image/png'));const d=new DataTransfer();d.items.add(new File([blob],'synthetic-product.png',{type:'image/png'}));const f=document.querySelector('input[aria-label="Upload product image"]');f.files=d.files;f.dispatchEvent(new Event('change',{bubbles:true}));})()`);

  await until(()=>evaluate(tab,`!!window.__releaseFirst && document.querySelectorAll('.image-placeholder[data-active=true]').length===1`),'one active image placeholder');
  assert.equal(await evaluate(tab,`document.querySelectorAll('.image-placeholder[data-active=false]').length`),5,'Queued cards are static; local detail is already ready');
  const pendingGeometry=await evaluate(tab,`[...document.querySelectorAll('.auto-result-image')].map(e=>[e.getBoundingClientRect().width,e.getBoundingClientRect().height])`);
  assert.equal(await evaluate(tab,`document.querySelector('.image-placeholder[data-active=true] .image-placeholder-art').getAnimations()[0]?.playState`),'running','Placeholder animation actually runs');
  await tab.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  assert.equal(await evaluate(tab,`getComputedStyle(document.querySelector('.image-placeholder[data-active=true] .image-placeholder-art')).animationName`),'none');
  assert.equal(await evaluate(tab,`document.querySelector('.image-placeholder[data-active=true]').textContent`),'Creating…');
  await tab.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  if(process.env.STUDIO_PENDING_SCREENSHOT){const shot=await tab.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(process.env.STUDIO_PENDING_SCREENSHOT,Buffer.from(shot.data,'base64'));}
  await evaluate(tab,`window.__releaseFirst()`);
  try{await until(()=>evaluate(tab,`(()=>{const heading=document.querySelector('#auto-results-heading')?.textContent;if(heading&&heading!=='7 of 7 ready'&&!document.querySelector('.auto-upload.processing'))throw new Error(document.querySelector('.auto-results').innerText);return heading==='7 of 7 ready'})()`),'seven automatic complete product images',process.env.STUDIO_MATTE_SMOKE?1800:150);}catch(error){console.log('Automatic status:',await evaluate(tab,`JSON.stringify({status:document.querySelector('.auto-results')?.innerText,diagnostic:window.__matteDiagnostic})`));throw error;}
  assert.equal(await evaluate(tab,'window.__providerCalls'),6,'One upload sends six distinct calls; detail stays local');
  assert.equal(await evaluate(tab,`document.querySelectorAll('.image-placeholder').length`),0,'Success removes placeholders');
  assert.deepEqual(await evaluate(tab,`[...document.querySelectorAll('.auto-result-image')].map(e=>[e.getBoundingClientRect().width,e.getBoundingClientRect().height])`),pendingGeometry,'Images retain placeholder geometry');

  await until(()=>evaluate(tab,`[...document.querySelectorAll('.auto-result img')].length===7&&[...document.querySelectorAll('.auto-result img')].every(i=>i.complete&&i.naturalWidth===1024)`),'rendered result images');
  assert.equal(await evaluate(tab,`document.querySelectorAll('.auto-result img').length`),7);
  assert.deepEqual(await evaluate(tab,`(()=>{const c=document.createElement('canvas');c.width=c.height=1024;const ctx=c.getContext('2d');ctx.drawImage(document.querySelector('.auto-result img'),0,0);return [...ctx.getImageData(512,512,1,1).data]})()`),[170,51,17,255],'Finished output contains original product pixels, not just the generated background');
  for(const width of [390,1280]){await tab.call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<500});assert.equal(await evaluate(tab,'document.documentElement.scrollWidth<=innerWidth'),true);}
  if(process.env.STUDIO_SCREENSHOT){const shot=await tab.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(process.env.STUDIO_SCREENSHOT,Buffer.from(shot.data,'base64'));}
  const downloads=join(root,'downloads');await mkdir(downloads);await tab.call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
  assert.equal(await evaluate(tab,`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent==='Download all');b.click();b.click();return true})()`),true);
  await until(()=>evaluate(tab,`[...document.querySelectorAll('button')].some(b=>b.textContent==='Preparing download…'&&b.disabled)`),'download pending feedback');
  await until(async()=>{const files=await readdir(downloads);return files.some(n=>n.endsWith('.zip'));},'automatic ZIP download');
  assert.equal((await readdir(downloads)).filter(n=>n.endsWith('.zip')).length,1,'Repeated download clicks prepare one archive');
  const archiveName=(await readdir(downloads)).find(n=>n.endsWith('.zip'));
  const archive=new ZipReader(new Uint8ArrayReader(new Uint8Array(await readFile(join(downloads,archiveName)))));
  const entries=await archive.getEntries();assert.equal(entries.filter(e=>e.filename.endsWith('.png')).length,7);
  const info=JSON.parse(await entries.find(e=>e.filename==='image-information.json').getData(new TextWriter()));assert.equal(info.humanApproval,false);assert.equal(info.validation,'AUTOMATIC_TECHNICAL_CHECKS_ONLY');await archive.close();
  await evaluate(tab,`location.hash='#/images'`);
  await until(()=>evaluate(tab,`!!document.querySelector('.library-card')`),'image library');
  assert.equal(await evaluate(tab,`document.querySelectorAll('.library-card').length>=1`),true);
  await evaluate(tab,`document.querySelector('.library-card').click()`);
  await until(()=>evaluate(tab,`document.querySelector('#auto-results-heading')?.textContent==='7 of 7 ready'`),'reopen saved results from library');
  await tab.call('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:true});
  await evaluate(tab,`window.scrollTo(0,document.body.scrollHeight)`);
  await until(()=>evaluate(tab,`!!document.querySelector('.scroll-top')`),'contextual back to top');
  await evaluate(tab,`document.querySelector('.scroll-top').click()`);
  await until(()=>evaluate(tab,`window.scrollY<5`),'back to top action');
  await evaluate(tab,`location.hash='#/workspace'`);
    await until(()=>evaluate(tab,`[...document.querySelectorAll('a')].some(a=>a.textContent==='Create product')`),'product creation link');
    await evaluate(tab,`[...document.querySelectorAll('a')].find(a=>a.textContent==='Create product').click()`);
    await until(()=>evaluate(tab,`!!document.querySelector('#product-sku')`),'product form');
    await evaluate(tab,`(() => {const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;for(const [id,value] of [['product-sku',crypto.randomUUID()],['product-name','Synthetic direct gateway test'],['product-category','Test']]){const e=document.getElementById(id);set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}))}document.querySelector('.form-card input[type="checkbox"]').click();document.querySelector('.form-card button[type="submit"]').click()})()`);
    const productId=await until(()=>evaluate(tab,`location.hash.startsWith('#/products/') && location.hash!=='#/products/new' && location.hash.split('/')[2]`),'created product');
    await until(()=>evaluate(tab,`!!document.querySelector('#source-file')`),'source upload');
    assert.equal(await evaluate(tab,`document.querySelector('.back-link').getAttribute('href')`),'#/workspace','Advanced back link returns to product list');
    for(const width of [320,768,1280]){
      await tab.call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<500});
      assert.equal(await evaluate(tab,`(()=>{const h=document.querySelector('h1'),saved=h.textContent;h.textContent='LongProductName'.repeat(20);const fits=document.documentElement.scrollWidth<=innerWidth;h.textContent=saved;return fits})()`),true,`Advanced long title at ${width}px`);
    }
    const detailRoute=await evaluate(tab,'location.hash');
    await evaluate(tab,`document.querySelector('.section-nav a[href="#export-stage"]').click()`);
    assert.equal(await evaluate(tab,'location.hash'),detailRoute,'Section navigation does not replace the hash route');
    await evaluate(tab,`window.scrollTo(0,0)`);
    if(process.env.STUDIO_UI_SHOTS){const shot=await tab.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(`${process.env.STUDIO_UI_SHOTS}-product-detail.png`,Buffer.from(shot.data,'base64'));}

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
  assert.equal(await evaluate(tab,'window.__providerCalls'),7);
  assert.equal(await evaluate(tab,`JSON.stringify([localStorage,sessionStorage]).includes('sk-synthetic-browser-key-not-real')`),false);
  const persistedLeak=await evaluate(tab,`(async()=>{const needle='sk-synthetic-browser-key-not-real';for(const dbName of ['product-image-studio','image-studio-automatic']){const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(dbName);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});try{for(const name of db.objectStoreNames){const rows=await new Promise((resolve,reject)=>{const r=db.transaction(name).objectStore(name).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});if(JSON.stringify(rows).includes(needle))return true}}finally{db.close()}}for(const name of await caches.keys()){const cache=await caches.open(name);for(const request of await cache.keys()){if(request.url.includes('api.openai.com')||JSON.stringify([...request.headers]).includes(needle)||(await(await cache.match(request)).text()).includes(needle))return true}}return false})()`);
  assert.equal(persistedLeak,false,'Key and provider requests must not enter image databases or caches');
  await evaluate(tab,`location.hash='#/'`);
  await until(()=>evaluate(tab,`!!document.querySelector('input[aria-label="Upload product image"]') && !document.querySelector('input[aria-label="Upload product image"]').disabled`),'second automatic upload');
  await evaluate(tab,`(()=>{const original=window.fetch;window.fetch=(url,options)=>{if(String(url)==='https://api.openai.com/v1/images/generations'&&window.__providerCalls===8){window.__providerCalls++;return Promise.reject(new Error('Synthetic interrupted request'))}return original(url,options)}})()`);
  await evaluate(tab,`(async()=>{const c=document.createElement('canvas');c.width=c.height=100;const ctx=c.getContext('2d');ctx.fillRect(20,20,60,60);const blob=await new Promise(r=>c.toBlob(r,'image/png')),d=new DataTransfer();d.items.add(new File([blob],'partial.png',{type:'image/png'}));const f=document.querySelector('input[aria-label="Upload product image"]');f.files=d.files;f.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await until(()=>evaluate(tab,`document.querySelector('#auto-results-heading')?.textContent==='2 of 7 ready' && document.querySelector('.auto-results')?.innerText.includes('Finished images are kept')`),'partial results retained');
  assert.equal(await evaluate(tab,'window.__providerCalls'),9,'UNKNOWN must not resend or send remaining styles');
  assert.equal(await evaluate(tab,`document.querySelector('input[aria-label="Upload product image"]').disabled`),true,'Unresolved billing hold is reflected before selecting another file');
  assert.equal(await evaluate(tab,`document.querySelectorAll('.image-placeholder[data-active=true]').length`),0,'Interrupted run stops every placeholder');
  assert.equal(await evaluate(tab,`document.querySelector('.auto-results .error-badge').textContent`),'Generation stopped');
  assert.equal(await evaluate(tab,`document.querySelector('.auto-results .error-notice a').getAttribute('href')`),'#/settings');
  if(process.env.STUDIO_UI_SHOTS){const shot=await tab.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(`${process.env.STUDIO_UI_SHOTS}-generation-error.png`,Buffer.from(shot.data,'base64'));}

  assert.equal(await evaluate(tab,`document.querySelectorAll('.auto-result img').length`),2);
  await evaluate(tab,`(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('image-studio-automatic',2);r.onsuccess=()=>resolve(r.result)});try{await new Promise((resolve,reject)=>{const tx=db.transaction('runs','readwrite'),store=tx.objectStore('runs'),r=store.getAll();r.onsuccess=()=>{const run=r.result.find(row=>row.items.some(i=>i.status==='UNKNOWN'));run.state='RUNNING';run.message=undefined;for(const item of run.items)if(item.status==='UNKNOWN')item.status='SUBMITTED';store.put(run)};tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})}finally{db.close()}})()`);
  await evaluate(tab,`location.hash='#/images'`);
  await until(()=>evaluate(tab,`!!document.querySelector('.library-card')`),'recovery library');
  await evaluate(tab,`document.querySelector('.library-card').click()`);
  await until(()=>evaluate(tab,`document.querySelector('.auto-results .error-notice')?.textContent.includes('may have been charged')`),'persisted in-flight recovery warning');
  assert.equal(await evaluate(tab,`document.querySelectorAll('.image-placeholder[data-active=true]').length`),0,'Restored in-flight records are not active animations');
  assert.equal(await evaluate(tab,'window.__providerCalls'),9,'Opening interrupted history never resends');

  await evaluate(tab,`location.hash='#/settings'`);
  await until(()=>evaluate(tab,`!!document.querySelector('input[type=password]')`),'return to settings');
  async function recoverSession(){
    await until(()=>evaluate(tab,`document.querySelectorAll('form input[type=checkbox]').length===2`),'recovery checkbox');
    await evaluate(tab,`(()=>{const e=document.querySelector('input[type=password]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'sk-synthetic-browser-key-not-real');e.dispatchEvent(new Event('input',{bubbles:true}));for(const box of document.querySelectorAll('form input[type=checkbox]'))if(!box.checked)box.click()})()`);
    await until(()=>evaluate(tab,`!document.querySelector('form button[type=submit]').disabled`),'recovery ready');
    await evaluate(tab,`document.querySelector('form button[type=submit]').click()`);
    await until(()=>evaluate(tab,`document.querySelector('input[type=password]').value==='' && document.body?.innerText.includes('Key available in this tab')`),'recovered session');
    await evaluate(tab,`location.hash='#/'`);
    await until(()=>evaluate(tab,`!!document.querySelector('input[aria-label="Upload product image"]') && !document.querySelector('input[aria-label="Upload product image"]').disabled`),'recovered uploader');
  }
  async function uploadAnother(){await evaluate(tab,`(async()=>{const c=document.createElement('canvas');c.width=c.height=100;c.getContext('2d').fillRect(20,20,60,60);const blob=await new Promise(r=>c.toBlob(r,'image/png')),d=new DataTransfer();d.items.add(new File([blob],'another.png',{type:'image/png'}));const f=document.querySelector('input[aria-label="Upload product image"]');f.files=d.files;f.dispatchEvent(new Event('change',{bubbles:true}))})()`);}
  await recoverSession();
  await evaluate(tab,`(()=>{const original=window.fetch;window.fetch=(url,options)=>{if(String(url)==='https://api.openai.com/v1/images/generations'&&window.__providerCalls===9){window.__providerCalls++;return Promise.resolve(Response.json({error:{message:'rate limited'}},{status:429}))}return original(url,options)}})()`);
  await uploadAnother();
  await until(()=>evaluate(tab,`document.querySelector('.auto-results')?.innerText.includes('Provider rate limit reached')`),'rate hold without header');
  assert.equal(await evaluate(tab,'window.__providerCalls'),10);
  await evaluate(tab,`location.hash='#/settings'`);await until(()=>evaluate(tab,`!!document.querySelector('input[type=password]')`),'rate recovery settings');
  await recoverSession();
  await evaluate(tab,`(()=>{const original=IDBObjectStore.prototype.put;window.__restorePut=()=>IDBObjectStore.prototype.put=original;IDBObjectStore.prototype.put=function(value,...args){if(this.transaction.db.name==='image-studio-automatic'&&value.items?.some(i=>i.status==='READY')){this.transaction.abort();throw new DOMException('synthetic quota','QuotaExceededError')}return original.call(this,value,...args)}})()`);
  await uploadAnother();
  await until(()=>evaluate(tab,`document.querySelector('#auto-results-heading')?.textContent==='1 of 7 ready' && document.querySelector('.auto-results')?.innerText.includes('only in this tab')`),'quota partial image retained');
  assert.equal(await evaluate(tab,'window.__providerCalls'),10,'Local detail quota failure stops before any new paid request');
  assert.equal(await evaluate(tab,`[...document.querySelectorAll('.auto-secondary button')].filter(b=>b.textContent.includes('/7')).every(b=>b.disabled)`),true,'History cannot replace unsaved paid outputs');
  assert.equal(await evaluate(tab,`!window.dispatchEvent(new Event('beforeunload',{cancelable:true}))`),true,'Unsaved paid output retains unload protection after processing stops');
  await evaluate(tab,`window.__confirmCount=0;window.confirm=()=>{window.__confirmCount++;return false};[...document.querySelectorAll('nav a')].find(a=>a.textContent==='Settings').click()`);
  await until(()=>evaluate(tab,'window.__confirmCount===1'),'unsaved result navigation guard');assert.equal(await evaluate(tab,'location.hash'),'#/');
  await evaluate(tab,`window.__restorePut();window.confirm=()=>true;[...document.querySelectorAll('button')].find(b=>b.textContent==='Start another upload').click()`);
  await until(()=>evaluate(tab,`!document.querySelector('#auto-results-heading')`),'explicit discard acknowledgement');
  await evaluate(tab,`location.hash='#/settings'`);await until(()=>evaluate(tab,`!!document.querySelector('input[type=password]')`),'final settings');
  await tab.call('Page.reload');await until(()=>evaluate(tab,`document.readyState==='complete' && document.body?.innerText.includes('Settings')`),'route reload');
  try{await until(()=>evaluate(tab,`document.body?.innerText.includes('Key available in this tab') && document.body?.innerText.includes('Saved on this device')`),'saved key restored');}catch(error){console.log('Restore diagnostic:',await evaluate(tab,`(async()=>({status:document.querySelector('.provider-settings')?.innerText,locks:await navigator.locks.query()}))()`));throw error;}
  assert.equal(await evaluate(tab,`document.querySelector('input[type=password]').value`),'','Stored key is never repopulated into the DOM');
  assert.equal(await evaluate(tab,`document.querySelector('form button[type=submit]').disabled`),true,'Restoring credentials does not restore spending consent');
  assert.equal(await evaluate(tab,`(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('image-studio-credentials',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});try{return await new Promise((resolve,reject)=>{const r=db.transaction('credentials').objectStore('credentials').get('openai');r.onsuccess=()=>resolve(r.result==='sk-synthetic-browser-key-not-real');r.onerror=()=>reject(r.error)})}finally{db.close()}})()`),true,'Owner-authorized key is stored only in the credential database');
  const secondTarget=await(await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`,{method:'PUT'})).json();
  const secondTab=await connect(secondTarget.webSocketDebuggerUrl);
  try{
    await until(()=>evaluate(secondTab,`document.body?.innerText.includes('Key available in this tab')`),'second tab restores credential');
    await evaluate(tab,`[...document.querySelectorAll('button')].find(b=>b.textContent==='Remove saved key').click()`);
    await until(()=>evaluate(tab,`document.body?.innerText.includes('No key connected')`),'local removal');
    await until(()=>evaluate(secondTab,`document.body?.innerText.includes('No key connected')`),'cross-tab removal');
  }finally{secondTab.close();await fetch(`http://127.0.0.1:${port}/json/close/${secondTarget.id}`)}
  await evaluate(tab,`window.__removedKeySentinel=true`);await tab.call('Page.reload');
  await until(()=>evaluate(tab,`!window.__removedKeySentinel && document.body?.innerText.includes('No key connected')`),'removed key stays removed after reload');

  assert.equal(requests.some(p=>p.startsWith('/api/')),false,'Preview must not call gateway');
  await tab.call('Network.enable');await tab.call('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});await tab.call('Page.reload');
  await until(()=>evaluate(tab,`document.readyState==='complete' && document.body?.innerText.includes('Settings')`),'offline reload');assert.equal(tab.events.filter(e=>e.method==='Runtime.exceptionThrown').length,0);
 }catch(error){console.error('Pages journey failure:',error);throw error;}finally{tab?.close();await stopBrowser(browser);if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100})}
});
