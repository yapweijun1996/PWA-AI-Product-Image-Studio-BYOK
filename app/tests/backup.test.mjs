import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'vite';
import { BlobWriter, TextReader, Uint8ArrayReader, ZipWriter, configure } from '@zip.js/zip.js/lib/zip-core-native.js';

// Bundle the actual browser module with the same generated schema validators as the app.
const result = await build({
  configFile: 'vite.config.ts',
  logLevel: 'silent',
  build: { write: false, minify: false, lib: { entry: 'src/backup.ts', formats: ['es'], fileName: 'backup' } },
});
const output = Array.isArray(result) ? result[0] : result;
const code = output.output.find((entry) => entry.type === 'chunk').code;
const { inspectBackup } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
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

