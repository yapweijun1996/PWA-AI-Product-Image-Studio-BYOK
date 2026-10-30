import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import 'fake-indexeddb/auto';
import { build } from 'vite';
import { STUDIO_PROMPT, STUDIO_MODEL, STUDIO_QUALITY, STUDIO_SIZE, STUDIO_PROMPT_VERSION, studioEstimateUSD } from '../studio-policy.mjs';

const built = await build({ configFile: 'vite.config.ts', logLevel: 'silent',
  build: { write: false, minify: false, lib: { entry: 'src/products.ts', formats: ['es'], fileName: 'products' } } });
const output = Array.isArray(built) ? built[0] : built;
const code = output.output.find((entry) => entry.type === 'chunk').code;
const storage = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const empty = () => ({ jobs: [], attempts: [], assets: [], reviews: [], heads: [] });

async function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('product-image-studio');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

test('full snapshot and add-only restore preserve an empty project and reject a collision atomically', async () => {
  const original = await storage.createProduct({ sku: randomUUID(), name: 'Synthetic', category: 'Test', rightsAcknowledged: true });
  const snapshot = await storage.getBackupSnapshot(original.productId);
  assert.deepEqual(snapshot.history, empty());
  const imported = { ...snapshot.product, productId: randomUUID(), sku: randomUUID() };
  await storage.restoreProduct(imported, [], [], snapshot.history);
  assert.deepEqual(await storage.getProduct(imported.productId), imported);
  await assert.rejects(storage.restoreProduct(imported, [], [], snapshot.history), /exists|constraint/i);
  assert.deepEqual(await storage.getProduct(imported.productId), imported);
});

test('invalid or duplicated history cannot partially create a project', async () => {
  const original = await storage.createProduct({ sku: randomUUID(), name: 'Synthetic', category: 'Test', rightsAcknowledged: true });
  const product = { ...original, productId: randomUUID(), sku: randomUUID() };
  const id = randomUUID();
  const history = { ...empty(), jobs: [{ jobId: id }, { jobId: id }] };
  await assert.rejects(storage.restoreProduct(product, [], [], history), /duplicate|invalid/i);
  assert.equal(await storage.getProduct(product.productId), null);
  await assert.rejects(storage.validateBackupHistory(product, [], [], { ...empty(), extra: true }), /malformed/i);
});
test('a cancelled restore leaves no project behind', async () => {
  const original = await storage.createProduct({ sku: randomUUID(), name: 'Synthetic', category: 'Test', rightsAcknowledged: true });
  const product = { ...original, productId: randomUUID(), sku: randomUUID() };
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(storage.restoreProduct(product, [], [], empty(), controller.signal), { name: 'AbortError' });
  assert.equal(await storage.getProduct(product.productId), null);
});
test('cancellation after a restore write aborts the transaction without replacing existing data', async () => {
  const original = await storage.createProduct({ sku: randomUUID(), name: 'Synthetic', category: 'Test', rightsAcknowledged: true });
  const product = { ...original, productId: randomUUID(), sku: randomUUID() };
  const controller = new AbortController();
  const add = IDBObjectStore.prototype.add;
  let writeObserved = false;
  IDBObjectStore.prototype.add = function (...args) {
    const request = add.apply(this, args);
    if (this.name === 'products' && args[0].productId === product.productId) {
      request.addEventListener('success', () => { writeObserved = true; controller.abort(); }, { once: true });
    }
    return request;
  };
  try {
    await assert.rejects(storage.restoreProduct(product, [], [], empty(), controller.signal), { name: 'AbortError' });
  } finally {
    IDBObjectStore.prototype.add = add;
  }
  assert.equal(writeObserved, true);
  assert.equal(await storage.getProduct(product.productId), null);
  assert.deepEqual(await storage.getProduct(original.productId), original);
});
test('a synchronous quota failure aborts a queued restore and gives recovery guidance', async () => {
  const original = await storage.createProduct({ sku: randomUUID(), name: 'Synthetic', category: 'Test', rightsAcknowledged: true });
  const product = { ...original, productId: randomUUID(), sku: randomUUID() };
  const add = IDBObjectStore.prototype.add;
  let queued = false;
  IDBObjectStore.prototype.add = function (...args) {
    const request = add.apply(this, args);
    if (this.name === 'products' && args[0].productId === product.productId) {
      queued = true;
      throw new DOMException('', 'QuotaExceededError');
    }
    return request;
  };
  try {
    await assert.rejects(storage.restoreProduct(product, [], [], empty()), /Local storage is full/);
  } finally {
    IDBObjectStore.prototype.add = add;
  }
  assert.equal(queued, true);
  assert.equal(await storage.getProduct(product.productId), null);
  assert.deepEqual(await storage.getProduct(original.productId), original);
});
test('an orphaned foreign attempt reference prevents add-only restore', async () => {
  const original = await storage.createProduct({ sku: randomUUID(), name: 'Synthetic', category: 'Test', rightsAcknowledged: true });
  const product = { ...original, productId: randomUUID(), sku: randomUUID() };
  const db = await database();
  const attemptId = randomUUID();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('attempts', 'readwrite');
    tx.objectStore('attempts').add({ attemptId, jobId: randomUUID(), productId: product.productId });
    tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
  });
  assert.equal(await storage.hasImportConflict(product, [], empty()), true);
  await assert.rejects(storage.restoreProduct(product, [], [], empty()), /reference/i);
  assert.equal(await storage.getProduct(product.productId), null);
  await new Promise((resolve, reject) => {
    const tx = db.transaction('attempts', 'readwrite');
    tx.objectStore('attempts').delete(attemptId);
    tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
  });
  db.close();
});



