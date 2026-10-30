import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'vite';

const result = await build({
  configFile: 'vite.config.ts', logLevel: 'silent',
  build: { write: false, minify: false, lib: { entry: 'src/strictComposite.ts', formats: ['es'], fileName: 'strict-composite' } },
});
const output = Array.isArray(result) ? result[0] : result;
const code = output.output.find((entry) => entry.type === 'chunk' && entry.isEntry).code;
const { applyFinalCoverage, strictMapping } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

const rgba = (...values) => new Uint8ClampedArray(values);

test('coverage is final alpha, not multiplied by source alpha', () => {
  const source = rgba(200, 100, 50, 128);
  applyFinalCoverage(source, rgba(255, 255, 255, 128));
  assert.deepEqual([...source], [200, 100, 50, 128]);
  // Source-over an opaque black background: 50%, not 25%, of each source channel.
  assert.deepEqual([...source.slice(0, 3)].map((channel) => Math.round(channel * source[3] / 255)), [100, 50, 25]);
});

test('source-space opaque core keeps all color and coverage', () => {
  const source = rgba(11, 52, 239, 255, 20, 40, 60, 128, 1, 2, 3, 0);
  applyFinalCoverage(source, rgba(0, 0, 0, 255, 0, 0, 0, 64, 0, 0, 0, 0));
  assert.deepEqual([...source], [11, 52, 239, 255, 20, 40, 60, 64, 1, 2, 3, 0]);
});

test('rejects empty, mismatched, and coverage exceeding source alpha without modifying pixels', () => {
  for (const mask of [rgba(0, 0, 0, 0), rgba(0, 0, 0, 101), rgba(0, 0, 0, 100, 0, 0, 0, 0)]) {
    const source = rgba(7, 8, 9, 100);
    assert.throws(() => applyFinalCoverage(source, mask));
    assert.deepEqual([...source], [7, 8, 9, 100]);
  }
});

test('mapping preserves aspect ratio and fills the centered 80 percent fit', () => {
  const wide = strictMapping(2000, 1000);
  assert.deepEqual(wide, { x: (1024 - 819.2) / 2, y: (1024 - 409.6) / 2, width: 819.2, height: 409.6, sourceWidth: 2000, sourceHeight: 1000 });
  const tall = strictMapping(500, 1000);
  assert.equal(tall.width, 409.6);
  assert.equal(tall.height, 819.2);
  assert.equal(tall.x, (1024 - 409.6) / 2);
  assert.equal(tall.y, (1024 - 819.2) / 2);
  const identity = strictMapping(1024, 1280);
  assert.equal(identity.width / identity.sourceWidth, identity.height / identity.sourceHeight);
});
