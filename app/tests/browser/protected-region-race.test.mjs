import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
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
  const vite = await createServer({ root: appRoot, configFile: join(appRoot, 'vite.config.ts'), logLevel: 'silent', server: { host: '127.0.0.1', port: 0 } });
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
    await client.call('Emulation.setDeviceMetricsOverride', { width: 320, height: 800, deviceScaleFactor: 1, mobile: true });
    await client.call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
    await client.call('Page.navigate', { url: origin });
    await until(() => evaluate(client, `location.origin === ${JSON.stringify(origin)} && document.readyState === 'complete'`), 'application load');
    const productId = await evaluate(client, `(async () => {
      const p = await import('/src/products.ts');
      const canvas = document.createElement('canvas'); canvas.width = 200; canvas.height = 100;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#a31'; ctx.fillRect(0, 0, 200, 100);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map((n) => n.toString(16).padStart(2, '0')).join('');
      const product = await p.createProduct({ sku: crypto.randomUUID(), name: 'Synthetic region test', category: 'Test', rightsAcknowledged: true });
      const source = { assetId: crypto.randomUUID(), sha256: hash, mimeType: 'image/png', width: 200, height: 100, cameraView: 'FRONT', filename: 'synthetic.png' };
      await p.saveSource(product.productId, { file: blob, metadata: source, exifOrientation: 1, previewUrl: '' }, 'FRONT');
      return product.productId;
    })()`);
    await client.call('Page.navigate', { url: `${origin}/products/${productId}` });
    await until(() => evaluate(client, `location.pathname === '/products/${productId}' && document.querySelector('#mask-source')?.options.length > 1`), 'synthetic source');
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
    await evaluate(client, `(() => {const panel=document.querySelector('.approved-export');const field=[...panel.querySelectorAll('label')].find(x=>x.innerText.includes(${JSON.stringify(exportFixture.assetId)}));field.querySelector('input').click();[...panel.querySelectorAll('button')].find(x=>x.textContent==='Prepare converted previews').click()})()`);
    await until(() => evaluate(client, `document.querySelector('.approved-export')?.innerText.includes('Inspect converted outputs')`), 'converted preview');
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
    assert.equal(await evaluate(client, 'document.documentElement.scrollWidth === innerWidth'), true);
  } finally {
    client?.close();
    if (browser && browser.exitCode === null) { browser.kill('SIGTERM'); await Promise.race([new Promise((resolve) => browser.once('exit', resolve)), delay(3000)]); }
    await vite.close();
    await rm(userDir, { recursive: true, force: true });
  }
});
