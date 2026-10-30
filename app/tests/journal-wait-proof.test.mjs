import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createAttemptJournal } from '../studio-journal.mjs';
const principal = 'a'.repeat(64), digest = 'b'.repeat(64);
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), 'studio-wait-proof-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}
async function prepare(journal) {
  assert.equal(await journal.begin(principal, id(1)), 'begun');
  assert.equal(await journal.reserve(principal, id(1), digest, 1000, 10, 0), 'reserved');
  await journal.finish(principal, id(1), 'DEFINITIVE_FAILURE', 61000, 60);
  await journal.end(principal, id(1));
}
test('wall-clock jumps do not release new waits; durable proof is shared across observers and restart', async (t) => {
  const path = await directory(t); let a = 0, b = 0;
  const first = await createAttemptJournal(path, { monotonicClock: () => a });
  await prepare(first);
  const other = await createAttemptJournal(path, { monotonicClock: () => b });
  assert.equal(await first.reserve(principal, id(2), digest, 999999999, 10, 0), 'rate');
  a = 59999;
  assert.equal(await first.reserve(principal, id(2), digest, 999999999, 10, 0), 'rate');
  a = 60000;
  assert.equal(await first.reserve(principal, id(2), digest, 999999999, 10, 0), 'reserved');
  assert.deepEqual(JSON.parse(await readFile(join(path, `${principal}-${id(1)}.waitproof`), 'utf8')), { retryAfterSeconds: 60 });
  assert.equal(await other.reserve(principal, id(3), digest, 999999999, 10, 0), 'reserved');
  const restarted = await createAttemptJournal(path, { monotonicClock: () => 0 });
  assert.equal(await restarted.reserve(principal, id(4), digest, 999999999, 10, 0), 'reserved');
});
test('restart without a proof restarts the full monotonic wait', async (t) => {
  const path = await directory(t); let now = 0;
  const first = await createAttemptJournal(path, { monotonicClock: () => now });
  await prepare(first); now = 59000;
  const restarted = await createAttemptJournal(path, { monotonicClock: () => now });
  now = 60000;
  assert.equal(await restarted.reserve(principal, id(2), digest, 999999999, 10, 0), 'rate');
  now = 119000;
  assert.equal(await restarted.reserve(principal, id(2), digest, 999999999, 10, 0), 'reserved');
});
test('mismatched proofs fail closed', async (t) => {
  const path = await directory(t), journal = await createAttemptJournal(path, { monotonicClock: () => 0 });
  await prepare(journal);
  await writeFile(join(path, `${principal}-${id(1)}.waitproof`), JSON.stringify({ retryAfterSeconds: 61 }), { mode: 0o600 });
  await assert.rejects(journal.revision(), /mismatched/);
});


test('the final locked dispatch cannot run before monotonic wait completion', async (t) => {
  const path = await directory(t); let now = 0, calls = 0, reserved = 0;
  const journal = await createAttemptJournal(path, { monotonicClock: () => now });
  await prepare(journal);
  assert.equal(await journal.begin(principal, id(2)), 'begun');
  const dispatch = () => { calls++; }, onReserved = () => { reserved++; };
  assert.equal(await journal.reserveAndDispatch(principal, id(2), digest, 999999999, 10, 0, () => true, dispatch, onReserved), 'rate');
  assert.equal(calls, 0); assert.equal(reserved, 0);
  now = 60000;
  assert.equal(await journal.reserveAndDispatch(principal, id(2), digest, 999999999, 10, 0, () => true, dispatch, onReserved), 'submitted');
  assert.equal(calls, 1); assert.equal(reserved, 1);
});
