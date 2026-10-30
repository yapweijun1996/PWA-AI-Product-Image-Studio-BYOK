import assert from 'node:assert/strict';
import test from 'node:test';
import { regionFromDrag } from '../src/protectedRegion.ts';

test('drag regions expand to source-pixel edges in either direction and clamp to the image', () => {
  assert.deepEqual(regionFromDrag({ x: 10.2, y: 5.1 }, { x: 30.7, y: 20.2 }, 80, 50), { x: 10, y: 5, width: 21, height: 16 });
  assert.deepEqual(regionFromDrag({ x: 30.7, y: 20.2 }, { x: 10.2, y: 5.1 }, 80, 50), { x: 10, y: 5, width: 21, height: 16 });
  assert.deepEqual(regionFromDrag({ x: -10, y: 2 }, { x: 100, y: 80 }, 80, 50), { x: 0, y: 2, width: 80, height: 48 });
});

test('a tap, narrow drag, invalid dimensions or non-finite coordinates do not create a region', () => {
  assert.equal(regionFromDrag({ x: 3, y: 4 }, { x: 3, y: 4 }, 80, 50), null);
  assert.equal(regionFromDrag({ x: 3, y: 4 }, { x: 3.9, y: 6 }, 80, 50), null);
  assert.equal(regionFromDrag({ x: NaN, y: 4 }, { x: 5, y: 6 }, 80, 50), null);
  assert.equal(regionFromDrag({ x: 3, y: 4 }, { x: 5, y: 6 }, 0, 50), null);
});
