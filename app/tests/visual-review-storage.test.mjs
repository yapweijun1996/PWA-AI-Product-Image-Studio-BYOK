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
  createVisualReview, recordVisualDecision, listVisualReviews, getBackupSnapshot, validateBackupHistory } =
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
const finding = (severity) => ({ severity, description: 'Visible issue', unlocalized: true });
async function ready() {
  const f = await fixture();
  f.composite = await save(f, await load(f));
  return f;
}
const review = async (f, checks = matches, variant = 'default', values = scores) =>
  createVisualReview(f.productId, f.attemptId, f.composite.assetId, values, checks, variant, 'Upper label text is blurred.',
    (await history(f)).productSha256, f.composite.sha256, undefined, undefined, undefined, undefined,
    Object.values(checks).includes('MISMATCH') ? [finding('BLOCKER')] : Object.values(checks).includes('UNKNOWN') ? [finding('WARN')] : []);
const decision = (f, report, choice = 'APPROVED', signal) =>
  recordVisualDecision(f.productId, f.attemptId, f.composite.assetId, report.qaId, choice, signal);
const history = (f) => listVisualReviews(f.productId, f.attemptId, f.composite.assetId);

test('uncertain or mismatched checks require a nonempty human note, preserved verbatim', async () => {
  const f = await ready(), fingerprint = (await history(f)).productSha256;
  for (const check of ['MISMATCH', 'UNKNOWN']) {
    for (const note of ['', '   ']) {
      await assert.rejects(createVisualReview(f.productId, f.attemptId, f.composite.assetId, scores,
        { ...matches, source: check }, 'default', note, fingerprint, f.composite.sha256));
    }
  }
  assert.equal((await history(f)).reviews.length, 0);
  const note = '  Original upper label is too blurry to read.  ';
  const report = await createVisualReview(f.productId, f.attemptId, f.composite.assetId, scores,
    { ...matches, source: 'UNKNOWN' }, 'default', note, fingerprint, f.composite.sha256, undefined, undefined, undefined, undefined, [finding('WARN')]);
  assert.equal(report.report.reviewerNote, note);
  assert.equal((await history(f)).reviews[0].report.reviewerNote, note);
  const chinese = await createVisualReview(f.productId, f.attemptId, f.composite.assetId, scores,
    { ...matches, typography: 'MISMATCH' }, 'default', '标签错字', fingerprint, f.composite.sha256, undefined, undefined, undefined, undefined, [finding('BLOCKER')]);
  assert.equal(chinese.report.reviewerNote, '标签错字');
  assert.equal((await history(f)).reviews[1].report.reviewerNote, '标签错字');
  const allMatch = await createVisualReview(f.productId, f.attemptId, f.composite.assetId, scores, matches, 'default', '', fingerprint, f.composite.sha256);
  assert.equal(allMatch.report.reviewerNote, '');
});

test('v2 writes require evidence and enforce verified source and output boundaries', async () => {
  const f = await ready(), fingerprint = (await history(f)).productSha256;
  const saveReview = (checks, findings) => createVisualReview(f.productId, f.attemptId, f.composite.assetId, scores,
    checks, 'default', 'Issue', fingerprint, f.composite.sha256, undefined, undefined, undefined, undefined, findings);
  await assert.rejects(saveReview({ ...matches, source: 'MISMATCH' }, [finding('WARN')]), /BLOCKER/);
  await assert.rejects(saveReview({ ...matches, source: 'UNKNOWN' }, []), /WARN/);
  const regionFinding = { severity: 'BLOCKER', description: 'Issue at edge', unlocalized: false,
    sourceRegion: { x: 1, y: 0, width: 1, height: 1 }, outputRegion: { x: 1023, y: 1023, width: 1, height: 1 } };
  await assert.rejects(saveReview(matches, [{ ...regionFinding, sourceRegion: { x: 2, y: 0, width: 1, height: 1 } }]), /region/);
  await assert.rejects(saveReview(matches, [{ ...regionFinding, outputRegion: { x: 1023, y: 1023, width: 2, height: 1 } }]), /region/);
  const report = await saveReview(matches, [regionFinding]);
  assert.equal(report.report.schemaVersion, '2.0.0');
  assert.equal(report.report.status, 'REJECTED');
  await assert.rejects(decision(f, report));
  assert.deepEqual((await history(f)).reviews[0].report.findings, [regionFinding]);
});

