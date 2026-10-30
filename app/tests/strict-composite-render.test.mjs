import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'vite';

const result = await build({
  configFile: 'vite.config.ts', logLevel: 'silent',
  build: { write: false, minify: false, lib: { entry: 'src/strictComposite.ts', formats: ['es'], fileName: 'strict-composite' } },
});
const output = Array.isArray(result) ? result[0] : result;
const code = output.output.find((entry) => entry.type === 'chunk' && entry.isEntry).code;
const { applyFinalCoverage, assertProtectedCoverage, strictMapping, recipeMapping } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

const rgba = (...values) => new Uint8ClampedArray(values);

test('protected source rectangles require opaque source and mask coverage', () => {
  const source = rgba(1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 0, 10, 11, 12, 128);
  const mask = rgba(255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0, 255, 255, 255, 128);
  const region = { x: 0, y: 0, width: 2, height: 1 };
  assert.doesNotThrow(() => assertProtectedCoverage(2, 2, source, mask, [region]));
  const lost = mask.slice(); lost[7] = 254;
  assert.throws(() => assertProtectedCoverage(2, 2, source, lost, [region]), /not fully covered/);
  assert.throws(() => assertProtectedCoverage(2, 2, source, mask, [{ x: 0, y: 1, width: 1, height: 1 }]), /not fully covered/);
  assert.throws(() => assertProtectedCoverage(2, 2, source, mask, [{ x: 1, y: 1, width: 1, height: 1 }]), /not fully covered/);
  assert.deepEqual([...source], [1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 0, 10, 11, 12, 128]);
});

test('protected evidence and crop bounds fail closed with bounded work', () => {
  const pixels = new Uint8ClampedArray(4 * 4 * 4).fill(255);
  const region = { x: 1, y: 1, width: 2, height: 2 };
  assert.doesNotThrow(() => assertProtectedCoverage(4, 4, pixels, pixels, [region], region));
  for (const invalid of [[], [{ ...region, x: -1 }], [{ ...region, width: 0 }], [{ ...region, x: 1.5 }], [{ ...region, width: 4 }], [{ ...region, extra: true }], Array(33).fill(region), Array(5).fill(region)]) {
    assert.throws(() => assertProtectedCoverage(4, 4, pixels, pixels, invalid));
  }
  assert.throws(() => assertProtectedCoverage(4, 4, pixels, pixels.slice(1), [region]), /invalid/);
  assert.throws(() => assertProtectedCoverage(4, 4, pixels, pixels, [region], { x: 1, y: 1, width: 1, height: 2 }), /crop excludes/);
  assert.throws(() => assertProtectedCoverage(4, 4, pixels, pixels, [region], { x: 0, y: 0, width: 5, height: 4 }), /crop is invalid/);
});

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

test('seven styles have distinct bounded, uniformly scaled layouts', () => {
  const rect = { x: 100, y: 100, width: 300, height: 200 };
  const recipes = ['studio', 'hero', 'lifestyle', 'flat_lay', 'macro', 'ugc', 'billboard'].map((styleId) => ({
    version: 1, styleId, sourceView: 'TOP',
    ...(styleId === 'flat_lay' ? { topViewConfirmed: true } : {}),
    ...(styleId === 'macro' ? { crop: rect } : {}),
    ...(styleId === 'billboard' ? { display: rect, displayFrontFacing: true, copy: '' } : {}),
  }));
  const mappings = recipes.map((recipe) => recipeMapping(recipe, 1000, 800));
  assert.equal(new Set(mappings.map((mapping) => JSON.stringify(mapping))).size, 7);
  for (const mapping of mappings) {
    assert.ok(mapping.x >= 0 && mapping.y >= 0 && mapping.x + mapping.width <= 1024 && mapping.y + mapping.height <= 1024);
  }
  assert.equal(mappings[6].width, mappings[6].height);
  assert.equal(mappings[4].width / mappings[4].height, rect.width / rect.height);
});

test('macro and billboard reject ambiguous or clipped selections', () => {
  assert.throws(() => recipeMapping({ version: 1, styleId: 'flat_lay', sourceView: 'TOP' }, 500, 500));
  assert.throws(() => recipeMapping({ version: 1, styleId: 'flat_lay', sourceView: 'OTHER', topViewConfirmed: true }, 500, 500));
  assert.throws(() => recipeMapping({ version: 1, styleId: 'flat_lay', sourceView: 'UNKNOWN' }, 500, 500));
  assert.throws(() => recipeMapping({ version: 1, styleId: 'macro', sourceView: 'OTHER', crop: { x: 450, y: 0, width: 100, height: 100 } }, 500, 500));
  assert.throws(() => recipeMapping({ version: 1, styleId: 'billboard', sourceView: 'OTHER', display: { x: 0, y: 0, width: 300, height: 200 }, copy: '' }, 500, 500));
  assert.throws(() => recipeMapping({ version: 1, styleId: 'billboard', sourceView: 'OTHER', display: { x: 900, y: 0, width: 200, height: 200 }, displayFrontFacing: true, copy: '' }, 500, 500));
  assert.throws(() => recipeMapping({ version: 1, styleId: 'billboard', sourceView: 'OTHER', display: { x: 0, y: 0, width: 300, height: 200 }, displayFrontFacing: true, copy: 'one\ntwo' }, 500, 500));
});
