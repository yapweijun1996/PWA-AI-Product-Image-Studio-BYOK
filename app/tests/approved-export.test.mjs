import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID, webcrypto, createHash } from 'node:crypto';
import { build } from 'vite';
import { BlobReader, BlobWriter, TextWriter, ZipReader } from '@zip.js/zip.js/lib/zip-core-native.js';
import { STUDIO_MODEL, STUDIO_PROMPT, STUDIO_PROMPT_VERSION, STUDIO_SCENE_PROMPT_VERSION, STUDIO_PRESET_VERSION, studioBuildPrompt, studioEstimateUSD } from '../studio-policy.mjs';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const result = await build({ configFile: 'vite.config.ts', logLevel: 'silent', build: { write: false, minify: false, lib: { entry: 'src/approvedExport.ts', formats: ['es'], fileName: 'approved-export' } } });
const output = Array.isArray(result) ? result[0] : result;
const code = output.output.find((entry) => entry.type === 'chunk').code;
const { renderApprovedOutput, packageApprovedOutputs } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const signal = () => new AbortController().signal;
function png(width, height) {
  const bytes = new Uint8Array(45), view = new DataView(bytes.buffer);
  bytes.set([137,80,78,71,13,10,26,10]); view.setUint32(8, 13); bytes.set(Buffer.from('IHDR'), 12);
  view.setUint32(16, width); view.setUint32(20, height); bytes.set([8,6,0,0,0], 24);
  bytes.set(Buffer.from('IEND'), 37);
  return new Blob([bytes], { type: 'image/png' });
}
function jpeg(width, height) {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 8, 8, 0, 0, 0, 0, 1, 0xff, 0xd9]);
  const view = new DataView(bytes.buffer); view.setUint16(7, height); view.setUint16(9, width);
  return new Blob([bytes], { type: 'image/jpeg' });
}
let fallback = false;
globalThis.createImageBitmap = async () => ({ width: 1024, height: 1024, close() {} });
globalThis.document = { createElement() { return {
  width: 0, height: 0,
  getContext() { return { set fillStyle(_value) {}, fillRect() {}, drawImage() {} }; },
  toBlob(callback, type) { callback(fallback || type === 'image/png' ? png(this.width, this.height) : type === 'image/jpeg' ? jpeg(this.width, this.height) : new Blob([], { type })); },
}; } };
async function fixture() {
  const rendered = await renderApprovedOutput(png(1024, 1024), 'png', '4:5', signal());
  const selection = { attemptId: randomUUID(), assetId: randomUUID(), productSha256: 'a'.repeat(64), assetSha256: rendered.conversion.sourceSha256, reviewId: randomUUID(), decisionId: randomUUID() };
  const provenance = { ...selection, jobId: randomUUID(), model: STUDIO_MODEL, promptVersion: STUDIO_PROMPT_VERSION, prompt: STUDIO_PROMPT, promptSha256: createHash('sha256').update(STUDIO_PROMPT).digest('hex'), quality: 'low', size: '1024x1024', styleId: 'studio', createdAt: '2026-01-01T00:00:00Z', usage: null, estimatedUSD: studioEstimateUSD(), observedUSD: null, pricingSnapshot: null, submittedAt: '2026-01-01T00:00:00Z', reviewedAt: '2026-01-01T00:00:00Z', decidedAt: '2026-01-01T00:00:00Z', sourceAssetId: randomUUID(), sourceSha256: 'b'.repeat(64), maskId: randomUUID(), maskSha256: 'c'.repeat(64), sceneAssetId: randomUUID(), sceneSha256: 'd'.repeat(64) };
  return { selection, provenance, rendered };
}
async function unpack(blob) {
  const reader = new ZipReader(new BlobReader(blob), { useWebWorkers: false });
  try { const entries = await reader.getEntries(); return Object.fromEntries(await Promise.all(entries.map(async (entry) => [entry.filename, entry.filename.endsWith('.json') ? JSON.parse(await entry.getData(new TextWriter())) : null]))); }
  finally { await reader.close(); }
}
test('rejects wrong source geometry, encoder fallback and cancellation', async () => {
  await assert.rejects(renderApprovedOutput(png(1000, 1024), 'png', '1:1', signal()), /dimensions/i);
  fallback = true;
  try { await assert.rejects(renderApprovedOutput(png(1024, 1024), 'webp', '1:1', signal()), /encoder/i); }
  finally { fallback = false; }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(renderApprovedOutput(png(1024, 1024), 'png', '1:1', controller.signal), { name: 'AbortError' });
});
test('HTML image fallback verifies decoded dimensions and releases its URL on success, failure and abort', async () => {
  const bitmap = globalThis.createImageBitmap, originalImage = globalThis.Image;
  const createURL = URL.createObjectURL, revokeURL = URL.revokeObjectURL;
  let width = 1024, revoked = 0, controller;
  try {
    globalThis.createImageBitmap = undefined;
    URL.createObjectURL = () => 'blob:fixture';
    URL.revokeObjectURL = () => { revoked++; };
    globalThis.Image = class {
      naturalWidth = width;
      naturalHeight = 1024;
      set src(_value) { queueMicrotask(() => controller ? controller.abort() : this.onload?.()); }
    };
    const rendered = await renderApprovedOutput(png(1024, 1024), 'png', '1:1', signal());
    assert.equal(rendered.conversion.outputWidth, 1024);
    assert.equal(revoked, 1);
    width = 1000;
    await assert.rejects(renderApprovedOutput(png(1024, 1024), 'png', '1:1', signal()), /dimensions/i);
    assert.equal(revoked, 2);
    width = 1024; controller = new AbortController();
    await assert.rejects(renderApprovedOutput(png(1024, 1024), 'png', '1:1', controller.signal), { name: 'AbortError' });
    assert.equal(revoked, 3);
  } finally {
    globalThis.createImageBitmap = bitmap; globalThis.Image = originalImage;
    URL.createObjectURL = createURL; URL.revokeObjectURL = revokeURL;
  }
});
test('bundle contains only UUID-named output and allowlisted provenance', async () => {
  const entry = await fixture();
  entry.provenance.note = 'private note'; entry.provenance.filename = 'secret.jpg';
  const contents = await unpack(await packageApprovedOutputs(randomUUID(), [entry], signal()));
  assert.deepEqual(Object.keys(contents).sort(), ['export-manifest.json', `outputs/${entry.selection.assetId}.png`, `provenance/${entry.selection.assetId}.json`].sort());
  const json = JSON.stringify(contents);
  assert.ok(!json.includes('private note') && !json.includes('secret.jpg'));
  assert.equal(contents['export-manifest.json'].approvedOnly, true);
  assert.equal(contents[`provenance/${entry.selection.assetId}.json`].bundleType, 'approved-output-bundle');
});
test('preserves supported nested usage exactly and rejects inconsistent totals', async () => {
  const entry = await fixture();
  entry.provenance.usage = { input_tokens: 12, output_tokens: 4, total_tokens: 16, input_tokens_details: { text_tokens: 10, image_tokens: 2 }, output_tokens_details: { image_tokens: 4 } };
  const contents = await unpack(await packageApprovedOutputs(randomUUID(), [entry], signal()));
  assert.deepEqual(contents[`provenance/${entry.selection.assetId}.json`].usage, entry.provenance.usage);
  entry.provenance.usage.total_tokens = 17;
  await assert.rejects(packageApprovedOutputs(randomUUID(), [entry], signal()), /provenance/i);
});
test('rejects duplicates, mismatched hashes, unsupported prompt and unsafe usage', async () => {
  const entry = await fixture(), product = randomUUID();
  await assert.rejects(packageApprovedOutputs(product, [entry, entry], signal()), /duplicate/i);
  await assert.rejects(packageApprovedOutputs(product, [{ ...entry, rendered: { ...entry.rendered, sha256: '0'.repeat(64) } }], signal()), /hash/i);
  await assert.rejects(packageApprovedOutputs(product, [{ ...entry, provenance: { ...entry.provenance, prompt: 'private' } }], signal()), /provenance/i);
  await assert.rejects(packageApprovedOutputs(product, [{ ...entry, provenance: { ...entry.provenance, usage: { input_tokens: 2, secret: 'key' } } }], signal()), /provenance/i);
  await assert.rejects(packageApprovedOutputs(product, [], signal()), /selection/i);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(packageApprovedOutputs(product, [entry], controller.signal), { name: 'AbortError' });
});

