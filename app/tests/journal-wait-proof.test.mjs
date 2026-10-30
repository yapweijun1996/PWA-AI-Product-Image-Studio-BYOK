import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
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


test('separate processes serialize proof publication and honor it after restart', async (t) => {
  const path = await directory(t);
  const original = await createAttemptJournal(path, { monotonicClock: () => 0 });
  await prepare(original);
  async function startWorker() {
    const child = fork(new URL('./fixtures/journal-wait-worker.mjs', import.meta.url), [path, principal, digest], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    t.after(() => child.kill());
    const [ready] = await once(child, 'message', { signal: AbortSignal.timeout(10000) });
    assert.deepEqual(ready, { ready: true });
    return child;
  }
  async function reserve(child, n, monotonic) {
    const request = `request-${n}`;
    child.send({ action: 'reserve', request, attempt: id(n), monotonic, wallTime: 999999999 });
    const [reply] = await once(child, 'message', { signal: AbortSignal.timeout(10000) });
    assert.equal(reply.request, request);
    assert.equal(reply.error, undefined);
    return reply.result;
  }
  const first = await startWorker(), second = await startWorker();
  assert.deepEqual(await Promise.all([reserve(first, 2, 59999), reserve(second, 3, 59999)]), ['rate', 'rate']);
  assert.deepEqual(await Promise.all([reserve(first, 2, 60000), reserve(second, 3, 60000)]), ['reserved', 'reserved']);
  assert.deepEqual(JSON.parse(await readFile(join(path, `${principal}-${id(1)}.waitproof`), 'utf8')), { retryAfterSeconds: 60 });
  first.kill(); second.kill();
  const restarted = await startWorker();
  assert.equal(await reserve(restarted, 4, 0), 'reserved');
});

test('a process terminated before publishing proof cannot shorten a restarted wait', async (t) => {
  const path = await directory(t);
  await prepare(await createAttemptJournal(path, { monotonicClock: () => 0 }));
  async function startWorker() {
    const child = fork(new URL('./fixtures/journal-wait-worker.mjs', import.meta.url), [path, principal, digest], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    t.after(() => child.kill());
    assert.deepEqual((await once(child, 'message', { signal: AbortSignal.timeout(10000) }))[0], { ready: true });
    return child;
  }
  async function reserve(child, monotonic) {
    child.send({ action: 'reserve', request: 'retry', attempt: id(2), monotonic, wallTime: 999999999 });
    const [reply] = await once(child, 'message', { signal: AbortSignal.timeout(10000) });
    assert.equal(reply.error, undefined);
    return reply.result;
  }
  const first = await startWorker();
  assert.equal(await reserve(first, 59999), 'rate');
  const exited = once(first, 'exit', { signal: AbortSignal.timeout(10000) }); first.kill('SIGKILL'); await exited;
  const restarted = await startWorker();
  assert.equal(await reserve(restarted, 59999), 'rate');
  assert.equal(await reserve(restarted, 60000), 'reserved');
});