test('imported uncertainty requires a local review and never mutates attempt or acknowledges a gateway', async () => {
  const product = await storage.createProduct({ sku: randomUUID(), name: 'Synthetic', category: 'Test', rightsAcknowledged: true });
  const attempt = { attemptId: randomUUID(), jobId: randomUUID(), productId: product.productId, status: 'SUBMITTED', prompt: 'synthetic', submittedAt: new Date().toISOString() };
  const db = await database();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['jobs', 'attempts', 'userSettings'], 'readwrite');
    tx.objectStore('jobs').add({ jobId: attempt.jobId, productId: product.productId });
    tx.objectStore('attempts').add(attempt);
    tx.objectStore('userSettings').add({ key: `backup-import-unresolved:${attempt.attemptId}`, snapshot: JSON.stringify(attempt), reviewed: false, markerVersion: 2, legacyReviewed: null });
    tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
  });
  let [entry] = await storage.listStudioAttempts(product.productId);
  assert.equal(entry.importedUnresolved, true);
  assert.equal(entry.importedUntrusted, true);
  await assert.rejects(storage.acknowledgeStudioAttempt(attempt.attemptId, new Date().toISOString(), 'UNKNOWN'), /imported/i);
  await storage.resolveImportedUncertainty(attempt.attemptId);
  [entry] = await storage.listStudioAttempts(product.productId);
  assert.deepEqual(entry.attempt, attempt);
  assert.equal(entry.importedUnresolved, false);
  assert.equal(entry.importedUntrusted, true);
  await assert.rejects(storage.acknowledgeStudioAttempt(attempt.attemptId, new Date().toISOString(), 'UNKNOWN'), /imported/i);
  await new Promise((resolve, reject) => {
    const tx = db.transaction('attempts', 'readwrite');
    tx.objectStore('attempts').put({ ...attempt, prompt: 'changed' });
    tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
  });
  await assert.rejects(storage.resolveImportedUncertainty(attempt.attemptId), /changed/i);
  await assert.rejects(storage.listStudioAttempts(product.productId), /changed/i);
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['jobs', 'attempts', 'userSettings'], 'readwrite');
    tx.objectStore('jobs').delete(attempt.jobId);
    tx.objectStore('attempts').delete(attempt.attemptId);
    tx.objectStore('userSettings').delete(`backup-import-unresolved:${attempt.attemptId}`);
    tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
  });
  db.close();
});

async function generationFixture() {
  const product = await storage.createProduct({ sku: randomUUID(), name: 'Synthetic', category: 'Test', rightsAcknowledged: true });
  const source = { assetId: randomUUID(), sha256: 'a'.repeat(64), mimeType: 'image/png', width: 1, height: 1, cameraView: 'FRONT', filename: 'source.png' };
  await storage.saveSource(product.productId, { file: new File(['synthetic'], source.filename, { type: source.mimeType }), metadata: source, exifOrientation: 1, previewUrl: '' }, 'FRONT');
  const db = await database(), maskId = randomUUID(), maskSha256 = 'b'.repeat(64);
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['products', 'masks'], 'readwrite'), products = tx.objectStore('products');
    const request = products.get(product.productId);
    request.onsuccess = () => { const row = request.result; row.brandLock.maskAssetId = maskId; products.put(row); };
    tx.objectStore('masks').add({ maskId, productId: product.productId, sourceAssetId: source.assetId, sourceSha256: source.sha256, sha256: maskSha256 });
    tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
  });
  const makeAttempt = () => ({ attemptId: randomUUID(), jobId: randomUUID(), productId: product.productId,
    sourceAssetId: source.assetId, sourceSha256: source.sha256, maskId, maskSha256,
    prompt: STUDIO_PROMPT, promptVersion: STUDIO_PROMPT_VERSION, model: STUDIO_MODEL, quality: STUDIO_QUALITY,
    size: STUDIO_SIZE, estimatedUSD: studioEstimateUSD(), submittedAt: new Date().toISOString(),
    status: 'PREPARED', usage: null, observedUSD: null });
  return { db, product, makeAttempt };
}

