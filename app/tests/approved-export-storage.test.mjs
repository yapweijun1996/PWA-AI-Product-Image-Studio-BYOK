import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';
import 'fake-indexeddb/auto';
import { build } from 'vite';
import { STUDIO_PROMPT, STUDIO_MODEL, STUDIO_QUALITY, STUDIO_SIZE, STUDIO_PROMPT_VERSION, studioEstimateUSD } from '../studio-policy.mjs';

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
const { createProduct, saveSource, saveMask, addConfirmedFact, createStudioAttempt, updateStudioAttempt, globalStudioReviewFingerprint,
  loadStrictCompositeInputs, saveStrictComposite, listStrictComposites, listStudioAttempts,
  createVisualReview, recordVisualDecision, listVisualReviews, listApprovedExportCandidates, loadApprovedExportBatch, commitApprovedExportBatch } =
  await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

async function fixture() {
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

const scores = { design: '5', typography: '5', geometry: '5', realism: '5', style: '5' };
const matches = { product: 'MATCH', typography: 'MATCH', claims: 'MATCH', viewpoint: 'MATCH', source: 'MATCH', mask: 'MATCH' };
async function ready() {
  const f = await fixture();
  f.composite = await save(f, await load(f));
  return f;
}
const review = async (f, checks = matches, variant = 'default', values = scores) =>
  createVisualReview(f.productId, f.attemptId, f.composite.assetId, values, checks, variant, 'Upper label text is blurred.',
    (await history(f)).productSha256, f.composite.sha256);
const decision = (f, report, choice = 'APPROVED', signal) =>
  recordVisualDecision(f.productId, f.attemptId, f.composite.assetId, report.qaId, choice, signal);
const history = (f) => listVisualReviews(f.productId, f.attemptId, f.composite.assetId);

async function approved(f) {
  f ??= await ready();
  const report = await review(f);
  const receipt = await decision(f, report);
  return { f, selection: { attemptId: f.attemptId, assetId: f.composite.assetId, productSha256: report.productSha256,
    assetSha256: report.assetSha256, reviewId: report.qaId, decisionId: receipt.qaId } };
}

test('only the latest explicit matching approval is discoverable and exported with allowlisted provenance', async () => {
  const { f, selection } = await approved();
  assert.deepEqual(await listApprovedExportCandidates(f.productId), [selection]);
  const [entry] = await loadApprovedExportBatch(f.productId, [selection]);
  assert.deepEqual(entry.selection, selection);
  assert.equal(hash(Buffer.from(await entry.blob.arrayBuffer())), selection.assetSha256);
  assert.equal(entry.provenance.sourceAssetId, f.source.assetId);
  assert.equal(entry.provenance.reviewId, selection.reviewId);
  assert.ok(entry.provenance.jobId);
  assert.doesNotMatch(JSON.stringify(entry.provenance), /Synthetic product|Upper label|facts|reviewerNote/);
  const next = await review(f);
  assert.deepEqual(await listApprovedExportCandidates(f.productId), []);
  await assert.rejects(loadApprovedExportBatch(f.productId, [selection]), /approved/);
  await decision(f, next, 'REJECTED');
  assert.deepEqual(await listApprovedExportCandidates(f.productId), []);
  const third = await review(f), receipt = await decision(f, third);
  const current = { ...selection, reviewId: third.qaId, decisionId: receipt.qaId };
  assert.deepEqual(await listApprovedExportCandidates(f.productId), [current]);
});

test('stale project, mask and swapped image bytes reject the selected approval', async () => {
  const { f, selection } = await approved();
  await addConfirmedFact(f.productId, 'private fact', 'private value');
  await assert.rejects(loadApprovedExportBatch(f.productId, [selection]), /stale/);
  assert.deepEqual(await listApprovedExportCandidates(f.productId), []);
  const second = await approved();
  await mutate(second.f.db, 'generatedAssets', second.selection.assetId, (row) => ({ ...row, blob: blob(sceneBytes) }));
  await assert.rejects(loadApprovedExportBatch(second.f.productId, [second.selection]));
  const third = await approved();
  await mutate(third.f.db, 'masks', third.f.maskId, (row) => ({ ...row, blob: blob(sceneBytes) }));
  await assert.rejects(loadApprovedExportBatch(third.f.productId, [third.selection]));
  const fourth = await approved();
  await mutate(fourth.f.db, 'sourceAssets', fourth.f.source.assetId, (row) => ({ ...row, blob: blob(sceneBytes) }));
  await assert.rejects(loadApprovedExportBatch(fourth.f.productId, [fourth.selection]));
  const fifth = await approved();
  await mutate(fifth.f.db, 'generatedAssets', fifth.f.scene.assetId, (row) => ({ ...row, blob: blob(sourceBytes) }));
  await assert.rejects(loadApprovedExportBatch(fifth.f.productId, [fifth.selection]));
});

test('history corruption and unsupported attempt provenance fail closed', async () => {
  const { f, selection } = await approved();
  await mutate(f.db, 'userSettings', `visual-review-head:${selection.assetId}`, (head) => ({ ...head, entries: [] }));
  await assert.rejects(loadApprovedExportBatch(f.productId, [selection]), /history head/);
  await assert.rejects(listApprovedExportCandidates(f.productId), /history head/);
  const other = await approved();
  await mutate(other.f.db, 'attempts', other.f.attemptId, (attempt) => ({ ...attempt, prompt: 'private prompt' }));
  await assert.rejects(loadApprovedExportBatch(other.f.productId, [other.selection]), /provenance/);
  const usage = await approved();
  await mutate(usage.f.db, 'attempts', usage.f.attemptId, (attempt) => ({ ...attempt, usage: { secret: 'do not export' } }));
  await assert.rejects(loadApprovedExportBatch(usage.f.productId, [usage.selection]), /usage/);
});

test('discovery surfaces decoder failures instead of reporting no approved outputs', async () => {
  const { f } = await approved();
  const originalDecode = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async () => { throw new Error('decoder unavailable'); };
  try { await assert.rejects(listApprovedExportCandidates(f.productId), /decoded|decoder/); }
  finally { globalThis.createImageBitmap = originalDecode; }
});

test('provenance uses the actual submission time and requires it', async () => {
  const { f, selection } = await approved();
  const [original] = await loadApprovedExportBatch(f.productId, [selection]);
  const actual = '2026-10-29T12:34:56.000Z';
  await mutate(f.db, 'jobs', original.provenance.jobId, (job) => ({
    ...job, attempts: [{ ...job.attempts[0], submittedAt: actual }],
  }));
  const [updated] = await loadApprovedExportBatch(f.productId, [selection]);
  assert.equal(updated.provenance.submittedAt, actual);
  assert.notEqual(updated.provenance.submittedAt, original.provenance.submittedAt);
  await mutate(f.db, 'jobs', original.provenance.jobId, (job) => ({
    ...job, attempts: [{ ...job.attempts[0], submittedAt: null }],
  }));
  await assert.rejects(loadApprovedExportBatch(f.productId, [selection]), /submission time|successful job/);
});

test('batch is all-or-nothing and duplicate selections are rejected', async () => {
  const first = await approved();
  const secondComposite = await save(first.f, await load(first.f));
  const second = await approved({ ...first.f, composite: secondComposite });
  const batch = await loadApprovedExportBatch(first.f.productId, [first.selection, second.selection]);
  assert.deepEqual(batch.map((entry) => entry.selection), [first.selection, second.selection]);
  await assert.rejects(loadApprovedExportBatch(first.f.productId, [first.selection, first.selection]), /Duplicate/);
  await mutate(first.f.db, 'generatedAssets', second.selection.assetId, (row) => ({ ...row, blob: blob(sceneBytes) }));
  await assert.rejects(loadApprovedExportBatch(first.f.productId, [first.selection, second.selection]));
});

test('cross-tab edits wait for the whole batch snapshot; cancellation aborts pending verification', async () => {
  const { f, selection } = await approved();
  const originalDecode = globalThis.createImageBitmap;
  let entered, release;
  const started = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  let held = false;
  globalThis.createImageBitmap = async (...args) => {
    if (!held) { held = true; entered(); await gate; }
    return originalDecode(...args);
  };
  try {
    let changed = false, called = false;
    const pending = commitApprovedExportBatch(f.productId, [selection], undefined, (entries) => {
      assert.equal(changed, false); assert.equal(entries.length, 1); called = true;
    });
    await started;
    const edit = mutate(f.db, 'products', f.productId, (product) => ({ ...product, name: 'Changed in another tab' })).then(() => { changed = true; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(changed, false);
    release();
    assert.equal((await pending).length, 1);
    assert.equal(called, true);
    await edit;
    called = false;
    await assert.rejects(commitApprovedExportBatch(f.productId, [selection], undefined, () => { called = true; }), /stale/);
    assert.equal(called, false);
  } finally { release(); globalThis.createImageBitmap = originalDecode; }

  const fresh = await approved();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(loadApprovedExportBatch(fresh.f.productId, [fresh.selection], controller.signal), { name: 'AbortError' });
  let unblock, notify;
  const locked = new Promise((resolve) => { notify = resolve; });
  const wait = new Promise((resolve) => { unblock = resolve; });
  held = false;
  globalThis.createImageBitmap = async (...args) => {
    if (!held) { held = true; notify(); await wait; }
    return originalDecode(...args);
  };
  try {
    const live = new AbortController(), pending = loadApprovedExportBatch(fresh.f.productId, [fresh.selection], live.signal);
    await locked; live.abort(); unblock();
    await assert.rejects(pending, { name: 'AbortError' });
  } finally { unblock(); globalThis.createImageBitmap = originalDecode; }
});

test('a throwing or asynchronous commit callback rejects the transaction', async () => {
  const { f, selection } = await approved();
  await assert.rejects(commitApprovedExportBatch(f.productId, [selection], undefined, () => { throw new Error('callback failure'); }), /callback failure/);
  await assert.rejects(commitApprovedExportBatch(f.productId, [selection], undefined, async () => {}), /must be synchronous/);
});
