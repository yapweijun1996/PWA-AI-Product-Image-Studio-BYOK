import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateSync, inflateSync } from 'node:zlib';
import { createHash, randomUUID } from 'node:crypto';
import { build } from 'vite';

const result = await build({
  configFile: 'vite.config.ts', logLevel: 'silent',
  build: { write: false, minify: false, lib: { entry: 'src/products.ts', formats: ['es'], fileName: 'products' } },
});
const output = Array.isArray(result) ? result[0] : result;
const code = output.output.find((entry) => entry.type === 'chunk').code;
const { checkBackupPixelWork, validateBackupMasks } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(name, data) {
  const type = Buffer.from(name), out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0); type.copy(out, 4); data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([type, data])), data.length + 8);
  return out;
}
function png(alpha) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.from([0, 0, 0, 0, alpha]))), chunk('IEND', Buffer.alloc(0))]);
}
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sourceId = 'aa970e57-a1c4-4b97-bd01-bd7416e64de2';
const maskId = 'ba970e57-a1c4-4b97-bd01-bd7416e64de2';
const productId = 'db1ea59a-0748-47a9-b287-1ae08216c004';
const source = { assetId: sourceId, sha256: 'a'.repeat(64), width: 1, height: 1 };
const product = { productId, sourceAssets: [source], brandLock: { maskAssetId: maskId } };
const sources = [{ metadata: source, blob: new Blob(['synthetic'], { type: 'image/jpeg' }), exifOrientation: 1 }];
function mask(bytes = png(100), changes = {}) {
  return { metadata: { maskId, productId, sourceAssetId: sourceId, sourceSha256: source.sha256, width: 1, height: 1, sha256: digest(bytes), version: 1, ...changes }, blob: new Blob([bytes], { type: 'image/png' }) };
}

globalThis.createImageBitmap = async (blob) => {
  if (blob.type === 'image/jpeg') return { width: 1, height: 1, alpha: 120, close() {} };
  const data = Buffer.from(await blob.arrayBuffer());
  const length = data.readUInt32BE(33);
  return { width: 1, height: 1, alpha: inflateSync(data.subarray(41, 41 + length))[4], close() {} };
};
globalThis.document = { createElement() {
  let current;
  return { width: 0, height: 0, getContext() { return {
    clearRect() {}, drawImage(image) { current = image; },
    getImageData() { return { data: new Uint8ClampedArray([0, 0, 0, current.alpha]) }; },
  }; } };
} };

test('accepts a verified linked mask with alpha within the original', async () => {
  const item = mask();
  const verified = await validateBackupMasks(product, [item], sources);
  assert.equal(verified[0].metadata.sha256, item.metadata.sha256);
  assert.deepEqual(new Uint8Array(await verified[0].blob.arrayBuffer()), new Uint8Array(await item.blob.arrayBuffer()));
});

test('rejects corrupt, truncated, mismatched and over-opaque masks', async () => {
  const corrupt = png(100); corrupt[45] ^= 1;
  const truncated = png(100).subarray(0, -3);
  for (const item of [mask(corrupt), mask(truncated), mask(png(100), { sha256: '0'.repeat(64) }), mask(png(100), { sourceSha256: '0'.repeat(64) }), mask(png(121))]) {
    await assert.rejects(validateBackupMasks(product, [item], sources));
  }
});

test('rejects a mask that selects no visible source pixels', async () => {
  await assert.rejects(validateBackupMasks(product, [mask(png(0))], sources), /at least one visible source pixel/);
});

test('rejects missing pointers, duplicate versions and unsupported metadata', async () => {
  const item = mask();
  await assert.rejects(validateBackupMasks(product, [], sources), /active mask/i);
  const duplicate = mask(png(80), { maskId: 'ca970e57-a1c4-4b97-bd01-bd7416e64de2' });
  await assert.rejects(validateBackupMasks(product, [item, duplicate], sources), /duplicate/i);
  await assert.rejects(validateBackupMasks(product, [mask(png(100), { extra: true })], sources), /unsupported fields/i);
});

test('rejects excessive decoded mask work before decoding valid compressed images', async () => {
  const width = 6000, height = 4000, stride = width * 4 + 1;
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(stride * height, 255);
  for (let y = 0; y < height; y++) raw[y * stride] = 0;
  const image = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  const sourceMetadata = { ...source, width, height, sha256: digest(image) };
  const ids = Array.from({ length: 6 }, () => crypto.randomUUID());
  const largeProduct = { ...product, sourceAssets: [sourceMetadata], brandLock: { maskAssetId: ids[5] } };
  const largeMasks = ids.map((id, index) => ({ metadata: { maskId: id, productId, sourceAssetId: sourceId,
    sourceSha256: sourceMetadata.sha256, width, height, sha256: digest(image), version: index + 1 }, blob: new Blob([image], { type: 'image/png' }) }));
  const originalDecode = globalThis.createImageBitmap;
  let decodes = 0;
  globalThis.createImageBitmap = async (...args) => { decodes++; return originalDecode(...args); };
  try {
    await assert.rejects(validateBackupMasks(largeProduct, largeMasks, [{ metadata: sourceMetadata, blob: new Blob([image], { type: 'image/png' }), exifOrientation: 1 }]), /validation work limit/i);
    assert.equal(decodes, 0);
  } finally { globalThis.createImageBitmap = originalDecode; }
});

test('stops mask verification when cancellation occurs during decoded-pixel comparison', async () => {
  const controller = new AbortController(), originalDecode = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async (value) => {
    if (value.type === 'image/jpeg') setTimeout(() => controller.abort(), 0);
    return originalDecode(value);
  };
  try {
    await assert.rejects(validateBackupMasks(product, [mask()], sources, controller.signal), { name: 'AbortError' });
  } finally { globalThis.createImageBitmap = originalDecode; }
});

test('does not start mask validation with an already aborted signal', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(validateBackupMasks(product, [mask()], sources, controller.signal), { name: 'AbortError' });
});

test('includes originals in the work budget and accepts its exact boundary', () => {
  const originals = Array.from({ length: 16 }, () => ({ ...source, assetId: randomUUID(), width: 4096, height: 4096 }));
  const many = { ...product, sourceAssets: originals };
  assert.doesNotThrow(() => checkBackupPixelWork(many, []));
  assert.throws(() => checkBackupPixelWork(many, [originals[0].assetId]), /validation work limit/i);
});

test('rejects combined mask and composite work even when mask work alone is within budget', () => {
  const largeSource = { ...source, width: 6000, height: 4000 };
  const largeProduct = { ...product, sourceAssets: [largeSource] };
  const maskSources = Array(5).fill(sourceId);
  assert.doesNotThrow(() => checkBackupPixelWork(largeProduct, maskSources));
  assert.throws(() => checkBackupPixelWork(largeProduct, maskSources, [{ kind: 'strict-composite', sourceAssetId: sourceId }]), /validation work limit/i);
});

test('does not begin mask decoding after cancellation during source decoding', async () => {
  const controller = new AbortController(), originalDecode = globalThis.createImageBitmap;
  let maskDecodes = 0;
  globalThis.createImageBitmap = async (value) => {
    if (value.type === 'image/jpeg') controller.abort();
    else maskDecodes++;
    return originalDecode(value);
  };
  try {
    await assert.rejects(validateBackupMasks(product, [mask()], sources, controller.signal), { name: 'AbortError' });
    assert.equal(maskDecodes, 1);
  } finally { globalThis.createImageBitmap = originalDecode; }
});
