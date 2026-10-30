import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';
import 'fake-indexeddb/auto';
import { build } from 'vite';
import { STUDIO_PROMPT, STUDIO_MODEL, STUDIO_QUALITY, STUDIO_SIZE, STUDIO_PROMPT_VERSION, STUDIO_SCENE_PROMPT_VERSION, STUDIO_PRESET_VERSION, studioBuildPrompt, studioEstimateUSD } from '../studio-policy.mjs';

// Synthetic PNGs and a minimal canvas decoder keep these storage tests local.
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type), length = Buffer.alloc(4), crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}
function png(width, height, pixels, level = 6) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4, dst = y * (width * 4 + 1) + 1 + x * 4;
      raw[dst] = pixels ? pixels[src] : 0; raw[dst + 1] = pixels ? pixels[src + 1] : 0;
      raw[dst + 2] = pixels ? pixels[src + 2] : 0; raw[dst + 3] = pixels ? pixels[src + 3] : 255;
    }
  }
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level })), chunk('IEND', Buffer.alloc(0))]);
}
const sourceBytes = png(2, 1, Uint8Array.from([230, 0, 0, 255, 230, 0, 0, 255])), sceneBytes = png(1024, 1024);
const blob = (bytes) => new Blob([bytes], { type: 'image/png' });
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
globalThis.createImageBitmap = async (file) => {
  const bytes = Buffer.from(await file.arrayBuffer()), width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  let offset = 8; const chunks = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset), name = bytes.toString('ascii', offset + 4, offset + 8);
    if (name === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(chunks)), pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) pixels.set(raw.subarray(y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1)), y * width * 4);
  return { width, height, pixels, close() {} };
};
let syntheticFont = 20;
class TestCanvas {
  constructor() { this._width = 0; this._height = 0; this.pixels = new Uint8ClampedArray(); }
  set width(value) { this._width = value; this.pixels = new Uint8ClampedArray(this._width * this._height * 4); }
  get width() { return this._width; }
  set height(value) { this._height = value; this.pixels = new Uint8ClampedArray(this._width * this._height * 4); }
  get height() { return this._height; }
  toBlob(callback) { callback(blob(png(this.width, this.height, this.pixels))); }
  getContext() {
    const canvas = this;
    return {
      fillRect(x, y, w, h) {
        for (let row = y; row < y + h; row++) for (let col = x; col < x + w; col++) {
          canvas.pixels.set([255, 255, 255, 255], (row * canvas.width + col) * 4);
        }
      },
      measureText(value) { return { width: value.length * 10 }; },
      fillText() { canvas.pixels.set([syntheticFont, 0, 0, 255], (875 * canvas.width + 512) * 4); },
      clearRect(x, y, w, h) {
        for (let row = y; row < y + h; row++) canvas.pixels.fill(0, (row * canvas.width + x) * 4, (row * canvas.width + x + w) * 4);
      },
      drawImage(image, ...args) {
        let sx = 0, sy = 0, sw = image.width, sh = image.height, dx, dy, dw, dh;
        if (args.length === 2) [dx, dy] = args, dw = sw, dh = sh;
        else if (args.length === 4) [dx, dy, dw, dh] = args;
        else [sx, sy, sw, sh, dx, dy, dw, dh] = args;
        for (let y = Math.max(0, Math.ceil(dy)); y < Math.min(canvas.height, Math.ceil(dy + dh)); y++) {
          for (let x = Math.max(0, Math.ceil(dx)); x < Math.min(canvas.width, Math.ceil(dx + dw)); x++) {
            const ix = Math.min(image.width - 1, Math.floor(sx + (x - dx) * sw / dw));
            const iy = Math.min(image.height - 1, Math.floor(sy + (y - dy) * sh / dh));
            const src = (iy * image.width + ix) * 4, dst = (y * canvas.width + x) * 4;
            if (image.pixels[src + 3]) canvas.pixels.set(image.pixels.subarray(src, src + 4), dst);
          }
        }
      },
      getImageData(x, y, w, h) {
        const data = new Uint8ClampedArray(w * h * 4);
        for (let row = 0; row < h; row++) data.set(canvas.pixels.subarray(((y + row) * canvas.width + x) * 4, ((y + row) * canvas.width + x + w) * 4), row * w * 4);
        return { data };
      },
      putImageData(image, x, y) {
        const w = canvas.width;
        for (let row = 0; row < image.data.length / (w * 4); row++) canvas.pixels.set(image.data.subarray(row * w * 4, (row + 1) * w * 4), ((y + row) * w + x) * 4);
      },
    };
  }
}
globalThis.document = { createElement: () => new TestCanvas() };