test('mixed legacy and v2 histories preserve their heads and validate in full backups', async () => {
  const f = await ready(), original = await review(f, { ...matches, source: 'UNKNOWN' });
  const { findings, ...legacyReport } = original.report;
  const legacy = { ...original, report: { ...legacyReport, schemaVersion: '1.0.0' } };
  await mutate(f.db, 'qaReports', legacy.qaId, () => legacy);
  const entry = `${legacy.qaId}:${hash(Buffer.from(JSON.stringify(legacy)))}`;
  await mutate(f.db, 'userSettings', `visual-review-head:${f.composite.assetId}`, (head) => ({ ...head, entries: [entry] }));
  const restored = await history(f);
  assert.deepEqual(restored.reviews[0], legacy);
  const next = await review(f);
  assert.equal(next.report.schemaVersion, '2.0.0');
  const backup = await getBackupSnapshot(f.productId);
  assert.deepEqual(backup.history.reviews.find((row) => row.qaId === legacy.qaId), legacy);
  assert.ok(backup.history.heads[0].entries.includes(entry));
  await validateBackupHistory(backup.product, backup.sources, backup.masks, backup.history);
  const damaged = structuredClone(backup.history);
  const current = damaged.reviews.find((row) => row.qaId === next.qaId);
  current.report.findings = [{ severity: 'INFO', description: 'Bad region', unlocalized: false, sourceRegion: { x: 2, y: 0, width: 1, height: 1 } }];
  damaged.heads[0].entries = damaged.heads[0].entries.map((item) => item.startsWith(`${next.qaId}:`) ? `${next.qaId}:${hash(Buffer.from(JSON.stringify(current)))}` : item).sort();
  await assert.rejects(validateBackupHistory(backup.product, backup.sources, backup.masks, damaged), /region/);
  for (const alter of [
    (report) => { report.schemaVersion = '3.0.0'; },
    (report) => { report.schemaVersion = '1.0.0'; },
    (report) => { delete report.findings; },
    (report) => { report.findings = [{ ...finding('INFO'), extra: true }]; },
  ]) {
    const forged = structuredClone(backup.history);
    alter(forged.reviews.find((row) => row.qaId === next.qaId).report);
    await assert.rejects(validateBackupHistory(backup.product, backup.sources, backup.masks, forged));
  }
});

test('legacy mismatches keep their original single veto without structured evidence', async () => {
  const f = await ready(), original = await review(f, { ...matches, source: 'MISMATCH' });
  const { findings, ...report } = original.report;
  const legacy = { ...original, report: { ...report, schemaVersion: '1.0.0',
    hardVetoFindings: report.hardVetoFindings.filter((item) => item.code !== 'HUMAN_FINDING_1') } };
  await mutate(f.db, 'qaReports', legacy.qaId, () => legacy);
  await mutate(f.db, 'userSettings', `visual-review-head:${f.composite.assetId}`, (head) => ({
    ...head, entries: [`${legacy.qaId}:${hash(Buffer.from(JSON.stringify(legacy)))}`],
  }));
  assert.deepEqual((await history(f)).reviews[0], legacy);
  await assert.rejects(decision(f, legacy));
  await getBackupSnapshot(f.productId);
});

test('review rejects the previously displayed product snapshot after another tab adds a fact', async () => {
  const f = await ready(), observed = await history(f);
  assert.equal(observed.product.productId, f.productId);
  assert.equal(observed.productSha256, hash(Buffer.from(JSON.stringify(observed.product))));
  await addConfirmedFact(f.productId, 'Finish', 'Matte');
  await assert.rejects(createVisualReview(f.productId, f.attemptId, f.composite.assetId, scores,
    matches, 'default', '', observed.productSha256, observed.assetSha256), /product changed/);
  const current = await history(f);
  assert.notEqual(current.productSha256, observed.productSha256);
  assert.equal(current.product.facts[0].value, 'Matte');
  assert.equal(current.reviews.length, 0);
  assert.equal(current.decisions.length, 0);
});

