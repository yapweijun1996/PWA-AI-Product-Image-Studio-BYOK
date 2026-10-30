import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createGateway } from '../../gateway.mjs';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, mkdir, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';

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

test('protected mask gestures and approved export bundle remain consistent', { timeout: 90000 }, async () => {
  assert.ok(chrome && existsSync(chrome), 'Set CHROME_BIN to a Chromium executable before running browser tests.');
  const userDir = await mkdtemp(join(tmpdir(), 'studio-region-browser-'));
  const web=join(userDir,'gateway-web'), journal=join(userDir,'journal');
  await mkdir(web);await mkdir(journal,{mode:0o700});await writeFile(join(web,'index.html'),'synthetic gateway fixture');
  const token=randomBytes(32).toString('base64url');let imageData='', providerCalls=0, providerPayload;
  const gateway=await createGateway({authTokenHash:createHash('sha256').update(token).digest('hex'),providerConfigured:true,staticDirectory:web,imageGeneration:{enabled:true,apiKey:'synthetic-provider-fixture',journalDirectory:journal,transport:async (_url, request) => {providerCalls++;providerPayload=JSON.parse(request.body);return new Response(JSON.stringify({data:[{b64_json:imageData}]}),{status:200,headers:{'content-type':'application/json'}});}}});
  await new Promise((resolve,reject)=>{gateway.once('error',reject);gateway.listen(0,'127.0.0.1',resolve);});
  const gatewayOrigin=`http://127.0.0.1:${gateway.address().port}`;
  const vite = await createServer({ root: appRoot, configFile: join(appRoot, 'vite.config.ts'), logLevel: 'silent', server: { host: '127.0.0.1', port: 0, proxy:{'/api':{target:gatewayOrigin,changeOrigin:true,configure(proxy){proxy.on('proxyReq',(request,original)=>{if(original.headers.origin) request.setHeader('origin',gatewayOrigin);});}}} } });
  let browser, client;
  try {
    await vite.listen();
    const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
    browser = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${userDir}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', 'about:blank'], { stdio: 'ignore' });
    const port = await until(async () => { try { return Number((await readFile(join(userDir, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); } catch { return null; } }, 'isolated Chromium');
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const target = targets.find((item) => item.type === 'page');
    assert.ok(target?.webSocketDebuggerUrl, 'No isolated Chromium page was available.');
    client = await connect(target.webSocketDebuggerUrl);
    await client.call('Page.enable');
    await client.call('Page.bringToFront');
    await client.call('Emulation.setDeviceMetricsOverride', { width: 320, height: 800, deviceScaleFactor: 1, mobile: true });
    await client.call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
    await client.call('Page.navigate', { url: origin });
    await until(() => evaluate(client, `location.origin === ${JSON.stringify(origin)} && document.readyState === 'complete'`), 'application load');
    imageData=await evaluate(client, `(() => {const c=document.createElement('canvas');c.width=1024;c.height=1024;const x=c.getContext('2d');x.fillStyle='#225588';x.fillRect(0,0,1024,1024);return c.toDataURL('image/png').split(',')[1];})()`);
    await until(() => evaluate(client, `[...document.querySelectorAll('a')].some(a=>a.textContent==='Create product')`),'product creation link');
    await evaluate(client, `[...document.querySelectorAll('a')].find(a=>a.textContent==='Create product').click()`);
    await until(() => evaluate(client, `location.pathname==='/products/new' && !!document.querySelector('#product-sku')`),'product form');
    await evaluate(client, `(() => {const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;for(const [id,value] of [['product-sku',crypto.randomUUID()],['product-name','Synthetic region test'],['product-category','Test']]) {const e=document.getElementById(id);set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));}})()`);
    assert.equal(await evaluate(client, `document.querySelector('.form-card input[type="checkbox"]').validity.valueMissing`),true,'Image rights must be acknowledged.');
    await evaluate(client, `document.querySelector('.form-card button[type="submit"]').click()`);
    assert.equal(await evaluate(client, `location.pathname`),'/products/new','Submission without rights does not create a product.');
    await evaluate(client, `document.querySelector('.form-card input[type="checkbox"]').click()`);
    await evaluate(client, `document.querySelector('.form-card button[type="submit"]').click()`);
    const productId=await until(() => evaluate(client, `location.pathname.startsWith('/products/') && location.pathname !== '/products/new' && location.pathname.split('/')[2]`),'created product');
    await until(() => evaluate(client, `!!document.querySelector('#source-file')`),'source upload');
    const originalHash=await evaluate(client, `(async () => {const canvas=document.createElement('canvas');canvas.width=200;canvas.height=100;const ctx=canvas.getContext('2d');ctx.fillStyle='#a31';ctx.fillRect(0,0,200,100);const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('');const files=new DataTransfer();files.items.add(new File([blob],'synthetic.png',{type:'image/png'}));const input=document.querySelector('#source-file');input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}));return hash;})()`);
    await until(() => evaluate(client, `!!document.querySelector('#camera-view')`),'source preview');
    await evaluate(client, `(() => {const s=document.querySelector('#camera-view');s.value='FRONT';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await evaluate(client, `[...document.querySelectorAll('.source-panel button')].find(b=>b.textContent==='Save original').click()`);
    await until(() => evaluate(client, `document.querySelector('#mask-source')?.options.length > 1`),'saved synthetic source');
    const savedSourceHash=await evaluate(client, `(async () => {const p=await import('/src/products.ts');const product=await p.getProduct(${JSON.stringify(productId)});const source=product.sourceAssets[0];const blob=await p.loadOriginalSource(product.productId,source);return {hash:[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join(''),view:source.cameraView,rights:product.rightsAcknowledged};})()`);
    assert.deepEqual(savedSourceHash,{hash:originalHash,view:'FRONT',rights:true},'The uploaded original and chosen metadata are retained.');
    await evaluate(client, `(() => { const select = document.querySelector('#mask-source'); select.value = select.options[1].value; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await until(() => evaluate(client, `document.querySelector('#mask-tool') && !document.querySelector('.mask-regions')?.disabled`), 'mask editor');
    await evaluate(client, `(() => {const tool = document.querySelector('#mask-tool'); tool.value = 'region'; tool.dispatchEvent(new Event('change', { bubbles: true })); document.querySelector('.mask-viewport').scrollIntoView({ block: 'center' });})()`);
    const point = await evaluate(client, `(() => {const r = document.querySelector('canvas[aria-label="Mask drawing surface"]').getBoundingClientRect(); return {x: r.left + r.width * 0.2, y: r.top + r.height * 0.2, x2: r.left + r.width * 0.7, y2: r.top + r.height * 0.7};})()`);
    const touch = async (type, points) => client.call('Input.dispatchTouchEvent', { type, touchPoints: points });
    await touch('touchStart', [{ x: point.x, y: point.y, id: 0 }]);
    await touch('touchMove', [{ x: point.x2, y: point.y2, id: 0 }]);
    const during = await until(() => evaluate(client, `(async () => {
      const u = await import('/src/useUnsavedChanges.ts'); const b = [...document.querySelectorAll('button')].find((x) => x.textContent === 'Review mask');
      if (!document.querySelector('.mask-region-preview')) return null;
      const state = { disabled: b.disabled, source: document.querySelector('#mask-source').disabled, zoom: document.querySelector('#mask-zoom').disabled,
        regions: document.querySelector('.mask-regions').disabled, unsaved: u.hasUnsavedChanges() };
      b.click(); await new Promise((resolve) => setTimeout(resolve, 0));
      state.reviewOpened = document.body.innerText.includes('Continue editing'); return state;
    })()`), 'active region preview');
    assert.deepEqual(during, { disabled: true, source: true, zoom: true, regions: true, unsaved: true, reviewOpened: false });
    await touch('touchEnd', []);
    await until(() => evaluate(client, `document.querySelectorAll('.mask-region').length === 1 && !document.querySelector('.mask-region-preview')`), 'committed region');
    const first = await evaluate(client, `[...document.querySelector('.mask-region').querySelectorAll('input')].map((input) => Number(input.value))`);
    const [x, y, width, height] = first;
    assert.ok(x >= 39 && x <= 40 && y >= 19 && y <= 20, 'Selection starts near the touched source pixel.');
    assert.ok(x + width >= 140 && x + width <= 141 && y + height >= 70 && y + height <= 71, 'Selection covers the touched end point.');
    await touch('touchStart', [{ x: point.x, y: point.y, id: 0 }]);
    await touch('touchMove', [{ x: point.x2, y: point.y2, id: 0 }]);
    await until(() => evaluate(client, `!!document.querySelector('.mask-region-preview')`), 'second preview');
    await touch('touchCancel', []);
    await until(() => evaluate(client, `!document.querySelector('.mask-region-preview') && document.body.innerText.includes('Unfinished protected area discarded')`), 'cancellation');
    assert.equal(await evaluate(client, `document.querySelectorAll('.mask-region').length`), 1);
    const enabled = await evaluate(client, `({review: ![...document.querySelectorAll('button')].find((x) => x.textContent === 'Review mask').disabled, source: !document.querySelector('#mask-source').disabled, zoom: !document.querySelector('#mask-zoom').disabled, regions: !document.querySelector('.mask-regions').disabled})`);
    assert.deepEqual(enabled, { review: true, source: true, zoom: true, regions: true });
    await evaluate(client, `[...document.querySelectorAll('button')].find((x) => x.textContent === 'Review mask').click()`);
    await until(() => evaluate(client, `[...document.querySelectorAll('button')].some((x) => x.textContent === 'Save mask')`), 'mask review');
    await evaluate(client, `[...document.querySelectorAll('button')].find((x) => x.textContent === 'Save mask').click()`);
    await until(() => evaluate(client, `document.body.innerText.includes('Mask saved')`), 'mask save');
    const saved = await evaluate(client, `(async () => { const p=await import('/src/products.ts'); const product=await p.getProduct(${JSON.stringify(productId)}); const mask=await p.loadSourceMask(product.productId, product.sourceAssets[0]); const image=await createImageBitmap(mask.blob); const canvas=document.createElement('canvas'); canvas.width=image.width; canvas.height=image.height; const ctx=canvas.getContext('2d'); ctx.drawImage(image,0,0); image.close(); const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data; let nonOpaque=0; for(let i=3;i<pixels.length;i+=4) if(pixels[i]!==255) nonOpaque++; return {regions:mask.protectedEvidence.regions,nonOpaque}; })()`);
    assert.deepEqual(saved, { regions: [{ x, y, width, height }], nonOpaque: 0 });
    const initialSourceHash = await evaluate(client, `(async () => {const p=await import('/src/products.ts');const product=await p.getProduct(${JSON.stringify(productId)});return product.sourceAssets[0].sha256;})()`);
    await evaluate(client, `(() => {const t=document.querySelector('#mask-tool'); t.value='erase'; t.dispatchEvent(new Event('change',{bubbles:true})); document.querySelector('.mask-viewport').scrollIntoView({block:'center'});})()`);
    const brush = await evaluate(client, `(() => {const r=document.querySelector('canvas[aria-label="Mask drawing surface"]').getBoundingClientRect(); return {x:r.left+r.width*.1,y:r.top+r.height*.1,x2:r.left+r.width*.9,y2:r.top+r.height*.1};})()`);
    await evaluate(client, `window.trace=[]; ['pointerdown','pointerup','pointermove','pointercancel','lostpointercapture'].forEach(n=>document.querySelector('canvas[aria-label="Mask drawing surface"]').addEventListener(n,e=>window.trace.push([n,e.pointerId,e.isPrimary,e.clientX,e.clientY,e.pointerType])))`);
    await touch('touchStart', [{x:brush.x,y:brush.y,id:0}]);
    await touch('touchStart', [{x:brush.x,y:brush.y,id:0},{x:brush.x+3,y:brush.y+3,id:1}]);
    await evaluate(client, `document.querySelector('canvas[aria-label="Mask drawing surface"]').dispatchEvent(new PointerEvent('pointercancel', {bubbles:true, pointerId:999, pointerType:'touch', isPrimary:false}))`);
    await touch('touchMove', [{x:(brush.x+brush.x2)/2,y:brush.y,id:0},{x:brush.x+3,y:brush.y+3,id:1}]);
    const midAlpha = await evaluate(client, `(() => {const c=document.querySelector('canvas[aria-label="Mask drawing surface"]'); return c.getContext('2d').getImageData(Math.floor(c.width*.5),Math.floor(c.height*.1),1,1).data[3];})()`);
    assert.equal(midAlpha, 0, 'Primary brush continues after a secondary pointer is cancelled.');
    await touch('touchEnd', [{x:brush.x+3,y:brush.y+3,id:1}]);
    await touch('touchMove', [{x:brush.x2,y:brush.y2,id:0}]);
    await touch('touchEnd', []);
    const alpha = await evaluate(client, `(() => {const c=document.querySelector('canvas[aria-label="Mask drawing surface"]'); return c.getContext('2d').getImageData(Math.floor(c.width*.9),Math.floor(c.height*.1),1,1).data[3];})()`);
    const trace = await evaluate(client, 'window.trace');
    assert.ok(trace.some(([type, , primary]) => type === 'pointerup' && !primary), 'The secondary pointer ended.');
    assert.ok(trace.some(([type, , primary, x]) => type === 'pointermove' && primary && x > brush.x2 - 1), 'The primary pointer moved after the secondary pointer ended.');
    assert.equal(alpha, 0, 'Primary brush continues after the secondary touch ends.');
    const mixed = await evaluate(client, `(() => {const r=document.querySelector('canvas[aria-label="Mask drawing surface"]').getBoundingClientRect(); return {x:r.left+r.width*.1,y:r.top+r.height*.9,x2:r.left+r.width*.9,y2:r.top+r.height*.9};})()`);
    await touch('touchStart', [{x:mixed.x,y:mixed.y,id:0}]);
    await client.call('Input.dispatchMouseEvent', {type:'mousePressed',x:mixed.x+20,y:mixed.y,button:'left',buttons:1,clickCount:1});
    await evaluate(client, `document.querySelector('canvas[aria-label="Mask drawing surface"]').dispatchEvent(new PointerEvent('pointercancel', {bubbles:true, pointerId:1, pointerType:'mouse', isPrimary:true}))`);
    await client.call('Input.dispatchMouseEvent', {type:'mouseReleased',x:mixed.x+20,y:mixed.y,button:'left',buttons:0,clickCount:1});
    await touch('touchMove', [{x:mixed.x2,y:mixed.y2,id:0}]);
    await touch('touchEnd', []);
    const mixedAlpha = await evaluate(client, `(() => {const c=document.querySelector('canvas[aria-label="Mask drawing surface"]');return c.getContext('2d').getImageData(Math.floor(c.width*.9),Math.floor(c.height*.9),1,1).data[3];})()`);
    const mixedTrace = await evaluate(client, 'window.trace');
    assert.ok(mixedTrace.some(([type, , primary, , , pointerType]) => type === 'pointerup' && primary && pointerType === 'mouse'), 'A primary mouse pointer ended.');
    assert.ok(mixedTrace.some(([type, , primary, x, , pointerType]) => type === 'pointermove' && primary && pointerType === 'touch' && x > mixed.x2 - 1), 'The primary touch continued afterward.');
    assert.equal(mixedAlpha,0,'Primary touch brush continues when a primary mouse pointer ends.');

    await evaluate(client, `[...document.querySelectorAll('button')].find((x) => x.textContent === 'Review mask').click()`);
    await until(() => evaluate(client, `[...document.querySelectorAll('button')].some((x) => x.textContent === 'Save mask')`), 'brush mask review');
    await evaluate(client, `[...document.querySelectorAll('button')].find((x) => x.textContent === 'Save mask').click()`);
    await until(() => evaluate(client, `document.body.innerText.includes('Mask saved') && [...document.querySelectorAll('button')].some((x) => x.textContent === 'Review mask')`), 'brush mask save');
    const persisted = await evaluate(client, `(async () => {const p=await import('/src/products.ts'); const product=await p.getProduct(${JSON.stringify(productId)}); const source=product.sourceAssets[0]; const original=await p.loadOriginalSource(product.productId,source); const actualHash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await original.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join(''); const mask=await p.loadSourceMask(product.productId,source); const image=await createImageBitmap(mask.blob); const canvas=document.createElement('canvas'); canvas.width=image.width; canvas.height=image.height; const ctx=canvas.getContext('2d'); ctx.drawImage(image,0,0); image.close(); return {regions:mask.protectedEvidence.regions, middle:ctx.getImageData(100,10,1,1).data[3], end:ctx.getImageData(180,10,1,1).data[3], protected:ctx.getImageData(100,50,1,1).data[3],sourceHash:source.sha256,actualHash};})()`);
    assert.deepEqual({regions:persisted.regions,middle:persisted.middle,end:persisted.end,protected:persisted.protected}, {regions:[{x,y,width,height}],middle:0,end:0,protected:255});
    assert.equal(persisted.actualHash, initialSourceHash);
    assert.equal(persisted.sourceHash, initialSourceHash);
    await client.call('Page.reload');
    await until(() => evaluate(client, `document.querySelector('#mask-source')?.options.length > 1`), 'reloaded source');
    await evaluate(client, `(() => {const s=document.querySelector('#mask-source');s.value=s.options[1].value;s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await until(() => evaluate(client, `document.querySelectorAll('.mask-region').length === 1 && document.querySelector('canvas[aria-label="Mask drawing surface"]')?.width === 200 && [...document.querySelectorAll('button')].some(b => b.textContent === 'Review mask' && !b.disabled)`), 'reloaded mask');
    const reopened = await until(() => evaluate(client, `(async () => {const c=document.querySelector('canvas[aria-label="Mask drawing surface"]'); const alpha=c.getContext('2d').getImageData(100,10,1,1).data[3]; if(alpha!==0) return null; const p=await import('/src/products.ts');const product=await p.getProduct(${JSON.stringify(productId)});return {middle:alpha,end:c.getContext('2d').getImageData(180,10,1,1).data[3],protected:c.getContext('2d').getImageData(100,50,1,1).data[3],sourceHash:product.sourceAssets[0].sha256,regions:[...document.querySelector('.mask-region').querySelectorAll('input')].map(i=>Number(i.value))};})()`), 'reloaded brush pixels');
    assert.deepEqual(reopened,{middle:0,end:0,protected:255,sourceHash:persisted.sourceHash,regions:[x,y,width,height]});
    const exportFixture = await evaluate(client, `(async () => {
      const p=await import('/src/products.ts'), c=await import('/src/strictComposite.ts'), policy=await import('/studio-policy.mjs');
      const product=await p.getProduct(${JSON.stringify(productId)}), source=product.sourceAssets[0];
      const mask=await p.loadSourceMask(product.productId,source);
      const attempt={attemptId:crypto.randomUUID(),jobId:crypto.randomUUID(),productId:product.productId,sourceAssetId:source.assetId,sourceSha256:source.sha256,maskId:mask.maskId,maskSha256:mask.sha256,prompt:policy.STUDIO_PROMPT,promptVersion:policy.STUDIO_PROMPT_VERSION,model:policy.STUDIO_MODEL,quality:policy.STUDIO_QUALITY,size:policy.STUDIO_SIZE,estimatedUSD:policy.studioEstimateUSD(),submittedAt:new Date().toISOString(),status:'PREPARED',usage:null,observedUSD:null};
      const fingerprint=await p.globalStudioReviewFingerprint(); await p.createStudioAttempt(attempt,fingerprint); await p.updateStudioAttempt({...attempt,status:'SUBMITTED'},undefined,fingerprint);
      const sceneCanvas=document.createElement('canvas');sceneCanvas.width=1024;sceneCanvas.height=1024;const ctx=sceneCanvas.getContext('2d');ctx.fillStyle='#225588';ctx.fillRect(0,0,1024,1024);
      const blob=await new Promise(r=>sceneCanvas.toBlob(r,'image/png'));const bytes=await blob.arrayBuffer();const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
      const scene={assetId:crypto.randomUUID(),productId:product.productId,attemptId:attempt.attemptId,blob,sha256};await p.updateStudioAttempt({...attempt,status:'DEFINITIVE_SUCCESS'},scene);
      const inputs=await p.loadStrictCompositeInputs(product.productId,attempt.attemptId,scene.assetId);const rendered=await c.renderStrictCompositePixels(inputs);const composite=await p.saveStrictComposite(product.productId,attempt.attemptId,inputs,rendered.blob,rendered.mapping);
      const history=await p.listVisualReviews(product.productId,attempt.attemptId,composite.assetId);const scores={design:'5',typography:'5',geometry:'5',realism:'5',style:'5'};const matches={product:'MATCH',typography:'MATCH',claims:'MATCH',viewpoint:'MATCH',source:'MATCH',mask:'MATCH'};
      const report=await p.createVisualReview(product.productId,attempt.attemptId,composite.assetId,scores,matches,'default','Synthetic fixture',history.productSha256,composite.sha256,undefined,undefined,undefined,undefined,[],composite.protectedEvidenceSha256);
      const decision=await p.recordVisualDecision(product.productId,attempt.attemptId,composite.assetId,report.qaId,'APPROVED');return {attemptId:attempt.attemptId,assetId:composite.assetId,reviewId:report.qaId,decisionId:decision.qaId,sourceHash:source.sha256};
    })()`);
    await client.call('Page.reload');
    await until(() => evaluate(client, `document.querySelector('.approved-export')?.innerText.includes(${JSON.stringify(exportFixture.assetId)})`), 'approved export candidate');
    await until(() => evaluate(client, `[...document.querySelectorAll('.strict-composite button')].some(b=>b.textContent==='Prepare local composite' && !b.disabled)`),'composite inputs');
    await evaluate(client, `[...document.querySelectorAll('.strict-composite button')].find(b=>b.textContent==='Prepare local composite').click()`);
    await until(() => evaluate(client, `!!document.querySelector('.strict-composite [aria-label="Original source zoom area"]')`),'unsaved composite preview');
    assert.ok(await evaluate(client, `document.querySelector('.strict-composite input[type="range"]').getBoundingClientRect().height`) >= 44, 'Composite zoom has a usable touch target.');
    for (const width of [320,390,1280]) {
      await client.call('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:width<800});
      const state=await evaluate(client, `(() => {const panes=['Original source zoom area','Composite zoom area'].map(name=>{const r=document.querySelector('[aria-label="'+name+'"]').getBoundingClientRect();return {y:r.y,width:r.width,height:r.height};});return {panes,overflow:document.documentElement.scrollWidth>innerWidth};})()`);
      assert.equal(state.overflow,false);
      if(width<800) assert.ok(state.panes[1].y>state.panes[0].y+state.panes[0].height && state.panes.every(p=>p.width>=220));
      else assert.ok(Math.abs(state.panes[0].y-state.panes[1].y)<1);
    }
    await client.call('Emulation.setDeviceMetricsOverride',{width:320,height:800,deviceScaleFactor:1,mobile:true});
    await evaluate(client, `[...document.querySelectorAll('.strict-composite button')].find(b=>b.textContent==='Discard preview').click()`);
    await until(() => evaluate(client, `!document.querySelector('.strict-composite [aria-label="Original source zoom area"]')`),'discarded composite preview');
    await evaluate(client, `[...document.querySelectorAll('.strict-composite button')].find(b=>b.textContent==='Prepare local composite').click()`);
    await until(() => evaluate(client, `[...document.querySelectorAll('.strict-composite button')].some(b=>b.textContent==='Save unapproved composite')`),'second composite preview');
    await evaluate(client, `[...document.querySelectorAll('.strict-composite button')].find(b=>b.textContent==='Save unapproved composite').click()`);
    await until(() => evaluate(client, `document.querySelector('.strict-composite')?.innerText.includes('Unapproved composite saved locally.')`),'saved unapproved composite');
    const compositeIds=await evaluate(client, `(async () => {const p=await import('/src/products.ts');return (await p.listStrictComposites(${JSON.stringify(productId)},${JSON.stringify(exportFixture.attemptId)})).map(c=>c.assetId);})()`);
    assert.equal(compositeIds.length,2);assert.ok(compositeIds.includes(exportFixture.assetId));
    await until(() => evaluate(client, `[...document.querySelectorAll('summary')].some(s=>s.textContent==='Review this composite')`),'composite review disclosure');
    await evaluate(client, `[...document.querySelectorAll('summary')].find(s=>s.textContent==='Review this composite').click()`);
    await until(() => evaluate(client, `document.querySelectorAll('.visual-review .strict-comparison .strict-zoom').length===2`),'review comparison');
    assert.ok(await evaluate(client, `document.querySelector('.visual-review input[type="range"]').getBoundingClientRect().height`) >= 44, 'Review zoom has a usable touch target.');
    const reviewLayout=await evaluate(client, `[...document.querySelectorAll('.visual-review .strict-comparison .strict-zoom')].map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})`);
    assert.equal(await evaluate(client, `document.querySelectorAll('.visual-review .strict-comparison figcaption')[1].textContent`), 'Composite under review · 1024 × 1024');
    assert.ok(reviewLayout.every(p=>p.width>=180),'Review previews need sufficient mobile width.');
    assert.ok(reviewLayout[1].y>reviewLayout[0].y+reviewLayout[0].height,'Mobile review previews stack vertically.');
    await evaluate(client, `(() => {const e=document.querySelector('.visual-review input[type="range"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'200');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await until(() => evaluate(client, `document.querySelector('.visual-review [aria-label="Review composite zoom area"] img')?.style.width==='200%'`),'review zoom');
    await evaluate(client, `document.querySelector('.visual-review label.checkbox-label input').click()`);
    await until(() => evaluate(client, `document.querySelector('.visual-review [aria-label="Review composite zoom area"] img')?.style.width==='1024px'`),'native-pixel review');
    const native=await evaluate(client, `(() => {const e=document.querySelector('.visual-review [aria-label="Review composite zoom area"]');return {client:e.clientWidth,scroll:e.scrollWidth,tab:e.tabIndex};})()`);
    assert.ok(native.scroll>native.client && native.tab===0,'Native review is scrollable and keyboard focusable.');
    for (const width of [390,1280]) {
      await client.call('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:width<800});
      const state=await evaluate(client, `(() => {const panes=[...document.querySelectorAll('.visual-review .strict-comparison .strict-zoom')].map(e=>{const r=e.getBoundingClientRect();return {y:r.y,width:r.width,height:r.height}});return {panes,overflow:document.documentElement.scrollWidth>innerWidth};})()`);
      assert.equal(state.overflow,false);
      if(width===390) assert.ok(state.panes[1].y>state.panes[0].y+state.panes[0].height && state.panes.every(p=>p.width>=250));
      else assert.ok(Math.abs(state.panes[0].y-state.panes[1].y)<1);
    }
    await client.call('Emulation.setDeviceMetricsOverride',{width:320,height:800,deviceScaleFactor:1,mobile:true});
    await evaluate(client, `[...document.querySelectorAll('summary')].find(s=>s.textContent==='Review this composite').click()`);
    assert.equal(await evaluate(client, `[...document.querySelectorAll('summary')].find(s=>s.textContent==='Review this composite').parentElement.open`),false);
    await evaluate(client, `[...document.querySelectorAll('summary')].find(s=>s.textContent==='Review this composite').click()`);
    await until(() => evaluate(client, `[...document.querySelectorAll('summary')].find(s=>s.textContent==='Review this composite').parentElement.open`),'reopened review');
    const newCompositeId=compositeIds.find(id=>id!==exportFixture.assetId);
    assert.ok(newCompositeId);
    assert.equal(await evaluate(client, `document.querySelector('.visual-review h5').id`), `review-heading-${newCompositeId}`);
    await evaluate(client, `(() => {const form=document.querySelector('.visual-review form');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;for(const input of form.querySelectorAll('input[type="number"]')) {setter.call(input,'5');input.dispatchEvent(new Event('input',{bubbles:true}));}for(const select of form.querySelectorAll('select')) {select.value=select.id.startsWith('qa-variant-')?'default':'MATCH';select.dispatchEvent(new Event('change',{bubbles:true}));}})()`);
    await until(() => evaluate(client, `document.querySelector('.visual-review form')?.innerText.includes('Proposed status: PASS_CANDIDATE')`),'passing review evaluation');
    await evaluate(client, `(() => {const f=document.querySelector('.visual-review form'),select=f.querySelectorAll('select')[2],note=f.querySelector('textarea');select.value='MISMATCH';select.dispatchEvent(new Event('change',{bubbles:true}));Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(note,'Synthetic label mismatch');note.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await evaluate(client, `[...document.querySelector('.visual-review form').querySelectorAll('button')].find(b=>b.textContent==='Add finding').click()`);
    await until(() => evaluate(client, `[...document.querySelectorAll('.visual-review fieldset legend')].some(l=>l.textContent==='Finding 1')`),'blocker finding');
    await evaluate(client, `(() => {const legend=[...document.querySelectorAll('.visual-review fieldset legend')].find(l=>l.textContent==='Finding 1'),f=legend.parentElement,note=f.querySelector('textarea'),location=f.querySelectorAll('select')[1],severity=f.querySelectorAll('select')[0];severity.value='BLOCKER';severity.dispatchEvent(new Event('change',{bubbles:true}));Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(note,'Synthetic label mismatch');note.dispatchEvent(new Event('input',{bubbles:true}));location.value='global';location.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await until(() => evaluate(client, `document.querySelector('.visual-review form')?.innerText.includes('Proposed status: REJECTED')`),'mismatch veto');
    await evaluate(client, `(() => {const f=document.querySelector('.visual-review form');[...f.querySelectorAll('label')].find(x=>x.innerText.includes('I personally compared')).querySelector('input').click();})()`);
    await until(() => evaluate(client, `![...document.querySelector('.visual-review form').querySelectorAll('button')].find(b=>b.textContent==='Save this human review').disabled`),'veto review confirmation');
    await evaluate(client, `[...document.querySelector('.visual-review form').querySelectorAll('button')].find(b=>b.textContent==='Save this human review').click()`);
    await until(() => evaluate(client, `document.querySelector('.visual-review')?.innerText.includes('Last checked review: REJECTED')`),'saved veto review');
    assert.equal(await evaluate(client, `[...document.querySelectorAll('.visual-review button')].find(b=>b.textContent==='Choose approval').disabled`),true,'A maximum score cannot override the mismatch.');
    assert.equal(await evaluate(client, `(async () => {const p=await import('/src/products.ts');return (await p.listApprovedExportCandidates(${JSON.stringify(productId)})).some(x=>x.assetId===${JSON.stringify(newCompositeId)});})()`),false,'The vetoed composite is not an export candidate.');
    await evaluate(client, `(() => {const f=document.querySelector('.visual-review form');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;for(const input of f.querySelectorAll('input[type="number"]')) {setter.call(input,'5');input.dispatchEvent(new Event('input',{bubbles:true}));}for(const select of f.querySelectorAll('select')) {select.value=select.id.startsWith('qa-variant-')?'default':'MATCH';select.dispatchEvent(new Event('change',{bubbles:true}));}})()`);
    await until(() => evaluate(client, `document.querySelector('.visual-review form')?.innerText.includes('Proposed status: PASS_CANDIDATE')`),'fresh passing review');
    await evaluate(client, `(() => {const f=document.querySelector('.visual-review form');[...f.querySelectorAll('label')].find(x=>x.innerText.includes('I personally compared')).querySelector('input').click();})()`);
    await until(() => evaluate(client, `![...document.querySelector('.visual-review form').querySelectorAll('button')].find(b=>b.textContent==='Save this human review').disabled`),'review confirmation');
    await evaluate(client, `[...document.querySelector('.visual-review form').querySelectorAll('button')].find(b=>b.textContent==='Save this human review').click()`);
    await until(() => evaluate(client, `document.querySelector('.visual-review')?.innerText.includes('Review recorded.') && [...document.querySelectorAll('.visual-review button')].some(b=>b.textContent==='Choose approval' && !b.disabled)`),'saved review');
    await evaluate(client, `[...document.querySelectorAll('.visual-review button')].find(b=>b.textContent==='Choose approval').click()`);
    assert.equal(await evaluate(client, `[...document.querySelectorAll('.visual-review button')].find(b=>b.textContent==='Record approved decision').disabled`),true);
    await evaluate(client, `[...document.querySelectorAll('.visual-review label')].find(l=>l.innerText.includes('I explicitly approve')).querySelector('input').click()`);
    await until(() => evaluate(client, `![...document.querySelectorAll('.visual-review button')].find(b=>b.textContent==='Record approved decision').disabled`),'decision confirmation');
    await evaluate(client, `[...document.querySelectorAll('.visual-review button')].find(b=>b.textContent==='Record approved decision').click()`);
    await until(() => evaluate(client, `document.querySelector('.visual-review')?.innerText.includes('decision APPROVED')`),'recorded decision');
    const uiDecision=await evaluate(client, `(async () => {const p=await import('/src/products.ts');const h=await p.listVisualReviews(${JSON.stringify(productId)},${JSON.stringify(exportFixture.attemptId)},${JSON.stringify(newCompositeId)});const d=h.decisions.find(x=>x.current),r=h.reviews.find(x=>x.qaId===d.reportId);return {reviewId:r.qaId,decisionId:d.qaId,decision:d.decision};})()`);
    assert.equal(uiDecision.decision,'APPROVED');Object.assign(exportFixture,{assetId:newCompositeId,reviewId:uiDecision.reviewId,decisionId:uiDecision.decisionId});
    await evaluate(client, `window.__beforeExportReload=true`);
    await client.call('Page.reload');
    await until(() => evaluate(client, `window.__beforeExportReload!==true && document.querySelector('.approved-export')?.innerText.includes(${JSON.stringify(exportFixture.assetId)})`),'newly approved export candidate after reload');


    await evaluate(client, `(() => {const panel=document.querySelector('.approved-export');const field=[...panel.querySelectorAll('label')].find(x=>x.innerText.includes(${JSON.stringify(exportFixture.assetId)}));field.querySelector('input').click();[...panel.querySelectorAll('button')].find(x=>x.textContent==='Prepare converted previews').click()})()`);
    await until(() => evaluate(client, `document.querySelector('.approved-export')?.innerText.includes('Inspect converted outputs')`), 'converted preview');
    await evaluate(client, `document.querySelector('.approved-export .strict-comparison').scrollIntoView({block:'start'})`);
    const layout = await evaluate(client, `Array.from(document.querySelectorAll('.approved-export .strict-zoom')).map(el=>{const r=el.getBoundingClientRect();return {width:r.width,x:r.x,y:r.y,height:r.height}})`);
    assert.ok(layout.every(r=>r.width>=220),'Mobile previews have enough width for inspection.');
    assert.ok(layout[1].y > layout[0].y + layout[0].height,'Mobile previews stack vertically.');
    await evaluate(client, `document.querySelector('.approved-export .strict-zoom').focus()`);
    await client.call('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
    await client.call('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
    await until(() => evaluate(client, `document.querySelector('.approved-export .strict-zoom').scrollLeft > 0`),'keyboard scrolling');
    for (const width of [390,1280]) {
      await client.call('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:width<800});
      const state=await evaluate(client, `(() => {const panes=[...document.querySelectorAll('.approved-export .strict-zoom')].map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}});return {panes,overflow:document.documentElement.scrollWidth>innerWidth};})()`);
      assert.equal(state.overflow,false);
      if(width===390) assert.ok(state.panes[1].y>state.panes[0].y+state.panes[0].height && state.panes.every(p=>p.width>=290));
      else assert.ok(Math.abs(state.panes[0].y-state.panes[1].y)<1 && state.panes[0].width>=250);
    }
    await client.call('Emulation.setDeviceMetricsOverride',{width:320,height:800,deviceScaleFactor:1,mobile:true});
    await evaluate(client, `(() => {const select=document.querySelector('.approved-export-options select');select.value='jpeg';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await until(() => evaluate(client, `!document.querySelector('.approved-export .strict-comparison')`),'preview dismissal on format change');
    await evaluate(client, `(() => {const select=document.querySelector('.approved-export-options select');select.value='png';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await evaluate(client, `[...document.querySelector('.approved-export').querySelectorAll('button')].find(x=>x.textContent==='Prepare converted previews').click()`);
    await until(() => evaluate(client, `!!document.querySelector('.approved-export .strict-comparison')`),'reopened preview');
    assert.equal(await evaluate(client, `[...document.querySelector('.approved-export').querySelectorAll('button')].find(x=>x.textContent==='Download approved output bundle').disabled`), true);
    await client.call('Page.setDownloadBehavior', {behavior:'allow', downloadPath:userDir});
    await evaluate(client, `(() => {const panel=document.querySelector('.approved-export');const box=[...panel.querySelectorAll('label')].find(x=>x.innerText.includes('I inspected every converted output'));box.querySelector('input').click();[...panel.querySelectorAll('button')].find(x=>x.textContent==='Download approved output bundle').click()})()`);
    const download = await until(async () => (await readdir(userDir)).find(name=>name.startsWith('approved-outputs-') && name.endsWith('.zip')), 'approved output download');
    const archive = await readFile(join(userDir,download));
    const { ZipReader, Uint8ArrayReader, Uint8ArrayWriter } = await import('@zip.js/zip.js/lib/zip-core-native.js');
    const zip=new ZipReader(new Uint8ArrayReader(archive));
    try {
      const entries=await zip.getEntries(); const provenance=entries.find(entry=>entry.filename===`provenance/${exportFixture.assetId}.json`);assert.ok(provenance,'Downloaded bundle contains the approved asset provenance.');
      const receipt=JSON.parse(new TextDecoder().decode(await provenance.getData(new Uint8ArrayWriter())));
      assert.equal(receipt.reviewId,exportFixture.reviewId);assert.equal(receipt.decisionId,exportFixture.decisionId);assert.equal(receipt.sourceSha256,exportFixture.sourceHash);
      const imageEntry=entries.find(entry=>entry.filename===`outputs/${exportFixture.assetId}.png`);assert.ok(imageEntry,'Downloaded bundle contains an image.');const output=await imageEntry.getData(new Uint8ArrayWriter());
      const { createHash } = await import('node:crypto');assert.equal(createHash('sha256').update(output).digest('hex'),receipt.outputSha256);
      const pixel=await evaluate(client, `(async () => {const bytes=Uint8Array.from(atob(${JSON.stringify(Buffer.from(output).toString('base64'))}),c=>c.charCodeAt(0));const image=await createImageBitmap(new Blob([bytes],{type:'image/png'}));const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);image.close();return {width:c.width,height:c.height,pixel:[...ctx.getImageData(512,512,1,1).data]};})()`);
      assert.deepEqual(pixel,{width:1024,height:1024,pixel:[170,51,17,255]});
    } finally { await zip.close(); }
    await unlink(join(userDir,download));
    await client.call('Page.navigate',{url:`${origin}/settings`});
    await until(() => evaluate(client, `!!document.querySelector('#local-access-token')`),'local gateway sign-in');
    await evaluate(client, `(() => {const e=document.querySelector('#local-access-token');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(token)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await evaluate(client, `document.querySelector('.provider-login button').click()`);
    await until(() => evaluate(client, `[...document.querySelectorAll('.provider-session button')].some(b=>b.textContent==='Connect provider'&&!b.disabled)`),'provider connect');
    await evaluate(client, `[...document.querySelectorAll('.provider-session button')].find(b=>b.textContent==='Connect provider').click()`);
    await until(() => evaluate(client, `document.querySelector('.provider-session')?.innerText.includes('Provider authorization active')`),'provider authorization');
    await client.call('Page.navigate',{url:`${origin}/products/${productId}`});
    await until(() => evaluate(client, `document.querySelector('.studio-panel')?.innerText.includes('Local app and provider session active')`),'active studio gateway');
    await until(() => evaluate(client, `[...document.querySelectorAll('.style-plan label')].some(l=>l.innerText.includes('I authorize this single Studio attempt')&&!l.querySelector('input').disabled)`),'studio authorization');
    assert.equal(providerCalls,0,'No provider request before explicit consent.');
    assert.equal(await evaluate(client, `[...document.querySelectorAll('.studio-panel button')].find(b=>b.textContent==='Authorize and generate selected scenes').disabled`),true);
    await evaluate(client, `[...document.querySelectorAll('.style-plan label')].find(l=>l.innerText.includes('I authorize this single Studio attempt')).querySelector('input').click()`);
    await until(() => evaluate(client, `![...document.querySelectorAll('.studio-panel button')].find(b=>b.textContent==='Authorize and generate selected scenes').disabled`),'ready studio generation');
    await evaluate(client, `[...document.querySelectorAll('.studio-panel button')].find(b=>b.textContent==='Authorize and generate selected scenes').click()`);
    await until(() => evaluate(client, `document.querySelector('.studio-history')?.innerText.includes('Studio · DEFINITIVE_SUCCESS')`),'generated synthetic studio scene');
    assert.equal(providerCalls,1,'Exactly one synthetic provider request was made.');
    assert.deepEqual(Object.keys(providerPayload).sort(),['model','n','output_format','prompt','quality','size']);
    assert.equal(providerPayload.n,1);assert.equal(providerPayload.output_format,'png');
    assert.ok(providerPayload.prompt.includes('Synthetic region test'));
    const generated=await evaluate(client, `(async () => {const p=await import('/src/products.ts');const entries=await p.listStudioAttempts(${JSON.stringify(productId)});const e=entries.find(x=>x.attempt.styleId==='studio' && x.attempt.status==='DEFINITIVE_SUCCESS');return {attemptId:e.attempt.attemptId,source:e.attempt.sourceSha256,scene:e.asset.sha256};})()`);
    assert.equal(generated.source,originalHash);
    assert.equal(generated.scene,createHash('sha256').update(Buffer.from(imageData,'base64')).digest('hex'));
    assert.equal(await evaluate(client, `document.body.innerText.includes('synthetic-provider-fixture') || JSON.stringify(localStorage).includes('synthetic-provider-fixture') || JSON.stringify(sessionStorage).includes('synthetic-provider-fixture')`),false);
    await client.call('Page.reload');
    await until(() => evaluate(client, `document.querySelector('.studio-history')?.innerText.includes('Studio · DEFINITIVE_SUCCESS')`),'persisted synthetic scene');
    assert.equal(providerCalls,1,'Reload does not resend the synthetic request.');
    const attemptSelector=`.studio-history li`;
    await until(() => evaluate(client, `[...document.querySelectorAll(${JSON.stringify(attemptSelector)})].some(li=>li.innerText.includes(${JSON.stringify(generated.attemptId)})&&[...li.querySelectorAll('button')].some(b=>b.textContent==='Prepare local composite'&&!b.disabled))`),'generated scene composition');
    await evaluate(client, `(() => {const li=[...document.querySelectorAll('.studio-history li')].find(x=>x.innerText.includes(${JSON.stringify(generated.attemptId)}));[...li.querySelectorAll('button')].find(b=>b.textContent==='Prepare local composite').click();})()`);
    await until(() => evaluate(client, `(() => {const li=[...document.querySelectorAll('.studio-history li')].find(x=>x.innerText.includes(${JSON.stringify(generated.attemptId)}));return [...li.querySelectorAll('button')].some(b=>b.textContent==='Save unapproved composite');})()`),'generated composite preview');
    await evaluate(client, `(() => {const li=[...document.querySelectorAll('.studio-history li')].find(x=>x.innerText.includes(${JSON.stringify(generated.attemptId)}));[...li.querySelectorAll('button')].find(b=>b.textContent==='Save unapproved composite').click();})()`);
    await until(() => evaluate(client, `(() => {const li=[...document.querySelectorAll('.studio-history li')].find(x=>x.innerText.includes(${JSON.stringify(generated.attemptId)}));return [...li.querySelectorAll('summary')].some(s=>s.textContent==='Review this composite');})()`),'generated composite saved');
    const generatedComposite=await evaluate(client, `(async () => {const p=await import('/src/products.ts');return (await p.listStrictComposites(${JSON.stringify(productId)},${JSON.stringify(generated.attemptId)}))[0].assetId;})()`);
    await evaluate(client, `(() => {const li=[...document.querySelectorAll('.studio-history li')].find(x=>x.innerText.includes(${JSON.stringify(generated.attemptId)}));[...li.querySelectorAll('summary')].find(s=>s.textContent==='Review this composite').click();})()`);
    await until(() => evaluate(client, `!!document.querySelector(${JSON.stringify('#review-heading-'+generatedComposite)})?.closest('.visual-review')?.querySelector('form')`),'generated composite review');
    const reviewSelector=`#review-heading-${generatedComposite}`;
    assert.ok(await evaluate(client, `document.querySelector(${JSON.stringify(reviewSelector)}).closest('.visual-review').innerText.includes('Style-specific evidence')`),'Studio-specific checks are present.');
    await evaluate(client, `(() => {const f=document.querySelector(${JSON.stringify(reviewSelector)}).closest('.visual-review').querySelector('form');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;for(const input of f.querySelectorAll('input[type="number"]')) {setter.call(input,'5');input.dispatchEvent(new Event('input',{bubbles:true}));}for(const select of f.querySelectorAll('select')) {select.value=select.id.startsWith('qa-variant-')?'default':'MATCH';select.dispatchEvent(new Event('change',{bubbles:true}));}})()`);
    await until(() => evaluate(client, `document.querySelector(${JSON.stringify(reviewSelector)}).closest('.visual-review').innerText.includes('Proposed status: PASS_CANDIDATE')`),'generated passing review');
    await evaluate(client, `(() => {const f=document.querySelector(${JSON.stringify(reviewSelector)}).closest('.visual-review').querySelector('form');[...f.querySelectorAll('label')].find(l=>l.innerText.includes('I personally compared')).querySelector('input').click();})()`);
    await until(() => evaluate(client, `![...document.querySelector(${JSON.stringify(reviewSelector)}).closest('.visual-review').querySelectorAll('button')].find(b=>b.textContent==='Save this human review').disabled`),'generated review confirmation');
    await evaluate(client, `[...document.querySelector(${JSON.stringify(reviewSelector)}).closest('.visual-review').querySelectorAll('button')].find(b=>b.textContent==='Save this human review').click()`);
    await until(() => evaluate(client, `[...document.querySelector(${JSON.stringify(reviewSelector)}).closest('.visual-review').querySelectorAll('button')].some(b=>b.textContent==='Choose approval'&&!b.disabled)`),'generated review saved');
    await evaluate(client, `[...document.querySelector(${JSON.stringify(reviewSelector)}).closest('.visual-review').querySelectorAll('button')].find(b=>b.textContent==='Choose approval').click()`);
    await evaluate(client, `[...document.querySelector(${JSON.stringify(reviewSelector)}).closest('.visual-review').querySelectorAll('label')].find(l=>l.innerText.includes('I explicitly approve')).querySelector('input').click()`);
    await until(() => evaluate(client, `![...document.querySelector(${JSON.stringify(reviewSelector)}).closest('.visual-review').querySelectorAll('button')].find(b=>b.textContent==='Record approved decision').disabled`),'generated decision confirmation');
    await evaluate(client, `[...document.querySelector(${JSON.stringify(reviewSelector)}).closest('.visual-review').querySelectorAll('button')].find(b=>b.textContent==='Record approved decision').click()`);
    await until(() => evaluate(client, `document.querySelector(${JSON.stringify(reviewSelector)}).closest('.visual-review').innerText.includes('decision APPROVED')`),'generated composite approved');
    const generatedDecision=await evaluate(client, `(async () => {const p=await import('/src/products.ts');const h=await p.listVisualReviews(${JSON.stringify(productId)},${JSON.stringify(generated.attemptId)},${JSON.stringify(generatedComposite)});const d=h.decisions.find(x=>x.current);return {reviewId:d.reportId,decisionId:d.qaId};})()`);
    await client.call('Page.reload');
    await until(() => evaluate(client, `document.querySelector('.approved-export')?.innerText.includes(${JSON.stringify(generatedComposite)})`),'generated approved export candidate');
    await evaluate(client, `(() => {const panel=document.querySelector('.approved-export');[...panel.querySelectorAll('label')].find(l=>l.innerText.includes(${JSON.stringify(generatedComposite)})).querySelector('input').click();[...panel.querySelectorAll('button')].find(b=>b.textContent==='Prepare converted previews').click();})()`);
    await until(() => evaluate(client, `document.querySelector('.approved-export')?.innerText.includes('Inspect converted outputs')`),'generated export preview');
    await evaluate(client, `(() => {const panel=document.querySelector('.approved-export');[...panel.querySelectorAll('label')].find(l=>l.innerText.includes('I inspected every converted output')).querySelector('input').click();[...panel.querySelectorAll('button')].find(b=>b.textContent==='Download approved output bundle').click();})()`);
    const secondDownload=await until(async () => (await readdir(userDir)).find(name=>name.startsWith('approved-outputs-')&&name.endsWith('.zip')),'generated approved ZIP');
    const secondZip=new ZipReader(new Uint8ArrayReader(await readFile(join(userDir,secondDownload))));
    try {const entries=await secondZip.getEntries();const proof=entries.find(e=>e.filename===`provenance/${generatedComposite}.json`), output=entries.find(e=>e.filename===`outputs/${generatedComposite}.png`);assert.ok(proof&&output,'Generated composite and provenance are in the ZIP.');const receipt=JSON.parse(new TextDecoder().decode(await proof.getData(new Uint8ArrayWriter())));const bytes=await output.getData(new Uint8ArrayWriter());assert.equal(receipt.attemptId,generated.attemptId);assert.equal(receipt.sceneSha256,generated.scene);assert.equal(receipt.sourceSha256,originalHash);assert.equal(receipt.reviewId,generatedDecision.reviewId);assert.equal(receipt.decisionId,generatedDecision.decisionId);assert.equal(createHash('sha256').update(bytes).digest('hex'),receipt.outputSha256);} finally {await secondZip.close();}
    assert.equal(providerCalls,1,'Composition, review and export do not resend the provider request.');



    assert.equal(await evaluate(client, `document.documentElement.scrollWidth===innerWidth`),true);
    assert.equal(await evaluate(client, 'document.documentElement.scrollWidth === innerWidth'), true);
  } finally {
    client?.close();
    if (browser && browser.exitCode === null) { browser.kill('SIGTERM'); await Promise.race([new Promise((resolve) => browser.once('exit', resolve)), delay(3000)]); }
    await vite.close();
    await new Promise((resolve,reject)=>gateway.close(error=>error?reject(error):resolve()));
    await rm(userDir, { recursive: true, force: true });
  }
});