const digest = (value) => createHash('sha256').update(value).digest('hex');
async function styledFixture(style = 'studio') {
  const entry = await fixture();
  const context = { productName: 'Cup', category: 'Kitchen', confirmedFacts: ['Color: blue'], sourceView: 'OTHER' };
  const prompt = studioBuildPrompt(style, context);
  const recipe = { version: 1, styleId: style, sourceView: 'OTHER', ...(style === 'billboard' ? { display: { x: 100, y: 200, width: 512, height: 512 }, displayFrontFacing: true, copy: 'Hello' } : {}) };
  if (style === 'billboard') {
    entry.copyLayer = png(1024, 1024);
    recipe.copyLayerSha256 = digest(Buffer.from(await entry.copyLayer.arrayBuffer()));
  }
  const mapping = style === 'billboard'
    ? { x: 100, y: 200, width: 512, height: 512, sourceWidth: 1024, sourceHeight: 1024 }
    : { x: 102.39999999999998, y: 102.39999999999998, width: 819.2, height: 819.2, sourceWidth: 1024, sourceHeight: 1024 };
  Object.assign(entry.provenance, { styleId: style, promptVersion: STUDIO_SCENE_PROMPT_VERSION, presetVersion: STUDIO_PRESET_VERSION, sceneContext: context, selectedFactIds: [randomUUID()], productSnapshotFingerprint: 'e'.repeat(64), prompt, promptSha256: digest(prompt), estimatedUSD: studioEstimateUSD(prompt), recipe, recipeSha256: digest(JSON.stringify(recipe)), mapping });
  if (style === 'billboard') { entry.ad = png(1024, 1024); entry.provenance.adSha256 = digest(Buffer.from(await entry.ad.arrayBuffer())); }
  return entry;
}

