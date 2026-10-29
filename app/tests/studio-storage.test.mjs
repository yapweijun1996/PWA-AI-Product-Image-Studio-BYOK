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
const { createProduct, saveSource, createStudioAttempt, updateStudioAttempt, listStudioAttempts } =
  await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

async function fixture() {
  const product = await createProduct({ sku: randomUUID(), name: 'Synthetic product', category: 'Test', rightsAcknowledged: true });
  const source = { assetId: randomUUID(), sha256: 'a'.repeat(64), mimeType: 'image/png', width: 1, height: 1, cameraView: 'FRONT', filename: 'source.png' };
  await saveSource(product.productId, { file: new File(['synthetic'], source.filename, { type: source.mimeType }), metadata: source, exifOrientation: 1, previewUrl: '' }, 'FRONT');
  const maskId = randomUUID(), maskSha256 = 'b'.repeat(64);
  const db = await new Promise((resolve, reject) => { const request = indexedDB.open('product-image-studio'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['products', 'masks'], 'readwrite');
    const products = tx.objectStore('products');
    const request = products.get(product.productId);
    request.onsuccess = () => { const value = request.result; value.brandLock.maskAssetId = maskId; products.put(value); };
    tx.objectStore('masks').add({ maskId, productId: product.productId, sourceAssetId: source.assetId, sourceSha256: source.sha256, sha256: maskSha256 });
    tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
  });
  function makeAttempt() {
    return { attemptId: randomUUID(), jobId: randomUUID(), productId: product.productId, sourceAssetId: source.assetId,
      sourceSha256: source.sha256, maskId, maskSha256, prompt: STUDIO_PROMPT, promptVersion: STUDIO_PROMPT_VERSION,
      model: STUDIO_MODEL, quality: STUDIO_QUALITY, size: STUDIO_SIZE, estimatedUSD: studioEstimateUSD(),
      submittedAt: new Date().toISOString(), status: 'PREPARED', usage: null, observedUSD: null };
  }
  return { productId: product.productId, makeAttempt, db };
}

test('concurrent tabs cannot submit a second attempt while one is in flight or UNKNOWN', async () => {
  const { productId, makeAttempt } = await fixture();
  const a = makeAttempt(), b = makeAttempt();
  await Promise.all([createStudioAttempt(a), createStudioAttempt(b)]);
  const results = await Promise.allSettled([
    updateStudioAttempt({ ...a, status: 'SUBMITTED' }),
    updateStudioAttempt({ ...b, status: 'SUBMITTED' }),
  ]);
  assert.equal(results.filter((value) => value.status === 'fulfilled').length, 1);
  assert.equal(results.filter((value) => value.status === 'rejected').length, 1);
  const winner = results[0].status === 'fulfilled' ? a : b;
  await assert.rejects(createStudioAttempt(makeAttempt()), /in progress or UNKNOWN/);
  await updateStudioAttempt({ ...winner, status: 'UNKNOWN' });
  await assert.rejects(createStudioAttempt(makeAttempt()), /in progress or UNKNOWN/);
  const history = await listStudioAttempts(productId);
  assert.equal(history.filter(({ attempt }) => attempt.status === 'UNKNOWN').length, 1);
  assert.equal(history.filter(({ attempt }) => attempt.status === 'SUBMITTED').length, 0);
});

test('a changed active mask prevents an approved attempt from reaching submission', async () => {
  const { productId, makeAttempt, db } = await fixture();
  const attempt = makeAttempt();
  await createStudioAttempt(attempt);
  await new Promise((resolve, reject) => {
    const tx = db.transaction('products', 'readwrite'), store = tx.objectStore('products');
    const request = store.get(productId);
    request.onsuccess = () => { const product = request.result; product.brandLock.maskAssetId = null; store.put(product); };
    tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
  });
  await assert.rejects(updateStudioAttempt({ ...attempt, status: 'SUBMITTED' }), /active mask changed/);
  const history = await listStudioAttempts(productId);
  assert.equal(history[0].attempt.status, 'PREPARED');
});
