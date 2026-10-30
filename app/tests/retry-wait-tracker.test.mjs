import assert from 'node:assert/strict';
import test from 'node:test';
import { createRetryWaitTracker } from '../retry-wait-tracker.mjs';

test('a wait begins at first observation and repeated observations cannot shorten it', () => {
  let now = 100;
  const tracker = createRetryWaitTracker(() => now);
  tracker.observe('attempt', 86401);
  now += 86400999;
  tracker.observe('attempt', 86401);
  assert.equal(tracker.elapsed('attempt'), false);
  now++;
  assert.equal(tracker.elapsed('attempt'), true);
});

test('independent observers and a restarted process conservatively wait from their own observation', () => {
  let now = 0;
  const first = createRetryWaitTracker(() => now), second = createRetryWaitTracker(() => now);
  first.observe('attempt', 10);
  now = 9000; second.observe('attempt', 10);
  now = 10000;
  assert.equal(first.elapsed('attempt'), true);
  assert.equal(second.elapsed('attempt'), false);
  const restarted = createRetryWaitTracker(() => now);
  restarted.observe('attempt', 10);
  now = 19000;
  assert.equal(second.elapsed('attempt'), true);
  assert.equal(restarted.elapsed('attempt'), false);
  now = 20000;
  assert.equal(restarted.elapsed('attempt'), true);
});

test('invalid, conflicting, absent or backward clock inputs fail closed', () => {
  let now = 100;
  const tracker = createRetryWaitTracker(() => now);
  for (const seconds of [0, -1, 1.5, 2147483648]) assert.throws(() => tracker.observe('attempt', seconds));
  assert.throws(() => tracker.elapsed('missing'));
  tracker.observe('attempt', 60);
  assert.throws(() => tracker.observe('attempt', 61), /Conflicting/);
  now = 99;
  assert.throws(() => tracker.elapsed('attempt'), /clock/);
  now = 999999;
  assert.throws(() => tracker.elapsed('attempt'), /clock/);
});


test('a throwing or non-finite clock permanently fails the tracker', () => {
  for (const bad of [() => NaN, () => Infinity, () => { throw new Error('failure'); }]) {
    let clock = bad;
    const tracker = createRetryWaitTracker(() => clock());
    assert.throws(() => tracker.observe('attempt', 1), /clock/);
    clock = () => 1;
    assert.throws(() => tracker.observe('attempt', 1), /clock/);
  }
});
