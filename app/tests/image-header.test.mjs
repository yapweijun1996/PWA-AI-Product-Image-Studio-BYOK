import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectImageHeader } from '../src/imageHeader.ts';

function pngChunk(type, data) {
  const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
  return Buffer.concat([size, Buffer.from(type), data, Buffer.alloc(4)]);
}
function png(width, height, animation = false) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), pngChunk('IHDR', header), ...(animation ? [pngChunk('acTL', Buffer.alloc(8))] : []), pngChunk('IEND', Buffer.alloc(0))]);
}
function jpeg(orientation) {
  const tiff = Buffer.alloc(26); tiff.write('II'); tiff.writeUInt16LE(42, 2); tiff.writeUInt32LE(8, 4); tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x0112, 10); tiff.writeUInt16LE(3, 12); tiff.writeUInt32LE(1, 14); tiff.writeUInt16LE(orientation, 18);
  const exif = Buffer.concat([Buffer.from('Exif\0\0'), tiff]);
  const length = Buffer.alloc(2); length.writeUInt16BE(exif.length + 2);
  return Buffer.concat([Buffer.from([0xff,0xd8,0xff,0xe1]), length, exif, Buffer.from([0xff,0xc0,0,11,8,0,40,0,80,1,1,0x11,0,0xff,0xda])]);
}
function webp(width, height) {
  const payload = Buffer.alloc(6); payload[0] = 0x2f; payload.writeUInt32LE((width - 1) | ((height - 1) << 14), 1);
  const chunk = Buffer.concat([Buffer.from('VP8L'), Buffer.from([5,0,0,0]), payload]);
  const length = Buffer.alloc(4); length.writeUInt32LE(4 + chunk.length);
  return Buffer.concat([Buffer.from('RIFF'), length, Buffer.from('WEBP'), chunk]);
}

test('reads PNG dimensions and rejects animation and truncation', () => {
  assert.deepEqual(inspectImageHeader(png(300, 200)), { mimeType: 'image/png', width: 300, height: 200, orientation: 1 });
  assert.throws(() => inspectImageHeader(png(300, 200, true)), /Animated/);
  assert.throws(() => inspectImageHeader(png(300, 200).subarray(0, 30)), /supported, valid/);
});

test('reads JPEG orientation and rejects invalid EXIF orientation', () => {
  assert.deepEqual(inspectImageHeader(jpeg(6)), { mimeType: 'image/jpeg', width: 80, height: 40, orientation: 6 });
  assert.throws(() => inspectImageHeader(jpeg(9)), /EXIF orientation/);
});

test('reads lossless WebP dimensions and rejects corrupt container lengths', () => {
  const image = webp(120, 60);
  assert.deepEqual(inspectImageHeader(image), { mimeType: 'image/webp', width: 120, height: 60, orientation: 1 });
  image.writeUInt32LE(image.length + 100, 4);
  assert.throws(() => inspectImageHeader(image), /supported, valid/);
});

test('rejects a fake PNG and unsupported content', () => {
  assert.throws(() => inspectImageHeader(Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), Buffer.alloc(60)])), /supported, valid/);
  assert.throws(() => inspectImageHeader(Buffer.from('<svg/>')), /supported, valid/);
});