const built = await build({ configFile: 'vite.config.ts', logLevel: 'silent',
  build: { write: false, minify: false, lib: { entry: 'src/products.ts', formats: ['es'], fileName: 'products' } } });
const output = Array.isArray(built) ? built[0] : built;
const code = output.output.find((entry) => entry.type === 'chunk').code;
const { createProduct, getProduct, saveSource, addConfirmedFact, createStudioAttempt, updateStudioAttempt, globalStudioReviewFingerprint, listVisualReviews,
  loadStrictCompositeInputs, saveStrictComposite, listStrictComposites, listStudioAttempts, productSnapshotFingerprint, studioSceneContext } =
  await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const rendererBuilt = await build({ configFile: 'vite.config.ts', logLevel: 'silent',
  build: { write: false, minify: false, lib: { entry: 'src/strictComposite.ts', formats: ['es'], fileName: 'strict-composite' } } });
const rendererOutput = Array.isArray(rendererBuilt) ? rendererBuilt[0] : rendererBuilt;
const rendererCode = rendererOutput.output.find((entry) => entry.type === 'chunk' && entry.isEntry).code;
const { renderStrictCompositePixels } = await import(`data:text/javascript;base64,${Buffer.from(rendererCode).toString('base64')}`);

async function fixture(styleId) {
  const product = await createProduct({ sku: randomUUID(), name: 'Synthetic product', category: 'Test', rightsAcknowledged: true });
  const source = { assetId: randomUUID(), sha256: hash(sourceBytes), mimeType: 'image/png', width: 2, height: 1, cameraView: 'FRONT', filename: 'source.png' };
  await saveSource(product.productId, { file: blob(sourceBytes), metadata: source, exifOrientation: 1, previewUrl: '' }, 'FRONT');
  const maskId = randomUUID(), maskSha256 = hash(sourceBytes);
  const db = await new Promise((resolve, reject) => { const request = indexedDB.open('product-image-studio'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['products', 'masks'], 'readwrite'), products = tx.objectStore('products');
    const request = products.get(product.productId);
    request.onsuccess = () => { const value = request.result; value.brandLock.maskAssetId = maskId; products.put(value); };
    tx.objectStore('masks').add({ maskId, productId: product.productId, sourceAssetId: source.assetId, sourceSha256: source.sha256,
      width: 2, height: 1, sha256: maskSha256, version: 1, blob: blob(sourceBytes) });
    tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
  });
  const attempt = { attemptId: randomUUID(), jobId: randomUUID(), productId: product.productId, sourceAssetId: source.assetId,
    sourceSha256: source.sha256, maskId, maskSha256, prompt: STUDIO_PROMPT, promptVersion: STUDIO_PROMPT_VERSION,
    model: STUDIO_MODEL, quality: STUDIO_QUALITY, size: STUDIO_SIZE, estimatedUSD: studioEstimateUSD(),
    submittedAt: new Date().toISOString(), status: 'PREPARED', usage: null, observedUSD: null };
  if (styleId) {
    const current = await getProduct(product.productId), sceneContext = studioSceneContext(current, source, []);
    const prompt = studioBuildPrompt(styleId, sceneContext);
    Object.assign(attempt, { styleId, sceneContext, selectedFactIds: [], presetVersion: STUDIO_PRESET_VERSION,
      productSnapshotFingerprint: await productSnapshotFingerprint(current), prompt, promptVersion: STUDIO_SCENE_PROMPT_VERSION, estimatedUSD: studioEstimateUSD(prompt) });
  }
  const fingerprint = await globalStudioReviewFingerprint();
  await createStudioAttempt(attempt, fingerprint);
  await updateStudioAttempt({ ...attempt, status: 'SUBMITTED' }, undefined, fingerprint);
  const scene = { assetId: randomUUID(), productId: product.productId, attemptId: attempt.attemptId, blob: blob(sceneBytes), sha256: hash(sceneBytes) };
  await updateStudioAttempt({ ...attempt, status: 'DEFINITIVE_SUCCESS' }, scene);
  return { productId: product.productId, attemptId: attempt.attemptId, scene, source, maskId, db };
}
const mapping = { x: 102.39999999999998, y: 307.2, width: 819.2, height: 409.6, sourceWidth: 2, sourceHeight: 1 };
const load = (f) => loadStrictCompositeInputs(f.productId, f.attemptId, f.scene.assetId);
let previewPromise;
function preview() {
  if (!previewPromise) previewPromise = (async () => {
    const canvas = new TestCanvas(); canvas.width = 1024; canvas.height = 1024;
    const context = canvas.getContext('2d'), scene = await createImageBitmap(blob(sceneBytes)), source = await createImageBitmap(blob(sourceBytes));
    context.drawImage(scene, 0, 0, 1024, 1024);
    context.drawImage(source, mapping.x, mapping.y, mapping.width, mapping.height);
    return new Promise((resolve) => canvas.toBlob(resolve));
  })();
  return previewPromise;
}
const save = async (f, inputs, image, map = mapping) => saveStrictComposite(f.productId, f.attemptId, inputs, image ?? await preview(), map);
function mutate(db, store, key, transform) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite'), objectStore = tx.objectStore(store), request = objectStore.get(key);
    request.onsuccess = () => objectStore.put(transform(request.result));
    tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
  });
}
function add(db, store, row) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).add(row);
    tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
  });
}
function remove(db, store, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).delete(key);
    tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
  });
}

