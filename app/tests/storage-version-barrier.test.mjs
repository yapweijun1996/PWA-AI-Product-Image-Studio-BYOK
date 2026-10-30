import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { build } from 'vite';

const built = await build({ configFile: 'vite.config.ts', logLevel: 'silent',
  build: { write: false, minify: false, lib: { entry: 'src/products.ts', formats: ['es'], fileName: 'products' } } });
const output = Array.isArray(built) ? built[0] : built;
const code = output.output.find((entry) => entry.type === 'chunk' && entry.isEntry).code;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;

async function legacyWorkspace({ omitIndex = false } = {}) {
  const factory = new IDBFactory(); globalThis.indexedDB = factory;
  const request = factory.open('product-image-studio', 1);
  const product = { schemaVersion: '1.0.0', productId: randomUUID(), sku: 'SYNTH-V1', name: 'Synthetic', category: 'Test',
    rightsAcknowledged: true, facts: [], sourceAssets: [], brandLock: { mode: 'STRICT', protectedText: [], forbiddenChanges: [], maskAssetId: null },
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
  request.onupgradeneeded = () => {
    const db = request.result, products = db.createObjectStore('products', { keyPath: 'productId' });
    products.createIndex('sku', 'sku', { unique: true }); if (!omitIndex) products.createIndex('updatedAt', 'updatedAt');
    for (const [name, key, indexes] of [
      ['sourceAssets', 'assetId', ['productId', 'sha256']], ['masks', 'maskId', ['sourceAssetId', 'version']],
      ['jobs', 'jobId', ['productId', 'status', 'createdAt']], ['attempts', 'attemptId', ['jobId', 'status', 'submittedAt']],
      ['generatedAssets', 'assetId', ['attemptId', 'productId']], ['qaReports', 'qaId', ['assetId', 'createdAt']],
      ['userSettings', 'key', []], ['migrations', 'version', ['appliedAt']],
    ]) {
      const store = db.createObjectStore(name, { keyPath: key });
      for (const index of indexes) store.createIndex(index, index);
    }
    request.transaction.objectStore('products').add(product);
    request.transaction.objectStore('userSettings').add({ key: 'synthetic-preserve', value: 'retained' });
    request.transaction.objectStore('migrations').add({ version: 1, appliedAt: '2026-01-01T00:00:00.000Z' });
  };
  const db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  return { factory, db, product };
}
function open(factory, version) {
  return new Promise((resolve, reject) => {
    const request = version === undefined ? factory.open('product-image-studio') : factory.open('product-image-studio', version);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
async function read(db, store, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly'), request = tx.objectStore(store).get(key);
    tx.oncomplete = () => resolve(request.result); tx.onabort = () => reject(tx.error);
  });
}
test('upgrade preserves legacy data, closes the old connection and blocks reopening version 1', async () => {
  const { factory, db, product } = await legacyWorkspace();
  let closed = false; db.onversionchange = () => { closed = true; db.close(); };
  const runtime = await import(`${moduleUrl}#preserve`);
  assert.deepEqual(await runtime.getProduct(product.productId), product);
  assert.equal(closed, true);
  await assert.rejects(open(factory, 1), { name: 'VersionError' });
  const current = await open(factory);
  assert.equal(current.version, 3);
  assert.deepEqual(await read(current, 'userSettings', 'synthetic-preserve'), { key: 'synthetic-preserve', value: 'retained' });
  assert.equal((await read(current, 'migrations', 1)).version, 1);
  assert.equal((await read(current, 'migrations', 3)).version, 3);
  current.close();
});
test('a non-cooperating old tab blocks upgrade until it closes', async () => {
  const { factory, db, product } = await legacyWorkspace();
  db.onversionchange = () => {};
  const runtime = await import(`${moduleUrl}#blocked`);
  await assert.rejects(runtime.getProduct(product.productId), /blocked by another open tab/i);
  assert.equal((await read(db, 'products', product.productId)).sku, 'SYNTH-V1');
  db.close();
  const current = await open(factory);
  assert.equal(current.version, 3); current.close();
  assert.deepEqual(await runtime.getProduct(product.productId), product);
});
test('an incomplete version 1 schema aborts upgrade without modifying its data', async () => {
  const { factory, db, product } = await legacyWorkspace({ omitIndex: true });
  db.onversionchange = () => db.close();
  const runtime = await import(`${moduleUrl}#invalid`);
  await assert.rejects(runtime.getProduct(product.productId), /indexes are incomplete/i);
  const legacy = await open(factory, 1);
  assert.equal(legacy.version, 1);
  assert.deepEqual(await read(legacy, 'products', product.productId), product);
  assert.equal(await read(legacy, 'migrations', 2), undefined);
  legacy.close();
});

test('version 2 imported reviews are preserved as evidence but require a fresh review', async () => {
  const { factory, db, product } = await legacyWorkspace();
  db.close();
  const upgraded = await open(factory, 2);
  const attempts = [true, false].map((reviewed) => ({ attempt: { attemptId: randomUUID(), status: 'DEFINITIVE_FAILURE' }, reviewed }));
  await new Promise((resolve, reject) => {
    const tx = upgraded.transaction(['attempts', 'userSettings'], 'readwrite');
    for (const { attempt, reviewed } of attempts) {
      tx.objectStore('attempts').add(attempt);
      tx.objectStore('userSettings').add({ key: `backup-import-unresolved:${attempt.attemptId}`, snapshot: JSON.stringify(attempt), reviewed });
    }
    tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
  });
  upgraded.onversionchange = () => upgraded.close();
  const runtime = await import(`${moduleUrl}#marker-migration`);
  await runtime.getProduct(product.productId);
  await assert.rejects(open(factory, 2), { name: 'VersionError' });
  const current = await open(factory);
  for (const { attempt, reviewed } of attempts) {
    const key = `backup-import-unresolved:${attempt.attemptId}`;
    assert.deepEqual(await read(current, 'userSettings', key), { key, snapshot: JSON.stringify(attempt), reviewed: false, markerVersion: 2, legacyReviewed: reviewed });
    assert.deepEqual(await read(current, 'attempts', attempt.attemptId), attempt);
  }
  const before = await runtime.globalStudioReviewFingerprint();
  await runtime.resolveImportedUncertainty(attempts[0].attempt.attemptId);
  assert.notEqual(await runtime.globalStudioReviewFingerprint(), before);
  assert.equal((await read(current, 'userSettings', `backup-import-unresolved:${attempts[0].attempt.attemptId}`)).legacyReviewed, true);
  current.close();
});

test('invalid legacy marker aborts version 3 upgrade atomically', async () => {
  const { factory, db, product } = await legacyWorkspace();
  db.close();
  const legacy = await open(factory, 2);
  const key = `backup-import-unresolved:${randomUUID()}`;
  const marker = { key, snapshot: '{}', reviewed: true };
  await new Promise((resolve, reject) => {
    const tx = legacy.transaction('userSettings', 'readwrite'); tx.objectStore('userSettings').add(marker);
    tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
  });
  legacy.onversionchange = () => legacy.close();
  const runtime = await import(`${moduleUrl}#marker-invalid`);
  await assert.rejects(runtime.getProduct(product.productId), /inconsistent/i);
  const unchanged = await open(factory, 2);
  assert.deepEqual(await read(unchanged, 'userSettings', key), marker);
  assert.deepEqual(await read(unchanged, 'products', product.productId), product);
  assert.equal(await read(unchanged, 'migrations', 3), undefined);
  unchanged.close();
});