test('output provenance preserves a valid protected evidence digest', async () => {
  for (const makeEntry of [fixture, styledFixture]) {
    const entry = await makeEntry();
    entry.provenance.protectedEvidenceSha256 = 'a'.repeat(64);
    const contents = await unpack(await packageApprovedOutputs(randomUUID(), [entry], signal()));
    assert.equal(contents[`provenance/${entry.selection.assetId}.json`].protectedEvidenceSha256, 'a'.repeat(64));
    entry.provenance.protectedEvidenceSha256 = 'not-a-hash';
    await assert.rejects(packageApprovedOutputs(randomUUID(), [entry], signal()), /provenance/i);
  }
});

test('exports only a valid immediate retry parent and accepts historical provenance without it', async () => {
  for (const makeEntry of [fixture, styledFixture]) {
    const entry = await makeEntry(), product = randomUUID(), path = `provenance/${entry.selection.assetId}.json`;
    const historical = await unpack(await packageApprovedOutputs(product, [entry], signal()));
    assert.equal(Object.hasOwn(historical[path], 'retryOf'), false);

    const retryOf = randomUUID();
    entry.provenance.retryOf = retryOf;
    const contents = await unpack(await packageApprovedOutputs(product, [entry], signal()));
    assert.equal(contents[path].retryOf, retryOf);
    assert.equal(JSON.stringify(contents).split(retryOf).length - 1, 1);

    for (const value of [undefined, null, '', 'not-a-uuid', 42, { id: retryOf }, entry.selection.attemptId]) {
      await assert.rejects(packageApprovedOutputs(product, [{ ...entry, provenance: { ...entry.provenance, retryOf: value } }], signal()), /provenance/i);
    }
  }
});

