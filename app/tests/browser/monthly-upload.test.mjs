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

test('Saved upload authorization survives reload, monthly history persists, and optional caps block without resetting usage', {timeout:180000}, async()=>{
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


  await until(()=>evaluate(tab,`!!document.querySelector('input[type=password]')&&!document.querySelector('input[type=password]').disabled`),'initial key form');
  assert.equal(await evaluate(tab,`document.querySelector('input[type=number]').value`),'','A monthly cap is optional and starts off');
  await evaluate(tab,`(()=>{const input=document.querySelector('input[type=password]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'sk-synthetic-persistent-browser-key');input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('form input[type=checkbox]').click()})()`);
  await until(()=>evaluate(tab,`!document.querySelector('form button[type=submit]').disabled`),'one-time upload authorization');await evaluate(tab,`document.querySelector('form button[type=submit]').click()`);
  await until(()=>evaluate(tab,`document.body.innerText.includes('Ready to create.')`),'saved upload permission');
  assert.equal(await evaluate(tab,`document.querySelector('.key-management').open`),false);
  await evaluate(tab,`location.hash='#/'`);
  await until(()=>evaluate(tab,`!!document.querySelector('input[aria-label="Upload product image"]')&&!document.querySelector('input[aria-label="Upload product image"]').disabled`),'first ready uploader');
  const installProviderFixture='(()=>{window.__paidRequests=0;const original=window.fetch;window.fetch=async(url,options)=>{if(String(url).startsWith(\'https:\')){if(String(url)!==\'https://api.openai.com/v1/images/generations\')throw Error(\'Unexpected provider endpoint\');window.__paidRequests++;const c=document.createElement(\'canvas\');c.width=c.height=1024;c.getContext(\'2d\').fillRect(0,0,1024,1024);return Response.json({data:[{b64_json:c.toDataURL(\'image/png\').split(\',\')[1]}]})}return original(url,options)};window.__uploadSynthetic=async()=>{const c=document.createElement(\'canvas\');c.width=200;c.height=140;c.getContext(\'2d\').fillRect(40,20,120,100);const d=new DataTransfer();d.items.add(new File([await new Promise(r=>c.toBlob(r,\'image/png\'))],\'synthetic-upload.png\',{type:\'image/png\'}));const f=document.querySelector(\'input[aria-label="Upload product image"]\');f.files=d.files;f.dispatchEvent(new Event(\'change\',{bubbles:true}))}})()';
  await evaluate(tab,installProviderFixture);

  await evaluate(tab,`window.__uploadSynthetic()`);
  await until(()=>evaluate(tab,`document.querySelector('#auto-results-heading')?.textContent==='7 of 7 ready'&&!document.querySelector('.auto-upload.processing')`),'first complete upload');
  assert.equal(await evaluate(tab,`window.__paidRequests`),6);
  await until(()=>evaluate(tab,`document.querySelector('.automatic-usage').innerText.includes('6 recorded requests')`),'monthly recorded request count');
  assert.equal(await evaluate(tab,`document.querySelector('.automatic-usage').innerText.includes('not your OpenAI bill')`),true);
  await evaluate(tab,`document.querySelectorAll('input[name=automatic-mode]')[1].click()`);await evaluate(tab,`document.querySelector('.automatic-options input[type=checkbox]').click()`);
  await tab.call('Page.reload');
  await until(()=>evaluate(tab,`!!document.querySelector('input[aria-label="Upload product image"]')&&!document.querySelector('input[aria-label="Upload product image"]').disabled`),'saved authorization reloads directly into usable Create');
  assert.equal(await evaluate(tab,`!!document.querySelector('.auto-setup')`),false,'No repeated setup after reload');
  await until(()=>evaluate(tab,`document.querySelector('.automatic-usage').innerText.includes('6 recorded requests')`),'monthly usage survives reload');
  await evaluate(tab,`document.querySelectorAll('input[name=automatic-mode]')[1].click()`);
  assert.equal(await evaluate(tab,`document.querySelector('.automatic-options input[type=checkbox]').checked`),false,'Reference transmission stays tab-only');
  assert.equal(await evaluate(tab,`document.querySelector('input[aria-label="Upload product image"]').disabled`),true);
  await evaluate(tab,`document.querySelectorAll('input[name=automatic-mode]')[0].click();location.hash='#/settings'`);
  await until(()=>evaluate(tab,`document.body.innerText.includes('Ready to create.')`),'returning settings ready');
  assert.equal(await evaluate(tab,`document.querySelector('.key-management').open`),false);
  assert.equal(await evaluate(tab,`document.querySelectorAll('form input[type=checkbox]').length`),0,'No repeated upload-consent checkbox');
  await evaluate(tab,`(()=>{document.querySelector('.key-management').open=true;document.querySelector('.key-management details').open=true;const input=document.querySelector('input[type=number]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'0.01');input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await evaluate(tab,`document.querySelector('form button[type=submit]').click()`);
  await until(()=>evaluate(tab,`(async()=>{const r=indexedDB.open('image-studio-credentials',2),db=await new Promise(resolve=>r.onsuccess=()=>resolve(r.result));try{return await new Promise(resolve=>{const q=db.transaction('credentials').objectStore('credentials').get('openai');q.onsuccess=()=>resolve(q.result.authorization.monthlyCapMicros===10000)})}finally{db.close()}})()`),'optional monthly cap saved');
  await evaluate(tab,`location.hash='#/'`);await until(()=>evaluate(tab,`!!document.querySelector('input[aria-label="Upload product image"]')&&!document.querySelector('input[aria-label="Upload product image"]').disabled`),'uploader with optional cap');
  await evaluate(tab,installProviderFixture);await evaluate(tab,`window.__uploadSynthetic()`);
  await until(()=>evaluate(tab,`document.querySelector('.auto-results')?.innerText.includes('optional monthly local estimate limit')`),'cap blocks before a provider send');
  assert.equal(await evaluate(tab,`window.__paidRequests`),0);
  await evaluate(tab,`location.hash='#/settings'`);await until(()=>evaluate(tab,`document.body.innerText.includes('Ready to create.')`),'cap management settings');
  await evaluate(tab,`(()=>{document.querySelector('.key-management').open=true;document.querySelector('.key-management details').open=true;const input=document.querySelector('input[type=number]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'');input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await evaluate(tab,`document.querySelector('form button[type=submit]').click()`);
  await until(()=>evaluate(tab,`(async()=>{const r=indexedDB.open('image-studio-credentials',2),db=await new Promise(resolve=>r.onsuccess=()=>resolve(r.result));try{return await new Promise(resolve=>{const q=db.transaction('credentials').objectStore('credentials').get('openai');q.onsuccess=()=>resolve(q.result.authorization.monthlyCapMicros===null)})}finally{db.close()}})()`),'optional cap can be turned off once');
  await evaluate(tab,`[...document.querySelectorAll('button')].find(b=>b.textContent==='Remove saved key').click()`);
  await until(()=>evaluate(tab,`document.body.innerText.includes('Add your OpenAI key')`),'key removed');
  assert.equal(await evaluate(tab,`document.querySelector('.automatic-usage').innerText.includes('6 recorded requests')`),true,'Removal retains month history');
 }catch(error){console.error('Pages journey failure:',error);throw error;}finally{tab?.close();await stopBrowser(browser);if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100})}
});
