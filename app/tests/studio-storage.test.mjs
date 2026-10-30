import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import 'fake-indexeddb/auto';
import { build } from 'vite';
import { STUDIO_PROMPT, STUDIO_MODEL, STUDIO_QUALITY, STUDIO_SIZE, STUDIO_PROMPT_VERSION, STUDIO_SCENE_PROMPT_VERSION, STUDIO_PRESET_VERSION, studioBuildPrompt, studioEstimateUSD } from '../studio-policy.mjs';

const built = await build({ configFile: 'vite.config.ts', logLevel: 'silent',
  build: { write: false, minify: false, lib: { entry: 'src/products.ts', formats: ['es'], fileName: 'products' } } });
const output = Array.isArray(built) ? built[0] : built;
const code = output.output.find((entry) => entry.type === 'chunk').code;
const { createProduct, getProduct, saveSource, createStudioAttempt: createWithConsent, updateStudioAttempt: updateWithConsent, listStudioAttempts, acknowledgeStudioAttempt, globalStudioReviewFingerprint, studioSessionEstimate, productSnapshotFingerprint, studioSceneContext } =
  await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const consentByAttempt = new Map();
async function createStudioAttempt(attempt, fingerprint) {
  const consent = fingerprint ?? await globalStudioReviewFingerprint();
  consentByAttempt.set(attempt.attemptId, consent);
  return createWithConsent(attempt, consent);
}
async function updateStudioAttempt(attempt, asset) {
  return updateWithConsent(attempt, asset, consentByAttempt.get(attempt.attemptId));
}

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

test('versioned prompt context and product snapshot are immutable across submission', async () => {
  const { productId, makeAttempt, db } = await fixture();
  const product = await getProduct(productId), source = product.sourceAssets[0];
  const sceneContext = studioSceneContext(product, source, []);
  const prompt = studioBuildPrompt('hero', sceneContext);
  const attempt = { ...makeAttempt(), styleId: 'hero', presetVersion: STUDIO_PRESET_VERSION,
    sceneContext, selectedFactIds: [], productSnapshotFingerprint: await productSnapshotFingerprint(product),
    prompt, promptVersion: STUDIO_SCENE_PROMPT_VERSION, estimatedUSD: studioEstimateUSD(prompt) };
  await createStudioAttempt(attempt);
  await assert.rejects(updateStudioAttempt({ ...attempt, status: 'SUBMITTED', sceneContext: { ...sceneContext, sourceView: 'TOP' } }), /context|identity/i);
  await new Promise((resolve, reject) => {
    const tx = db.transaction('products', 'readwrite'), store = tx.objectStore('products'), request = store.get(productId);
    request.onsuccess = () => store.put({ ...request.result, name: 'Changed product' });
    tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
  });
  await assert.rejects(updateStudioAttempt({ ...attempt, status: 'SUBMITTED' }), /context|changed/i);
});

test('an unrelated active mask pointer switch does not revoke a versioned job', async () => {
  const { productId, makeAttempt, db } = await fixture();
  const product = await getProduct(productId), source = product.sourceAssets[0];
  const sceneContext = studioSceneContext(product, source, []);
  const prompt = studioBuildPrompt('hero', sceneContext);
  const attempt = { ...makeAttempt(), styleId: 'hero', presetVersion: STUDIO_PRESET_VERSION,
    sceneContext, selectedFactIds: [], productSnapshotFingerprint: await productSnapshotFingerprint(product),
    prompt, promptVersion: STUDIO_SCENE_PROMPT_VERSION, estimatedUSD: studioEstimateUSD(prompt) };
  await createStudioAttempt(attempt);
  await new Promise((resolve, reject) => {
    const tx = db.transaction('products', 'readwrite'), store = tx.objectStore('products'), request = store.get(productId);
    request.onsuccess = () => { const current = request.result; current.brandLock.maskAssetId = randomUUID(); store.put(current); };
    tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
  });
  await updateStudioAttempt({ ...attempt, status: 'SUBMITTED' });
  await updateStudioAttempt({ ...attempt, status: 'DEFINITIVE_FAILURE' });
});

