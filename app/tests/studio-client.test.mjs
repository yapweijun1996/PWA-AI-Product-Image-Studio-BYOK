import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, webcrypto } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { build } from 'vite';

const result = await build({ configFile: 'vite.config.ts', logLevel: 'silent', build: { write: false, minify: false, lib: { entry: 'src/StudioPanel.tsx', formats: ['es'], fileName: 'studio' } } });
const output = Array.isArray(result) ? result[0] : result;
const code = output.output.find((entry) => entry.type === 'chunk').code;
const { decodeScene } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
if (!globalThis.crypto) globalThis.crypto = webcrypto;
globalThis.createImageBitmap = async () => ({ width: 1024, height: 1024, close() {} });

function crc(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0); }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(name, data) {
  const type = Buffer.from(name), out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length); type.copy(out, 4); data.copy(out, 8); out.writeUInt32BE(crc(Buffer.concat([type, data])), data.length + 8);
  return out;
}
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1024); ihdr.writeUInt32BE(1024, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.alloc((1024 * 4 + 1) * 1024))), chunk('IEND', Buffer.alloc(0))]);
const id = '85e94161-691a-4d9e-9d6e-f5217a47bb21';
function response() { return { clientAttemptId: id, outcome: 'DEFINITIVE_SUCCESS', model: 'gpt-image-2.5-flare', image: { mimeType: 'image/png', dataBase64: png.toString('base64'), width: 1024, height: 1024 }, usage: null, observedUSD: null, providerRequestId: null }; }

test('accepts and hashes the synthetic scene without claiming an observed charge', async () => {
  const scene = await decodeScene(response(), id);
  assert.equal(scene.hash, createHash('sha256').update(png).digest('hex'));
  assert.equal(scene.observedUSD, null);
  assert.deepEqual(Buffer.from(await scene.blob.arrayBuffer()), png);
});

test('rejects mismatched identity, dimensions, malformed base64 and a corrupt image', async () => {
  const wrongId = response(); wrongId.clientAttemptId = 'other';
  const wrongSize = response(); wrongSize.image.width = 512;
  const invalid = response(); invalid.image.dataBase64 = 'not base64!';
  const wrongImage = response(); wrongImage.image.dataBase64 = Buffer.from('not an image').toString('base64');
  for (const value of [wrongId, wrongSize, invalid, wrongImage]) await assert.rejects(decodeScene(value, id));
});