function maskVersion(f, version) {
  return { maskId: randomUUID(), productId: f.productId, sourceAssetId: f.source.assetId, sourceSha256: f.source.sha256,
    width: 2, height: 1, sha256: hash(sourceBytes), version, blob: blob(sourceBytes) };
}

test('the renderer rejects a mask that removes an explicitly supplied protected region', async () => {
  const maskBytes = png(2, 1, Uint8Array.from([255, 255, 255, 255, 255, 255, 255, 0]));
  const inputs = { source: blob(sourceBytes), mask: blob(maskBytes), scene: blob(sceneBytes), sourceWidth: 2, sourceHeight: 1 };
  const intact = await renderStrictCompositePixels({ ...inputs, protectedRegions: [{ x: 0, y: 0, width: 1, height: 1 }] });
  assert.ok(intact.blob.size > 0);
  await assert.rejects(renderStrictCompositePixels({ ...inputs, protectedRegions: [{ x: 1, y: 0, width: 1, height: 1 }] }), /not fully covered/);
  await assert.rejects(renderStrictCompositePixels({ ...inputs, protectedRegions: [] }), /missing or invalid/);
  const mutable = [{ x: 0, y: 0, width: 1, height: 1 }];
  const pending = renderStrictCompositePixels({ ...inputs, protectedRegions: mutable });
  mutable[0].x = 1;
  assert.ok((await pending).blob.size > 0);
  const legacy = await renderStrictCompositePixels(inputs);
  assert.ok(legacy.blob.size > 0);
});

test('completed versioned scene remains accessible after product facts or name change', async () => {
  const f = await fixture('hero');
  await mutate(f.db, 'products', f.productId, (row) => ({ ...row, name: 'Updated product name' }));
  await addConfirmedFact(f.productId, 'Finish', 'Matte');
  const inputs = await load(f);
  assert.equal(inputs.styleId, 'hero');
  assert.equal(inputs.sourceSha256, f.source.sha256);
});

test('billboard rerenders from frozen copy pixels after font changes and rejects layer tampering', async () => {
  const f = await fixture('billboard'), inputs = await load(f);
  const recipe = { version: 1, styleId: 'billboard', sourceView: 'OTHER',
    display: { x: 100, y: 100, width: 600, height: 600 }, displayFrontFacing: true, copy: 'Exact seller copy' };
  const rendered = await renderStrictCompositePixels({ ...inputs, recipe });
  recipe.copyLayerSha256 = hash(Buffer.from(await rendered.copyLayer.arrayBuffer()));
  const saved = await saveStrictComposite(f.productId, f.attemptId, inputs, rendered.blob, rendered.mapping, undefined, recipe, rendered.copyLayer);
  try {
    syntheticFont = 99;
    const history = await listVisualReviews(f.productId, f.attemptId, saved.assetId);
    assert.equal(history.assetSha256, saved.sha256);
    await mutate(f.db, 'generatedAssets', saved.assetId, (row) => ({ ...row, copyLayer: blob(sceneBytes) }));
    await assert.rejects(listVisualReviews(f.productId, f.attemptId, saved.assetId), /hash/i);
  } finally { syntheticFont = 20; }
});

