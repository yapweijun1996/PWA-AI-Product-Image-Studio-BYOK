import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createAttemptJournal } from '../studio-journal.mjs';
const principal = 'a'.repeat(64), other = 'c'.repeat(64), digest = 'b'.repeat(64);
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function fixture(t) {
  const path = await mkdtemp(join(tmpdir(), 'studio-legacy-review-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  const journal = await createAttemptJournal(path);
  assert.equal(await journal.begin(principal, id(1)), 'begun');
  assert.equal(await journal.reserve(principal, id(1), digest, 1000, 10, 0), 'reserved');
  await journal.finish(principal, id(1), 'DEFINITIVE_FAILURE', 61000);
  await journal.end(principal, id(1));
  return { path, journal };
}

test('legacy wait review is separate from acknowledgement and invalidates stale consent', async (t) => {
  const { path, journal } = await fixture(t);
  await journal.acknowledge(principal, id(1), 2000, () => true);
  assert.equal(await journal.revision(), 1);
  assert.equal(await journal.reviewLegacyWait(principal, id(1), 0, 3000, () => true), 'stale');
  await assert.rejects(journal.reviewLegacyWait(principal, id(1), 1, 3000, () => false), /revoked/);
  assert.equal(await journal.reviewLegacyWait(other, id(1), 1, 3000, () => true), null);
  const receipt = await journal.reviewLegacyWait(principal, id(1), 1, 3000, () => true);
  assert.deepEqual(receipt, { retryNotBefore: 61000, reviewedAt: new Date(3000).toISOString() });
  assert.equal(await journal.revision(), 2);
  assert.equal(await journal.reserve(principal, id(2), digest, 100000, 10, 1), 'stale');
  assert.deepEqual(await journal.reviewLegacyWait(principal, id(1), 2, 4000, () => true), receipt);
  assert.equal(await journal.revision(), 2);
  const restarted = await createAttemptJournal(path);
  assert.equal(await restarted.revision(), 2);
  assert.deepEqual(JSON.parse(await readFile(join(path, `${principal}-${id(1)}.waitreview`), 'utf8')), receipt);
});

test('orphaned or conflicting review evidence fails closed', async (t) => {
  const { path, journal } = await fixture(t);
  await writeFile(join(path, `${principal}-${id(1)}.waitreview`), JSON.stringify({ retryNotBefore: 61001, reviewedAt: new Date(3000).toISOString() }), { mode: 0o600 });
  await assert.rejects(journal.revision(), /mismatched/);
});