test('versioned provenance is retained; incomplete and altered scene or recipe are rejected', async () => {
  const entry = await styledFixture(), product = randomUUID();
  const contents = await unpack(await packageApprovedOutputs(product, [entry], signal()));
  const receipt = contents[`provenance/${entry.selection.assetId}.json`];
  assert.deepEqual(receipt.sceneContext, entry.provenance.sceneContext);
  assert.deepEqual(receipt.selectedFactIds, entry.provenance.selectedFactIds);
  assert.deepEqual(receipt.recipe, entry.provenance.recipe);
  for (const change of [
    { prompt: entry.provenance.prompt + ' altered' },
    { presetVersion: undefined },
    { selectedFactIds: [] },
    { recipeSha256: '0'.repeat(64) },
    { recipe: { ...entry.provenance.recipe, styleId: 'hero' } },
    { mapping: { ...entry.provenance.mapping, x: 0 } },
    { sceneContext: { ...entry.provenance.sceneContext, unknown: true } },
  ]) await assert.rejects(packageApprovedOutputs(product, [{ ...entry, provenance: { ...entry.provenance, ...change } }], signal()));
});

test('billboard bundle includes the complete ad with verified manifest hash and rejects missing or tampered ads and secrets', async () => {
  const entry = await styledFixture('billboard'), product = randomUUID();
  const archive = await packageApprovedOutputs(product, [entry], signal());
  const contents = await unpack(archive), path = `ads/${entry.selection.assetId}.png`;
  const record = contents['export-manifest.json'].files.find((item) => item.path === path);
  assert.equal(record.sha256, entry.provenance.adSha256);
  const layerPath = `copy-layers/${entry.selection.assetId}.png`;
  assert.equal(contents['export-manifest.json'].files.find((item) => item.path === layerPath).sha256, entry.provenance.recipe.copyLayerSha256);
  const reader = new ZipReader(new BlobReader(archive), { useWebWorkers: false });
  try {
    const file = (await reader.getEntries()).find((item) => item.filename === path);
    const blob = await file.getData(new BlobWriter('image/png'));
    assert.deepEqual(Buffer.from(await blob.arrayBuffer()), Buffer.from(await entry.ad.arrayBuffer()));
    const layer = (await reader.getEntries()).find((item) => item.filename === layerPath);
    assert.deepEqual(Buffer.from(await (await layer.getData(new BlobWriter('image/png'))).arrayBuffer()), Buffer.from(await entry.copyLayer.arrayBuffer()));
  } finally { await reader.close(); }
  await assert.rejects(packageApprovedOutputs(product, [{ ...entry, ad: undefined }], signal()));
  await assert.rejects(packageApprovedOutputs(product, [{ ...entry, ad: png(100, 100) }], signal()));
  await assert.rejects(packageApprovedOutputs(product, [{ ...entry, provenance: { ...entry.provenance, adSha256: '0'.repeat(64) } }], signal()));
  await assert.rejects(packageApprovedOutputs(product, [{ ...entry, copyLayer: undefined }], signal()));
  await assert.rejects(packageApprovedOutputs(product, [{ ...entry, copyLayer: png(100, 100) }], signal()));
  const recipe = { ...entry.provenance.recipe, copy: 'password: mysecret' };
  await assert.rejects(packageApprovedOutputs(product, [{ ...entry, provenance: { ...entry.provenance, recipe, recipeSha256: digest(JSON.stringify(recipe)) } }], signal()));
});

test('16:9 fits the whole square composite with horizontal margins', async () => {
  const rendered = await renderApprovedOutput(png(1024, 1024), 'png', '16:9', signal());
  assert.equal(rendered.conversion.outputWidth, 1600);
  assert.equal(rendered.conversion.outputHeight, 900);
  assert.equal(rendered.conversion.width, 900);
  assert.equal(rendered.conversion.height, 900);
  assert.equal(rendered.conversion.x, 350);
  assert.equal(rendered.conversion.y, 0);
  const entry = await styledFixture('billboard');
  await packageApprovedOutputs(randomUUID(), [{ ...entry, rendered }], signal());
});
