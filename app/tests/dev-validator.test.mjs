import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createServer } from 'vite';

test('Vite development validators accept valid fixtures and enforce Unicode length', async (t) => {
  const server = await createServer({ configFile: 'vite.config.ts', server: { middlewareMode: true }, logLevel: 'silent' });
  t.after(() => server.close());
  for (const name of ['product', 'generation-job', 'qa-report', 'export-manifest']) {
    const validator = (await server.ssrLoadModule(`virtual:${name}-validator`)).default;
    const fixture = JSON.parse(await readFile(new URL(`../../fixtures/sample-${name}.json`, import.meta.url), 'utf8'));
    assert.equal(validator(fixture), true, `${name} fixture should validate`);
    if (name === 'product') {
      fixture.name = '😀'.repeat(300);
      assert.equal(validator(fixture), true, 'Unicode length must count code points, not UTF-16 units');
      fixture.name = '😀'.repeat(301);
      assert.equal(validator(fixture), false, 'Unicode code point length must be enforced');
    }
  }
});