test('overhead confirmation cannot be forged or added after preparation', async () => {
  const { productId, makeAttempt } = await fixture();
  const product = await getProduct(productId), source = product.sourceAssets[0];
  const sceneContext = studioSceneContext(product, source, []);
  const prompt = studioBuildPrompt('flat_lay', sceneContext);
  const attempt = { ...makeAttempt(), styleId: 'flat_lay', presetVersion: STUDIO_PRESET_VERSION,
    sceneContext, selectedFactIds: [], productSnapshotFingerprint: await productSnapshotFingerprint(product),
    prompt, promptVersion: STUDIO_SCENE_PROMPT_VERSION, estimatedUSD: studioEstimateUSD(prompt) };
  await assert.rejects(createStudioAttempt({ ...attempt, topViewConfirmed: true }), /context|preset/i);
  await createStudioAttempt(attempt);
  await assert.rejects(updateStudioAttempt({ ...attempt, topViewConfirmed: true, status: 'SUBMITTED' }), /context|identity/i);
});

test('session estimate is reserved atomically across products and stale consent cannot send', async () => {
  const first = await fixture(), second = await fixture(), sessionId = randomUUID();
  const a = { ...first.makeAttempt(), budgetSessionId: sessionId, sessionPriorUSD: '0.000000' };
  const b = { ...second.makeAttempt(), budgetSessionId: sessionId, sessionPriorUSD: '0.000000' };
  const results = await Promise.allSettled([createStudioAttempt(a), createStudioAttempt(b)]);
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
  assert.match(results.find((item) => item.status === 'rejected').reason.message, /session estimate changed/);
  assert.equal(await studioSessionEstimate(sessionId), studioEstimateUSD());
  const winner = results[0].status === 'fulfilled' ? a : b;
  await updateStudioAttempt({ ...winner, status: 'DEFINITIVE_FAILURE' });
  assert.equal(await studioSessionEstimate(sessionId), studioEstimateUSD());
  assert.equal(await studioSessionEstimate(randomUUID()), '0.000000');
});