test('a byte-changed composite with identical pixels cannot use the previously displayed hash', async () => {
  const f = await ready(), observed = await history(f);
  assert.equal(observed.assetSha256, f.composite.sha256);
  const bitmap = await createImageBitmap(f.composite.blob);
  const bytes = png(1024, 1024, bitmap.pixels, 1);
  bitmap.close();
  const newHash = hash(bytes);
  assert.notEqual(newHash, observed.assetSha256);
  await mutate(f.db, 'generatedAssets', f.composite.assetId,
    (row) => ({ ...row, blob: blob(bytes), sha256: newHash }));
  await assert.rejects(createVisualReview(f.productId, f.attemptId, f.composite.assetId, scores, matches, 'default', '',
    observed.productSha256, observed.assetSha256), /composite changed/);
  const current = await history(f);
  assert.equal(current.assetSha256, newHash);
  assert.equal(current.reviews.length, 0);
  assert.equal(current.decisions.length, 0);
});

test('committed product and review changes broadcast only product IDs, failures do not broadcast', async () => {
  const f = await ready(), observed = await history(f), events = [], Original = globalThis.BroadcastChannel;
  globalThis.BroadcastChannel = class {
    constructor(name) { assert.equal(name, 'product-image-studio-changes'); }
    postMessage(message) { events.push(message); }
    close() {}
  };
  try {
    await addConfirmedFact(f.productId, 'Finish', 'Matte');
    await assert.rejects(createVisualReview(f.productId, f.attemptId, f.composite.assetId, scores,
      matches, 'default', '', observed.productSha256, observed.assetSha256));
    assert.deepEqual(events, [f.productId]);
    const report = await review(f);
    await decision(f, report);
    const bytes = png(2, 1, Uint8Array.from([10, 20, 30, 255, 10, 20, 30, 255]));
    const metadata = { ...f.source, assetId: randomUUID(), sha256: hash(bytes), filename: 'second.png' };
    await saveSource(f.productId, { file: blob(bytes), metadata, exifOrientation: 1, previewUrl: '' }, 'FRONT');
    await saveMask(f.productId, f.source, blob(sourceBytes), f.maskId);
    assert.deepEqual(events, Array(5).fill(f.productId));
  } finally {
    globalThis.BroadcastChannel = Original;
  }
});

test('hard veto and uncertainty override 100, and unbranded cannot be approved', async () => {
  const f = await ready();
  for (const check of Object.keys(matches)) {
    const report = await review(f, { ...matches, [check]: 'MISMATCH' });
    assert.equal(report.report.weightedScore, 100);
    assert.equal(report.report.status, 'REJECTED');
    assert.equal(report.report.hardVetoFindings.length, 2);
    await assert.rejects(decision(f, report));
  }
  for (const check of Object.keys(matches)) {
    const report = await review(f, { ...matches, [check]: 'UNKNOWN' });
    assert.equal(report.report.status, 'UNVERIFIABLE');
    await assert.rejects(decision(f, report));
  }
  const beforeUnbranded = (await history(f)).reviews.length;
  await assert.rejects(review(f, matches, 'unbranded'));
  assert.equal((await history(f)).reviews.length, beforeUnbranded);
  const low = await review(f, matches, 'default', { ...scores, design: '0' });
  assert.equal(low.report.status, 'REVIEW_REQUIRED');
  await assert.rejects(decision(f, low));
  assert.equal((await decision(f, low, 'REJECTED')).decision, 'REJECTED');
});

test('review and decision are separate append-only records, and new revision invalidates prior decision', async () => {
  const f = await ready(), first = await review(f);
  assert.equal(first.revision, 1); assert.equal(first.report.humanDecision, 'PENDING');
  const approval = await decision(f, first);
  assert.notEqual(approval.qaId, first.qaId); assert.equal(approval.current, true);
  const second = await review(f);
  assert.equal(second.revision, 2);
  let h = await history(f);
  assert.equal(h.reviews.length, 2); assert.equal(h.decisions.length, 1);
  assert.equal(h.reviews[0].report.humanDecision, 'PENDING');
  assert.equal(h.decisions[0].current, false);
  await assert.rejects(decision(f, first));
  await decision(f, second, 'REJECTED');
  h = await history(f);
  assert.equal(h.decisions.find((entry) => entry.reportId === second.qaId).current, true);
  await assert.rejects(decision(f, second));
});

