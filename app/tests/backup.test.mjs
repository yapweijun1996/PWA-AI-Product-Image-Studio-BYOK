import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { deflateRawSync, deflateSync } from 'node:zlib';
import 'fake-indexeddb/auto';
import { build } from 'vite';
import { BlobReader, BlobWriter, TextReader, Uint8ArrayReader, ZipReader, ZipWriter, configure } from '@zip.js/zip.js/lib/zip-core-native.js';

// Bundle the actual browser module with the same generated schema validators as the app.
const result = await build({
  configFile: 'vite.config.ts',
  logLevel: 'silent',
  build: { write: false, minify: false, lib: { entry: 'src/backup.ts', formats: ['es'], fileName: 'backup' } },
});
const output = Array.isArray(result) ? result[0] : result;
const code = output.output.find((entry) => entry.type === 'chunk').code;
const { createBackup, inspectBackup } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
configure({ useWebWorkers: false });

async function archive(entries) {
  const writer = new ZipWriter(new BlobWriter('application/zip'), { useWebWorkers: false });
  for (const [name, content, options] of entries) {
    await writer.add(name, typeof content === 'string' ? new TextReader(content) : new Uint8ArrayReader(content), options);
  }
  return new File([await writer.close()], 'fixture.zip', { type: 'application/zip' });
}

async function inspect(file) {
  return inspectBackup(file, new AbortController().signal, () => {});
}

const project = '{}';
const manifest = {
  schemaVersion: '1.0.0',
  exportId: '8a970e57-a1c4-4b97-bd01-bd7416e64de2',
  productId: 'db1ea59a-0748-47a9-b287-1ae08216c004',
  createdAt: '2026-01-01T00:00:00Z',
  approvedOnly: true,
  appVersion: 'test',
  files: [{ path: 'project.json', sha256: '0'.repeat(64), bytes: 2, mimeType: 'application/json', approved: false, role: 'project' }],
};

test('rejects traversal and paths outside the portable project', async () => {
  for (const name of ['../escape.txt', 'masks/unexpected.png']) {
    await assert.rejects(inspect(await archive([[name, 'synthetic']])), /unsafe|unsupported/i);
  }
});

test('rejects case-folded duplicate paths and symbolic links', async () => {
  await assert.rejects(inspect(await archive([['project.json', project], ['PROJECT.JSON', project]])), /duplicate/i);
  await assert.rejects(inspect(await archive([['project.json', 'target', { unixMode: 0o120777 }]])), /links/i);
});

test('rejects expansion bombs before reading their content', async () => {
  const repeated = new Uint8Array(2 * 1024 * 1024);
  await assert.rejects(inspect(await archive([['project.json', repeated]])), /safety limit/i);
});

test('rejects forged uncompressed sizes', async () => {
  const file = await archive([['project.json', project], ['export-manifest.json', new Uint8Array(2 * 1024 * 1024)]]);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer);
  let patched = 0;
  for (let offset = 0; offset + 46 < bytes.length; offset++) {
    const signature = view.getUint32(offset, true);
    const local = signature === 0x04034b50, central = signature === 0x02014b50;
    if (!local && !central) continue;
    const start = offset + (local ? 30 : 46);
    const length = view.getUint16(offset + (local ? 26 : 28), true);
    if (new TextDecoder().decode(bytes.subarray(start, start + length)) === 'export-manifest.json') {
      view.setUint32(offset + (local ? 22 : 24), 10, true);
      patched++;
    }
  }
  assert.equal(patched, 2);
  await assert.rejects(inspect(new File([bytes], 'forged.zip')), /size|declared|ambiguous/i);
});

test('rejects unsupported schema versions and modified project metadata', async () => {
  const future = { ...manifest, schemaVersion: '9.0.0' };
  await assert.rejects(inspect(await archive([['project.json', project], ['export-manifest.json', JSON.stringify(future)]])), /unsupported version/i);
  await assert.rejects(inspect(await archive([['project.json', project], ['export-manifest.json', JSON.stringify(manifest)]])), /metadata hash does not match/i);
});


