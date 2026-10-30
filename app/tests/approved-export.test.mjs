import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID, webcrypto, createHash } from 'node:crypto';
import { build } from 'vite';
import { BlobReader, TextWriter, ZipReader } from '@zip.js/zip.js/lib/zip-core-native.js';
import { STUDIO_MODEL, STUDIO_PROMPT, STUDIO_PROMPT_VERSION, studioEstimateUSD } from '../studio-policy.mjs';

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