test('acknowledging a local attempt preserves imported prepared history and fails closed on a damaged marker', async () => {
  const { db, product, makeAttempt } = await generationFixture();
  const first = makeAttempt(), pending = makeAttempt();
  const consent = await storage.globalStudioReviewFingerprint();
  await storage.createStudioAttempt(first, consent);
  await storage.createStudioAttempt(pending, consent);
  await storage.updateStudioAttempt({ ...first, status: 'SUBMITTED' }, undefined, consent);
  await storage.updateStudioAttempt({ ...first, status: 'UNKNOWN' });
  const markerKey = `backup-import-unresolved:${pending.attemptId}`;
  await new Promise((resolve, reject) => {
    const tx = db.transaction('userSettings', 'readwrite');
    tx.objectStore('userSettings').add({ key: markerKey, snapshot: JSON.stringify(pending), reviewed: false, markerVersion: 2, legacyReviewed: null });
    tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
  });
  await storage.acknowledgeStudioAttempt(first.attemptId, new Date().toISOString(), 'UNKNOWN');
  const entries = await storage.listStudioAttempts(product.productId);
  assert.deepEqual(entries.find((row) => row.attempt.attemptId === pending.attemptId).attempt, pending);
  await new Promise((resolve, reject) => {
    const tx = db.transaction('userSettings', 'readwrite');
    tx.objectStore('userSettings').put({ key: markerKey, snapshot: 'corrupt', reviewed: false, markerVersion: 2, legacyReviewed: null });
    tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
  });
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['attempts', 'jobs'], 'readwrite');
    const firstRequest = tx.objectStore('attempts').get(first.attemptId);
    firstRequest.onsuccess = () => {
      const changed = { ...firstRequest.result }; delete changed.acknowledgedAt; delete changed.recordedOutcome;
      tx.objectStore('attempts').put(changed);
    };
    tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
  });
  await assert.rejects(storage.acknowledgeStudioAttempt(first.attemptId, new Date().toISOString(), 'UNKNOWN'), /changed|trust/i);
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['attempts', 'jobs', 'userSettings'], 'readwrite');
    tx.objectStore('attempts').delete(first.attemptId); tx.objectStore('attempts').delete(pending.attemptId);
    tx.objectStore('jobs').delete(first.jobId); tx.objectStore('jobs').delete(pending.jobId);
    tx.objectStore('userSettings').delete(markerKey);
    tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
  });
  db.close();
});

test('orphaned review heads conflict even when the archive has no head record', async () => {
  const product = await storage.createProduct({ sku: randomUUID(), name: 'Synthetic', category: 'Test', rightsAcknowledged: true });
  const imported = { ...product, productId: randomUUID(), sku: randomUUID() }, assetId = randomUUID();
  const db = await database();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('userSettings', 'readwrite');
    tx.objectStore('userSettings').add({ key: `visual-review-head:${assetId}`, entries: [] });
    tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
  });
  assert.equal(await storage.hasImportConflict(imported, [], { ...empty(), assets: [{ kind: 'strict-composite', assetId }] }), true);
  db.close();
});

test('reviewed imported rate-limit timestamps do not override local delay enforcement', async () => {
  const { db, makeAttempt } = await generationFixture();
  const old = makeAttempt(), consent = await storage.globalStudioReviewFingerprint();
  await storage.createStudioAttempt(old, consent);
  await storage.updateStudioAttempt({ ...old, status: 'SUBMITTED' }, undefined, consent);
  const limited = { ...old, status: 'DEFINITIVE_FAILURE', failure: { category: 'rate_limited', retryAfterSeconds: 60 } };
  await storage.updateStudioAttempt(limited);
  const markerKey = `backup-import-unresolved:${old.attemptId}`;
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['jobs', 'userSettings'], 'readwrite'), jobs = tx.objectStore('jobs');
    const request = jobs.get(old.jobId);
    request.onsuccess = () => { const job = request.result; job.attempts[0].completedAt = '2099-01-01T00:00:00.000Z'; jobs.put(job); };
    tx.objectStore('userSettings').add({ key: markerKey, snapshot: JSON.stringify(limited), reviewed: false, markerVersion: 2, legacyReviewed: null });
    tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
  });
  await assert.rejects(storage.createStudioAttempt(makeAttempt(), consent), /review|uncertainty/i);
  await storage.resolveImportedUncertainty(old.attemptId);
  await assert.rejects(storage.createStudioAttempt(makeAttempt(), consent), /review changed/i);
  const local = makeAttempt(), newConsent = await storage.globalStudioReviewFingerprint();
  await storage.createStudioAttempt(local, newConsent);
  await storage.updateStudioAttempt({ ...local, status: 'SUBMITTED' }, undefined, newConsent);
  await storage.updateStudioAttempt({ ...local, status: 'DEFINITIVE_FAILURE', failure: { category: 'rate_limited', retryAfterSeconds: 60 } });
  await assert.rejects(storage.createStudioAttempt(makeAttempt(), newConsent), /delay/i);
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['attempts', 'jobs', 'userSettings'], 'readwrite');
    tx.objectStore('attempts').delete(old.attemptId); tx.objectStore('attempts').delete(local.attemptId);
    tx.objectStore('jobs').delete(old.jobId); tx.objectStore('jobs').delete(local.jobId);
    tx.objectStore('userSettings').delete(markerKey);
    tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
  });
  db.close();
});
