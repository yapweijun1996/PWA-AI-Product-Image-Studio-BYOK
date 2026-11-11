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
  await tab.call('Page.reload');await until(()=>evaluate(tab,`document.readyState==='complete' && document.body.innerText.includes('Settings')`),'route reload');
  assert.equal(requests.some(p=>p.startsWith('/api/')),false,'Preview must not call gateway');
  await tab.call('Network.enable');await tab.call('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});await tab.call('Page.reload');
  await until(()=>evaluate(tab,`document.readyState==='complete' && document.body.innerText.includes('Settings')`),'offline reload');assert.equal(tab.events.filter(e=>e.method==='Runtime.exceptionThrown').length,0);
 }finally{tab?.close();browser?.kill();if(server)await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true})}
});