test('concurrent reports serialize revisions; competing decisions cannot both commit', async () => {
  const f = await ready();
  const reports = await Promise.all([review(f), review(f)]);
  assert.deepEqual(reports.map((row) => row.revision).sort(), [1, 2]);
  const latest = reports.find((row) => row.revision === 2);
  const results = await Promise.allSettled([decision(f, latest), decision(f, latest, 'REJECTED')]);
  assert.equal(results.filter((row) => row.status === 'fulfilled').length, 1);
  assert.equal((await history(f)).decisions.length, 1);
  const report = await review(f);
  const racing = await Promise.allSettled([decision(f, report), review(f)]);
  assert.equal(racing[1].status, 'fulfilled');
  const h = await history(f);
  assert.equal(h.decisions.some((row) => row.reportId === report.qaId && row.current), false);
});

test('changes to facts invalidate an approval and stale review cannot be approved', async () => {
  const f = await ready(), report = await review(f);
  await decision(f, report);
  await mutate(f.db, 'products', f.productId, (row) => ({ ...row, name: 'Changed name' }));
  const h = await history(f);
  assert.equal(h.decisions[0].current, false);
  await assert.rejects(decision(f, report));
  const fresh = await review(f);
  assert.equal((await decision(f, fresh)).current, true);
});

test('changed rights, source, mask, scene, composite or attempt prevent decisions and history', async () => {
  for (const which of ['rights', 'active', 'source', 'mask', 'scene', 'asset', 'attempt', 'mapping']) {
    const f = await ready(), report = await review(f);
    if (which === 'rights') await mutate(f.db, 'products', f.productId, (row) => ({ ...row, rightsAcknowledged: false }));
    if (which === 'active') await mutate(f.db, 'products', f.productId, (row) => ({ ...row, brandLock: { ...row.brandLock, maskAssetId: null } }));
    if (which === 'source') await mutate(f.db, 'sourceAssets', f.source.assetId, (row) => ({ ...row, blob: blob(sceneBytes) }));
    if (which === 'mask') await mutate(f.db, 'masks', f.maskId, (row) => ({ ...row, blob: blob(sceneBytes) }));
    if (which === 'scene') await mutate(f.db, 'generatedAssets', f.scene.assetId, (row) => ({ ...row, blob: blob(sourceBytes) }));
    if (which === 'asset') await mutate(f.db, 'generatedAssets', f.composite.assetId, (row) => ({ ...row, blob: blob(sceneBytes), sha256: hash(sceneBytes) }));
    if (which === 'mapping') await mutate(f.db, 'generatedAssets', f.composite.assetId, (row) => ({ ...row, mapping: { ...row.mapping, x: 0 } }));
    if (which === 'attempt') await mutate(f.db, 'attempts', f.attemptId, (row) => ({ ...row, status: 'UNKNOWN' }));
    await assert.rejects(decision(f, report), undefined, which);
    await assert.rejects(history(f), undefined, which);
    if (which === 'attempt') await mutate(f.db, 'attempts', f.attemptId, (row) => ({ ...row, status: 'DEFINITIVE_SUCCESS' }));
  }
});

test('invalid input, corrupted report, missing revision and forged decision fail closed', async () => {
  const f = await ready();
  await assert.rejects(review(f, matches, 'default', { ...scores, design: '5.0000001' }));
  await assert.rejects(review(f, { ...matches, source: 'YES' }));
  assert.equal((await history(f)).reviews.length, 0);
  await review(f); const second = await review(f);
  await mutate(f.db, 'qaReports', second.qaId, (row) => ({ ...row, report: { ...row.report, humanDecision: 'APPROVED' } }));
  await assert.rejects(history(f)); await assert.rejects(decision(f, second));
  const g = await ready(), other = await review(g);
  await mutate(g.db, 'qaReports', other.qaId, (row) => ({ ...row, revision: 2 }));
  await assert.rejects(history(g));
  await assert.rejects(decision(g, other));
  const h = await ready(), original = await review(h);
  await decision(h, original);
  const newer = await review(h);
  await remove(h.db, 'qaReports', newer.qaId);
  await assert.rejects(history(h));
  await assert.rejects(decision(h, original));
});