const productsBuild = await build({
  configFile: 'vite.config.ts', logLevel: 'silent',
  build: { write: false, minify: false, lib: { entry: 'src/products.ts', formats: ['es'], fileName: 'products' } },
});
const productsOutput = Array.isArray(productsBuild) ? productsBuild[0] : productsBuild;
const productsCode = productsOutput.output.find((entry) => entry.type === 'chunk').code;
const { createProduct, saveSource } = await import(`data:text/javascript;base64,${Buffer.from(productsCode).toString('base64')}`);

async function emptyBackup() {
  const product = await createProduct({ sku: randomUUID(), name: 'Synthetic', category: 'Test', rightsAcknowledged: true });
  return new File([await createBackup(product.productId, new AbortController().signal, () => {})], 'backup.zip');
}
async function unpack(file) {
  const reader = new ZipReader(new BlobReader(file), { useWebWorkers: false });
  try {
    const result = new Map();
    for (const entry of await reader.getEntries()) result.set(entry.filename, new Uint8Array(await (await entry.getData(new BlobWriter())).arrayBuffer()));
    return result;
  } finally { await reader.close(); }
}
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const asEntries = (map) => [...map].map(([path, bytes]) => [path, bytes]);

test('exports versioned unapproved backups and previews empty history', async () => {
  const file = await emptyBackup();
  const entries = await unpack(file);
  const metadata = JSON.parse(new TextDecoder().decode(entries.get('export-manifest.json')));
  assert.equal(metadata.schemaVersion, '2.0.0');
  assert.equal(metadata.approvedOnly, false);
  assert.ok(metadata.files.every((item) => item.approved === false));
  const preview = await inspect(file);
  assert.deepEqual(preview.history, { jobs: [], attempts: [], assets: [], reviews: [], heads: [] });
  assert.equal(preview.conflict, true);
});

test('backup exports and previews a highly compressible original without triggering its import ratio limit', async () => {
  function chunk(name, data) {
    const type = Buffer.from(name), length = Buffer.alloc(4), checksum = Buffer.alloc(4);
    let crc = 0xffffffff;
    for (const byte of Buffer.concat([type, data])) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    length.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, type, data, checksum]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  const bytes = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('tEXt', Buffer.concat([Buffer.from('Comment\0'), Buffer.alloc(1024 * 1024, 65)])),
    chunk('IDAT', deflateSync(Buffer.from([0, 255, 255, 255, 255]))), chunk('IEND', Buffer.alloc(0)),
  ]);
  assert.ok(bytes.length / deflateRawSync(bytes).length > 200);
  const product = await createProduct({ sku: randomUUID(), name: 'Synthetic', category: 'Test', rightsAcknowledged: true });
  const source = { assetId: randomUUID(), sha256: hash(bytes), mimeType: 'image/png', width: 1, height: 1, cameraView: 'UNKNOWN', filename: 'metadata.png' };
  await saveSource(product.productId, { file: new File([bytes], source.filename, { type: source.mimeType }), metadata: source, exifOrientation: 1, previewUrl: '' }, 'UNKNOWN');
  const file = new File([await createBackup(product.productId, new AbortController().signal, () => {})], 'backup.zip');
  const reader = new ZipReader(new BlobReader(file), { useWebWorkers: false });
  const entries = await reader.getEntries();
  const original = entries.find((entry) => entry.filename.startsWith('originals/'));
  assert.equal(original.compressionMethod, 0);
  assert.equal(original.compressedSize, original.uncompressedSize);
  await reader.close();
  const bitmap = globalThis.createImageBitmap, document = globalThis.document;
  globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
  globalThis.document = { createElement: () => ({ getContext: () => ({ drawImage() {} }), toBlob: (done) => done(new Blob(['preview'], { type: 'image/png' })) }) };
  try {
    const preview = await inspect(file);
    assert.equal(preview.sources.length, 1);
    assert.equal(hash(Buffer.from(await preview.sources[0].blob.arrayBuffer())), hash(bytes));
  } finally { globalThis.createImageBitmap = bitmap; globalThis.document = document; }
});