test('strict composites preserve exact input identities and append a distinct unapproved asset', async () => {
  const f = await fixture(), inputs = await load(f);
  assert.equal(inputs.sourceAssetId, f.source.assetId); assert.equal(inputs.sourceSha256, f.source.sha256);
  assert.equal(inputs.maskId, f.maskId); assert.equal(inputs.sceneAssetId, f.scene.assetId); assert.equal(inputs.sceneSha256, f.scene.sha256);
  const result = await save(f, inputs);
  assert.equal(result.kind, 'strict-composite'); assert.notEqual(result.assetId, f.scene.assetId);
  assert.equal(result.sha256, hash(Buffer.from(await result.blob.arrayBuffer()))); assert.equal(result.sceneSha256, f.scene.sha256);
  assert.notEqual(result.sha256, f.scene.sha256);
  assert.equal('approved' in result, false); assert.deepEqual(result.mapping, mapping);
  const items = await listStrictComposites(f.productId, f.attemptId);
  assert.equal(items.length, 1); assert.equal(items[0].assetId, result.assetId);
  // Force a composite to sort before the legacy scene's UUID in the index.
  await add(f.db, 'generatedAssets', { ...result, assetId: '00000000-0000-0000-0000-000000000000' });
  const history = await listStudioAttempts(f.productId);
  assert.equal(history[0].asset.assetId, f.scene.assetId); assert.equal(history[0].attempt.status, 'DEFINITIVE_SUCCESS');
  await assert.rejects(loadStrictCompositeInputs(f.productId, f.attemptId, result.assetId), /original scene/);
});

test('save rejects changed rights, active mask, input identities and corrupt source, mask or scene', async () => {
  for (const which of ['rights', 'active', 'source', 'mask', 'scene', 'given']) {
    const f = await fixture(), inputs = await load(f);
    if (which === 'rights') await mutate(f.db, 'products', f.productId, (row) => ({ ...row, rightsAcknowledged: false }));
    if (which === 'active') await mutate(f.db, 'products', f.productId, (row) => ({ ...row, brandLock: { ...row.brandLock, maskAssetId: null } }));
    if (which === 'source') await mutate(f.db, 'sourceAssets', f.source.assetId, (row) => ({ ...row, blob: blob(sceneBytes) }));
    if (which === 'mask') await mutate(f.db, 'masks', f.maskId, (row) => ({ ...row, blob: blob(sceneBytes) }));
    if (which === 'scene') await mutate(f.db, 'generatedAssets', f.scene.assetId, (row) => ({ ...row, blob: blob(sourceBytes) }));
    if (which === 'given') inputs.mask = blob(sceneBytes);
    await assert.rejects(save(f, inputs), undefined, which);
    assert.equal((await listStrictComposites(f.productId, f.attemptId)).length, 0, which);
  }
});

test('scene must be the unique successful attempt scene and valid PNG', async () => {
  const f = await fixture();
  await assert.rejects(loadStrictCompositeInputs(randomUUID(), f.attemptId, f.scene.assetId));
  await assert.rejects(loadStrictCompositeInputs(f.productId, f.attemptId, randomUUID()), /original scene/);
  await add(f.db, 'generatedAssets', { ...f.scene, assetId: randomUUID() });
  await assert.rejects(load(f), /duplicated/);
  const g = await fixture();
  await mutate(g.db, 'generatedAssets', g.scene.assetId, (row) => ({ ...row, sha256: 'a'.repeat(64) }));
  await assert.rejects(load(g), /hash/);
  const h = await fixture();
  await mutate(h.db, 'attempts', h.attemptId, (row) => ({ ...row, status: 'UNKNOWN', recordedOutcome: 'DEFINITIVE_SUCCESS' }));
  await assert.rejects(load(h), /definitive successful/);
  await mutate(h.db, 'attempts', h.attemptId, ({ recordedOutcome, ...row }) => ({ ...row, status: 'DEFINITIVE_SUCCESS' }));
});

test('equivalent pixels with different PNG encoding are accepted', async () => {
  const f = await fixture(), inputs = await load(f), standard = await preview();
  const decoded = await createImageBitmap(standard);
  const encoded = png(1024, 1024, decoded.pixels, 1);
  decoded.close();
  assert.notEqual(hash(encoded), hash(Buffer.from(await standard.arrayBuffer())));
  const result = await save(f, inputs, blob(encoded));
  assert.equal(result.sha256, hash(encoded));
});