test('cancellation leaves no review or decision and releases transaction', async () => {
  const f = await ready(), fingerprint = (await history(f)).productSha256, controller = new AbortController();
  controller.abort();
  await assert.rejects(createVisualReview(f.productId, f.attemptId, f.composite.assetId, scores, matches, 'default', '', fingerprint, f.composite.sha256, controller.signal), { name: 'AbortError' });
  const report = await review(f);
  await assert.rejects(decision(f, report, 'APPROVED', controller.signal), { name: 'AbortError' });
  assert.equal((await history(f)).decisions.length, 0);
  assert.equal((await decision(f, report)).current, true);
});

test('duplicate scene and mask versions invalidate the current review', async () => {
  const f = await ready(), report = await review(f);
  await add(f.db, 'generatedAssets', { ...f.scene, assetId: randomUUID() });
  await assert.rejects(decision(f, report), /duplicated/);
  const g = await ready(), other = await review(g);
  const duplicateMask = { maskId: randomUUID(), productId: g.productId, sourceAssetId: g.source.assetId,
    sourceSha256: g.source.sha256, width: 2, height: 1, sha256: hash(sourceBytes), version: 1, blob: blob(sourceBytes) };
  await add(g.db, 'masks', duplicateMask);
  await assert.rejects(decision(g, other), /duplicate/);
});

test('forged veto approval and duplicate decision are rejected as corrupt history', async () => {
  const f = await ready(), report = await review(f, { ...matches, source: 'MISMATCH' });
  const rejected = await decision(f, report, 'REJECTED');
  await mutate(f.db, 'qaReports', rejected.qaId, (row) => ({ ...row, decision: 'APPROVED' }));
  await assert.rejects(history(f));
  const g = await ready(), valid = await review(g), approved = await decision(g, valid);
  const { current, ...duplicate } = approved;
  await add(g.db, 'qaReports', { ...duplicate, qaId: randomUUID() });
  await assert.rejects(history(g));
});

test('cancellation while decoding aborts transaction and releases locks before decoder resumes', async () => {
  const f = await ready(), fingerprint = (await history(f)).productSha256, controller = new AbortController(), original = globalThis.createImageBitmap;
  let entered, release;
  const waiting = new Promise((resolve) => { entered = resolve; });
  const blocked = new Promise((resolve) => { release = resolve; });
  globalThis.createImageBitmap = async (...args) => { entered(); await blocked; return original(...args); };
  try {
    const pending = createVisualReview(f.productId, f.attemptId, f.composite.assetId, scores, matches, 'default', '', fingerprint, f.composite.sha256, controller.signal);
    await waiting;
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    await new Promise((resolve, reject) => {
      const tx = f.db.transaction('products', 'readwrite');
      tx.objectStore('products').get(f.productId);
      tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
    });
  } finally {
    release(); globalThis.createImageBitmap = original;
  }
  assert.equal((await history(f)).reviews.length, 0);
});

test('cancelling history verification releases its lock while decoding is held', async () => {
  const f = await ready();
  await review(f);
  const controller = new AbortController(), original = globalThis.createImageBitmap;
  let entered, release;
  const waiting = new Promise((resolve) => { entered = resolve; });
  const blocked = new Promise((resolve) => { release = resolve; });
  globalThis.createImageBitmap = async (...args) => { entered(); await blocked; return original(...args); };
  try {
    const pending = listVisualReviews(f.productId, f.attemptId, f.composite.assetId, controller.signal);
    await waiting;
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    await new Promise((resolve, reject) => {
      const tx = f.db.transaction('products', 'readwrite');
      tx.objectStore('products').get(f.productId);
      tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
    });
  } finally {
    release(); globalThis.createImageBitmap = original;
  }
  assert.equal((await history(f)).reviews.length, 1);
});
