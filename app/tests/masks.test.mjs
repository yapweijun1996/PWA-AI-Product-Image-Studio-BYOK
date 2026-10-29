import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateSync, inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { build } from 'vite';

const result = await build({
  configFile: 'vite.config.ts', logLevel: 'silent',
  build: { write: false, minify: false, lib: { entry: 'src/products.ts', formats: ['es'], fileName: 'products' } },
});
const output = Array.isArray(result) ? result[0] : result;
const code = output.output.find((entry) => entry.type === 'chunk').code;
const { validateBackupMasks } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

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