test('continues to import version 1 with an empty history', async () => {
  const entries = await unpack(await emptyBackup());
  const metadata = JSON.parse(new TextDecoder().decode(entries.get('export-manifest.json')));
  metadata.schemaVersion = '1.0.0'; metadata.approvedOnly = true;
  entries.set('export-manifest.json', new TextEncoder().encode(JSON.stringify(metadata)));
  assert.deepEqual((await inspect(await archive(asEntries(entries)))).history, { jobs: [], attempts: [], assets: [], reviews: [], heads: [] });
});

test('rejects undeclared history, missing history, and wrong v2 approval flag', async () => {
  const entries = await unpack(await emptyBackup());
  const metadata = JSON.parse(new TextDecoder().decode(entries.get('export-manifest.json')));
  const path = `history/jobs/${randomUUID()}.json`;
  entries.set(path, new TextEncoder().encode('{}'));
  await assert.rejects(inspect(await archive(asEntries(entries))), /manifest and archive/i);
  entries.delete(path);
  metadata.files.push({ path, sha256: hash(Buffer.from('{}')), bytes: 2, mimeType: 'application/json', role: 'receipt', approved: false });
  entries.set('export-manifest.json', new TextEncoder().encode(JSON.stringify(metadata)));
  await assert.rejects(inspect(await archive(asEntries(entries))), /manifest and archive/i);
  metadata.files.pop(); metadata.approvedOnly = true;
  entries.set('export-manifest.json', new TextEncoder().encode(JSON.stringify(metadata)));
  await assert.rejects(inspect(await archive(asEntries(entries))), /safely restore|manifest/i);
});

test('rejects unsafe history names and executable entries', async () => {
  for (const path of ['history/jobs/../../project.json', `history/assets/${randomUUID()}.exe`, 'history/jobs/------------------------------------.json']) {
    await assert.rejects(inspect(await archive([[path, '{}']])), /unsafe|unsupported/i);
  }
  await assert.rejects(inspect(await archive([['project.json', '{}', { unixMode: 0o100755 }]])), /executable/i);
});

test('rejects altered history bytes and secrets even when the manifest is rehashed', async () => {
  const entries = await unpack(await emptyBackup());
  const metadata = JSON.parse(new TextDecoder().decode(entries.get('export-manifest.json')));
  const id = randomUUID(), path = `history/jobs/${id}.json`;
  let bytes = new TextEncoder().encode(JSON.stringify({ jobId: id, note: 'synthetic' }));
  const info = { path, sha256: hash(bytes), bytes: bytes.length, mimeType: 'application/json', role: 'receipt', approved: false };
  metadata.files.push(info);
  entries.set('export-manifest.json', new TextEncoder().encode(JSON.stringify(metadata)));
  entries.set(path, new TextEncoder().encode(JSON.stringify({ jobId: id, note: 'tampered!' })));
  await assert.rejects(inspect(await archive(asEntries(entries))), /hash|manifest/i);
  bytes = new TextEncoder().encode(JSON.stringify({ jobId: id, note: `sk-${'A'.repeat(40)}` }));
  info.sha256 = hash(bytes); info.bytes = bytes.length;
  entries.set(path, bytes);
  entries.set('export-manifest.json', new TextEncoder().encode(JSON.stringify(metadata)));
  await assert.rejects(inspect(await archive(asEntries(entries))), /credential/i);
});

test('rejects a manifest declaring more than 2000 files', async () => {
  const entries = await unpack(await emptyBackup());
  const metadata = JSON.parse(new TextDecoder().decode(entries.get('export-manifest.json')));
  for (let i = 0; i < 2000; i++) metadata.files.push({
    path: `history/jobs/${randomUUID()}.json`, sha256: '0'.repeat(64), bytes: 2,
    mimeType: 'application/json', role: 'receipt', approved: false,
  });
  entries.set('export-manifest.json', new TextEncoder().encode(JSON.stringify(metadata)));
  await assert.rejects(inspect(await archive(asEntries(entries))), /manifest/i);
});