test('save rejects malformed output and mapping without changing scene or jobs', async () => {
  const f = await fixture(), inputs = await load(f);
  await assert.rejects(save(f, inputs, blob(sourceBytes)), /1024/);
  await assert.rejects(save(f, inputs, blob(sceneBytes), { ...mapping, x: 0 }), /mapping/);
  await assert.rejects(save(f, inputs, blob(sceneBytes)), /preview pixels/);
  await assert.rejects(save(f, { ...inputs, sceneSha256: '0'.repeat(64) }), /changed/);
  assert.equal((await listStrictComposites(f.productId, f.attemptId)).length, 0);
  assert.equal((await listStudioAttempts(f.productId))[0].asset.assetId, f.scene.assetId);
});

test('a rolled-back active mask and duplicate mask versions fail both load and save', async () => {
  for (const version of [1, 2]) {
    const f = await fixture(), inputs = await load(f);
    await add(f.db, 'masks', maskVersion(f, version));
    await assert.rejects(load(f), version === 1 ? /duplicate/ : /not the latest/);
    await assert.rejects(save(f, inputs), version === 1 ? /duplicate/ : /not the latest/);
    assert.equal((await listStrictComposites(f.productId, f.attemptId)).length, 0);
  }
});

test('a composite with its kind stripped cannot masquerade as an original scene', async () => {
  const f = await fixture(), inputs = await load(f), result = await save(f, inputs);
  await remove(f.db, 'generatedAssets', f.scene.assetId);
  await mutate(f.db, 'generatedAssets', result.assetId, (row) => {
    const { kind, ...withoutKind } = row; return withoutKind;
  });
  assert.equal((await listStudioAttempts(f.productId))[0].asset, null);
  await assert.rejects(loadStrictCompositeInputs(f.productId, f.attemptId, result.assetId), /original scene/);
});

test('aborting readonly input verification releases its lock while decoding remains blocked', async () => {
  const f = await fixture(), controller = new AbortController(), original = globalThis.createImageBitmap;
  let entered, release;
  const waiting = new Promise((resolve) => { entered = resolve; });
  const blocked = new Promise((resolve) => { release = resolve; });
  globalThis.createImageBitmap = async (...args) => {
    entered(); await blocked; return original(...args);
  };
  try {
    const pending = loadStrictCompositeInputs(f.productId, f.attemptId, f.scene.assetId, controller.signal);
    await waiting;
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    // This writer overlaps the aborted transaction's stores and must complete
    // before the suspended decoder is released.
    await new Promise((resolve, reject) => {
      const tx = f.db.transaction('products', 'readwrite');
      tx.objectStore('products').get(f.productId);
      tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
    });
    await assert.rejects(loadStrictCompositeInputs(f.productId, f.attemptId, f.scene.assetId, controller.signal), { name: 'AbortError' });
  } finally {
    release(); globalThis.createImageBitmap = original;
  }
});

test('aborting while input verification is held rolls back the pending save', async () => {
  const f = await fixture(), inputs = await load(f), controller = new AbortController(), image = await preview();
  const original = globalThis.createImageBitmap, prototype = Object.getPrototypeOf(f.db), originalTransaction = prototype.transaction;
  let entered, release, saving = false;
  const waiting = new Promise((resolve) => { entered = resolve; });
  const blocked = new Promise((resolve) => { release = resolve; });
  prototype.transaction = function (stores, mode, ...rest) {
    if (mode === 'readwrite' && Array.isArray(stores) && stores.includes('generatedAssets')) saving = true;
    return originalTransaction.call(this, stores, mode, ...rest);
  };
  globalThis.createImageBitmap = async (...args) => {
    if (saving) { entered(); await blocked; }
    return original(...args);
  };
  try {
    const pending = saveStrictComposite(f.productId, f.attemptId, inputs, image, mapping, controller.signal);
    await waiting;
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    release(); saving = false;
    assert.equal((await listStrictComposites(f.productId, f.attemptId)).length, 0);
    await assert.rejects(saveStrictComposite(f.productId, f.attemptId, inputs, image, mapping, controller.signal), { name: 'AbortError' });
  } finally {
    release(); prototype.transaction = originalTransaction; globalThis.createImageBitmap = original;
  }
});