test('corrupt session association blocks totals instead of treating an attempt as free', async () => {
  const { makeAttempt, db } = await fixture(), sessionId = randomUUID();
  const attempt = { ...makeAttempt(), budgetSessionId: sessionId, sessionPriorUSD: '0.000000' };
  await createStudioAttempt(attempt);
  const storeAttempt = (value) => new Promise((resolve, reject) => {
    const tx = db.transaction('attempts', 'readwrite'); tx.objectStore('attempts').put(value);
    tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
  });
  const { budgetSessionId: ignored, ...corrupt } = attempt;
  try {
    await storeAttempt(corrupt);
    await assert.rejects(studioSessionEstimate(sessionId), /session metadata is invalid/);
  } finally { await storeAttempt(attempt); }
  assert.equal(await studioSessionEstimate(sessionId), studioEstimateUSD());
});

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
for (const status of ['DEFINITIVE_SUCCESS', 'DEFINITIVE_FAILURE']) {
  test(`cleanup-pending ${status} requires matching review and preserves the terminal job and image`, async () => {
    const { productId, makeAttempt, db } = await fixture();
    const a = makeAttempt(), pending = makeAttempt();
    await createStudioAttempt(a);
    await createStudioAttempt(pending);
    const staleFingerprint = await globalStudioReviewFingerprint();
    await updateStudioAttempt({ ...a, status: 'SUBMITTED' });
    const asset = status === 'DEFINITIVE_SUCCESS'
      ? { assetId: randomUUID(), attemptId: a.attemptId, productId, blob: new Blob(['paid image'], { type: 'image/png' }), sha256: 'c'.repeat(64) }
      : undefined;
    await updateStudioAttempt({ ...a, status, cleanupPending: true }, asset);
    const readJob = () => new Promise((resolve, reject) => {
      const request = db.transaction('jobs').objectStore('jobs').get(a.jobId);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const job = await readJob();
    await assert.rejects(createStudioAttempt(makeAttempt()), /in progress or UNKNOWN/);
    const timestamp = '2026-10-30T12:00:00.000Z';
    await assert.rejects(acknowledgeStudioAttempt(a.attemptId, timestamp, 'UNKNOWN'), /conflicts/);
    await assert.rejects(createStudioAttempt(makeAttempt()), /in progress or UNKNOWN/);
    await acknowledgeStudioAttempt(a.attemptId, timestamp, status);
    await acknowledgeStudioAttempt(a.attemptId, timestamp, status);
    await assert.rejects(acknowledgeStudioAttempt(a.attemptId, '2026-10-30T12:00:01.000Z', status), /conflicts/);
    const history = await listStudioAttempts(productId);
    const entry = history.find(({ attempt }) => attempt.attemptId === a.attemptId);
    assert.equal(entry.attempt.status, status);
    assert.equal(entry.attempt.recordedOutcome, status);
    assert.equal(entry.attempt.acknowledgedAt, timestamp);
    assert.deepEqual(await readJob(), job);
    if (asset) assert.equal(await entry.asset.blob.text(), 'paid image');
    else assert.equal(entry.asset, null);
    assert.equal(history.find(({ attempt }) => attempt.attemptId === pending.attemptId).attempt.status, 'DEFINITIVE_FAILURE');
    await assert.rejects(createStudioAttempt(makeAttempt(), staleFingerprint), /review changed/);
    await createStudioAttempt(makeAttempt());
  });
}


test('review is transactional, idempotent and preserves UNKNOWN job and attempt', async () => {
  const { productId, makeAttempt, db } = await fixture();
  const a = makeAttempt(), pending = makeAttempt();
  await Promise.all([createStudioAttempt(a), createStudioAttempt(pending)]);
  await updateStudioAttempt({ ...a, status: 'SUBMITTED' });
  const timestamp = '2026-10-30T12:00:00.000Z';
  await updateStudioAttempt({ ...a, status: 'UNKNOWN' });
  await assert.rejects(updateStudioAttempt({ ...pending, status: 'SUBMITTED' }), /UNKNOWN/);
  await assert.rejects(acknowledgeStudioAttempt(a.attemptId, 'not a date', 'UNKNOWN'), /Invalid/);
  await assert.rejects(acknowledgeStudioAttempt(a.attemptId, timestamp, 'OTHER'), /Invalid/);
  await assert.rejects(createStudioAttempt(makeAttempt()), /UNKNOWN/);
  await Promise.all([acknowledgeStudioAttempt(a.attemptId, timestamp, 'DEFINITIVE_SUCCESS'), acknowledgeStudioAttempt(a.attemptId, timestamp, 'DEFINITIVE_SUCCESS')]);
  await assert.rejects(acknowledgeStudioAttempt(a.attemptId, timestamp, 'UNKNOWN'), /conflicts/);
  const history = await listStudioAttempts(productId);
  const reviewed = history.find(({ attempt }) => attempt.attemptId === a.attemptId).attempt;
  assert.equal(reviewed.status, 'UNKNOWN');
  assert.equal(reviewed.acknowledgedAt, timestamp);
  assert.equal(reviewed.recordedOutcome, 'DEFINITIVE_SUCCESS');
  const job = await new Promise((resolve, reject) => {
    const request = db.transaction('jobs').objectStore('jobs').get(a.jobId);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  assert.equal(job.status, 'UNKNOWN');
  assert.equal(job.attempts[0].outcome, 'UNKNOWN');
  assert.equal(history.find(({ attempt }) => attempt.attemptId === pending.attemptId).attempt.status, 'DEFINITIVE_FAILURE');
  const pendingJob = await new Promise((resolve, reject) => {
    const request = db.transaction('jobs').objectStore('jobs').get(pending.jobId);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  assert.equal(pendingJob.status, 'FAILED');
  assert.equal(pendingJob.attempts[0].submittedAt, null);
  assert.equal(pendingJob.attempts[0].outcome, 'DEFINITIVE_FAILURE');
  await assert.rejects(updateStudioAttempt({ ...pending, status: 'SUBMITTED' }), /Invalid or repeated/);
  const fresh = makeAttempt();
  await createStudioAttempt(fresh);
  await updateStudioAttempt({ ...fresh, status: 'SUBMITTED' });
  await assert.rejects(createStudioAttempt(makeAttempt()), /in progress/);
});

test('malformed persisted review cannot bypass creation or submission', async () => {
  const { makeAttempt, db } = await fixture();
  const a = makeAttempt(), pending = makeAttempt();
  await Promise.all([createStudioAttempt(a), createStudioAttempt(pending)]);
  await updateStudioAttempt({ ...a, status: 'SUBMITTED' });
  await updateStudioAttempt({ ...a, status: 'UNKNOWN' });
  for (const fields of [
    { acknowledgedAt: '2026-10-30T12:00:00.000Z' },
    { acknowledgedAt: '2026-02-30T12:00:00.000Z', recordedOutcome: 'UNKNOWN' },
    { acknowledgedAt: '2026-10-30T12:00:00.000Z', recordedOutcome: 'OTHER' },
  ]) {
    await new Promise((resolve, reject) => {
      const tx = db.transaction('attempts', 'readwrite'), store = tx.objectStore('attempts');
      const request = store.get(a.attemptId);
      request.onsuccess = () => { const value = request.result; delete value.acknowledgedAt; delete value.recordedOutcome; store.put({ ...value, ...fields }); };
      tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
    });
    await assert.rejects(createStudioAttempt(makeAttempt()), /UNKNOWN/);
    await assert.rejects(updateStudioAttempt({ ...pending, status: 'SUBMITTED' }), /UNKNOWN/);
  }
});

test('caller cannot inject review into ordinary attempt transitions', async () => {
  const { makeAttempt } = await fixture();
  const attempt = makeAttempt(), receipt = { acknowledgedAt: '2026-10-30T12:00:00.000Z', recordedOutcome: 'UNKNOWN' };
  await assert.rejects(createStudioAttempt({ ...attempt, ...receipt }), /prepared/);
  await createStudioAttempt(attempt);
  await assert.rejects(updateStudioAttempt({ ...attempt, status: 'SUBMITTED', ...receipt }), /changed/);
  await updateStudioAttempt({ ...attempt, status: 'SUBMITTED' });
  await assert.rejects(updateStudioAttempt({ ...attempt, status: 'UNKNOWN', ...receipt }), /changed/);
});

test('interrupted submission stays blocked until a receipt is saved and then replays safely', async () => {
  const { productId, makeAttempt, db } = await fixture();
  const attempt = makeAttempt(), pending = makeAttempt();
  await Promise.all([createStudioAttempt(attempt), createStudioAttempt(pending)]);
  await updateStudioAttempt({ ...attempt, status: 'SUBMITTED' });
  await assert.rejects(createStudioAttempt(makeAttempt()), /in progress/);
  await assert.rejects(updateStudioAttempt({ ...pending, status: 'SUBMITTED' }), /in progress/);
  await assert.rejects(acknowledgeStudioAttempt(attempt.attemptId, 'invalid', 'UNKNOWN'), /Invalid/);
  assert.equal((await listStudioAttempts(productId)).find(({ attempt: item }) => item.attemptId === attempt.attemptId).attempt.status, 'SUBMITTED');
  const timestamp = '2026-10-30T12:00:00.000Z';
  await acknowledgeStudioAttempt(attempt.attemptId, timestamp, 'DEFINITIVE_FAILURE');
  await acknowledgeStudioAttempt(attempt.attemptId, timestamp, 'DEFINITIVE_FAILURE');
  const saved = (await listStudioAttempts(productId)).find(({ attempt: item }) => item.attemptId === attempt.attemptId).attempt;
  assert.equal(saved.status, 'UNKNOWN');
  assert.equal(saved.acknowledgedAt, timestamp);
  assert.equal(saved.recordedOutcome, 'DEFINITIVE_FAILURE');
  const job = await new Promise((resolve, reject) => {
    const request = db.transaction('jobs').objectStore('jobs').get(attempt.jobId);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  assert.equal(job.status, 'UNKNOWN');
  assert.equal(job.attempts[0].outcome, 'UNKNOWN');
  await assert.rejects(updateStudioAttempt({ ...pending, status: 'SUBMITTED' }), /Invalid or repeated/);
});

test('consent taken before review cannot create a later attempt', async () => {
  const { productId, makeAttempt } = await fixture();
  const first = makeAttempt();
  await createStudioAttempt(first);
  await updateStudioAttempt({ ...first, status: 'SUBMITTED' });
  await updateStudioAttempt({ ...first, status: 'UNKNOWN' });
  const oldConsent = await globalStudioReviewFingerprint();
  await acknowledgeStudioAttempt(first.attemptId, '2026-10-30T12:00:00.000Z', 'UNKNOWN');
  await assert.rejects(createStudioAttempt(makeAttempt(), oldConsent), /review changed/);
  await createStudioAttempt(makeAttempt());
});

test('recovery lock version is validated and immutable', async () => {
  const { makeAttempt } = await fixture();
  for (const recoveryLockVersion of [0, 2, '1', null]) {
    await assert.rejects(createStudioAttempt({ ...makeAttempt(), recoveryLockVersion }), /valid recovery lock version/);
  }
  const attempt = { ...makeAttempt(), recoveryLockVersion: 1 };
  await createStudioAttempt(attempt);
  await assert.rejects(updateStudioAttempt({ ...attempt, status: 'SUBMITTED', recoveryLockVersion: undefined }), /changed/);
});

test('submission checks the consent fingerprint atomically', async () => {
  const { makeAttempt } = await fixture();
  const attempt = makeAttempt();
  await createStudioAttempt(attempt);
  await assert.rejects(updateWithConsent({ ...attempt, status: 'SUBMITTED' }, undefined, 'stale'), /review changed/);
  await updateStudioAttempt({ ...attempt, status: 'SUBMITTED' });
});

test('review in another product invalidates pending jobs and stale consent globally', async () => {
  const firstProduct = await fixture(), secondProduct = await fixture();
  const reviewed = firstProduct.makeAttempt(), pending = secondProduct.makeAttempt();
  await createStudioAttempt(reviewed);
  await updateStudioAttempt({ ...reviewed, status: 'SUBMITTED' });
  await updateStudioAttempt({ ...reviewed, status: 'UNKNOWN' });
  const oldConsent = await globalStudioReviewFingerprint();
  await createStudioAttempt(pending, oldConsent);
  await acknowledgeStudioAttempt(reviewed.attemptId, '2026-10-30T12:00:00.000Z', 'UNKNOWN');
  await assert.rejects(createStudioAttempt(secondProduct.makeAttempt(), oldConsent), /review changed/);
  const history = await listStudioAttempts(secondProduct.productId);
  assert.equal(history.find(({ attempt }) => attempt.attemptId === pending.attemptId).attempt.status, 'DEFINITIVE_FAILURE');
  const job = await new Promise((resolve, reject) => {
    const request = secondProduct.db.transaction('jobs').objectStore('jobs').get(pending.jobId);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  assert.equal(job.status, 'FAILED');
  assert.equal(job.attempts[0].submittedAt, null);
  await assert.rejects(updateStudioAttempt({ ...pending, status: 'SUBMITTED' }), /Invalid or repeated/);
  const fresh = secondProduct.makeAttempt();
  await createStudioAttempt(fresh);
  await assert.rejects(updateWithConsent({ ...fresh, status: 'SUBMITTED' }, undefined, oldConsent), /review changed/);
  await updateStudioAttempt({ ...fresh, status: 'SUBMITTED' });
});

test('valid durable receipt repairs malformed or incomplete local acknowledgement but not a valid conflict', async () => {
  for (const fields of [
    { acknowledgedAt: '2026-10-30T12:00:00.000Z' },
    { recordedOutcome: 'UNKNOWN' },
    { acknowledgedAt: 'bad', recordedOutcome: 'UNKNOWN' },
    { acknowledgedAt: '2026-10-30T12:00:00.000Z', recordedOutcome: 'OTHER' },
  ]) {
    const { productId, makeAttempt, db } = await fixture();
    const attempt = makeAttempt();
    await createStudioAttempt(attempt);
    await updateStudioAttempt({ ...attempt, status: 'SUBMITTED' });
    await updateStudioAttempt({ ...attempt, status: 'UNKNOWN' });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('attempts', 'readwrite'), store = tx.objectStore('attempts');
      const request = store.get(attempt.attemptId);
      request.onsuccess = () => store.put({ ...request.result, ...fields });
      tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
    });
    const timestamp = '2026-10-30T12:00:00.000Z';
    await acknowledgeStudioAttempt(attempt.attemptId, timestamp, 'DEFINITIVE_SUCCESS');
    const saved = (await listStudioAttempts(productId)).find(({ attempt: item }) => item.attemptId === attempt.attemptId).attempt;
    assert.equal(saved.status, 'UNKNOWN');
    assert.equal(saved.acknowledgedAt, timestamp);
    assert.equal(saved.recordedOutcome, 'DEFINITIVE_SUCCESS');
    await assert.rejects(acknowledgeStudioAttempt(attempt.attemptId, timestamp, 'UNKNOWN'), /conflicts/);
  }
});

test('a completed scene cannot be overwritten by a racing review', async () => {
  const { productId, makeAttempt } = await fixture();
  const attempt = { ...makeAttempt(), recoveryLockVersion: 1 };
  await createStudioAttempt(attempt);
  await updateStudioAttempt({ ...attempt, status: 'SUBMITTED' });
  const asset = { assetId: randomUUID(), attemptId: attempt.attemptId, productId, blob: new Blob(['scene'], { type: 'image/png' }), sha256: 'c'.repeat(64) };
  await updateStudioAttempt({ ...attempt, status: 'DEFINITIVE_SUCCESS' }, asset);
  await assert.rejects(acknowledgeStudioAttempt(attempt.attemptId, '2026-10-30T12:00:00.000Z', 'UNKNOWN'), /Only a saved/);
  const saved = (await listStudioAttempts(productId)).find((entry) => entry.attempt.attemptId === attempt.attemptId);
  assert.equal(saved.attempt.status, 'DEFINITIVE_SUCCESS');
  assert.equal(saved.asset.assetId, asset.assetId);
  assert.equal(await saved.asset.blob.text(), 'scene');
});
