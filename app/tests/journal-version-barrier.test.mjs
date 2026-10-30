import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createAttemptJournal } from '../studio-journal.mjs';

async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), 'studio-journal-upgrade-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

test('new and existing journals receive a durable version barrier', async (t) => {
  const path = await directory(t);
  await createAttemptJournal(path);
  assert.deepEqual(JSON.parse(await readFile(join(path, '.journal-protocol-v4'), 'utf8')), { format: 4 });
  await createAttemptJournal(path);
});

test('upgrade preserves and refuses unresolved pre-upgrade in-flight evidence', async (t) => {
  const path = await directory(t), marker = join(path, '.inflight');
  const content = JSON.stringify({ principal: 'a'.repeat(64), attempt: '00000000-0000-4000-8000-000000000000' });
  await writeFile(marker, content, { mode: 0o600 });
  await assert.rejects(createAttemptJournal(path), /in-flight/);
  assert.equal(await readFile(marker, 'utf8'), content);
  await assert.rejects(readFile(join(path, '.journal-protocol-v4')), { code: 'ENOENT' });
});

test('a corrupt protocol barrier fails closed', async (t) => {
  const path = await directory(t), marker = join(path, '.journal-protocol-v4');
  await writeFile(marker, '{"format":3}', { mode: 0o600 });
  await assert.rejects(createAttemptJournal(path), /protocol/);
});


test('removal of an active protocol barrier blocks further journal use', async (t) => {
  const path = await directory(t), journal = await createAttemptJournal(path);
  await unlink(join(path, '.journal-protocol-v4'));
  await assert.rejects(journal.revision(), /marker missing/);
});
