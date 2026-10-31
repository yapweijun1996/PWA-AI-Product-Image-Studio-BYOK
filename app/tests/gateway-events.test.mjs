import assert from 'node:assert/strict';
import test from 'node:test';
import { notifyGatewayChanged, onGatewayChanged } from '../src/gatewayEvents.ts';

test('gateway notifications only carry invalidation and unavailable channels are safe', () => {
  const original = globalThis.BroadcastChannel, instances = [];
  class FakeChannel {
    constructor(name) { this.name = name; this.closed = false; instances.push(this); }
    postMessage(message) { this.message = message; }
    close() { this.closed = true; }
  }
  try {
    globalThis.BroadcastChannel = FakeChannel;
    let invalidations = 0;
    const unsubscribe = onGatewayChanged(() => { invalidations++; });
    notifyGatewayChanged();
    assert.equal(instances[0].name, instances[1].name);
    assert.equal(instances[1].message, 'session-revoked');
    assert.equal(instances[1].closed, true);
    instances[0].onmessage({ data: 'session-active' });
    instances[0].onmessage({ data: { type: 'session-revoked' } });
    assert.equal(invalidations, 0, 'Unknown messages cannot change state.');
    instances[0].onmessage({ data: 'session-revoked' });
    assert.equal(invalidations, 1);
    unsubscribe();
    assert.equal(instances[0].closed, true);
    globalThis.BroadcastChannel = undefined;
    assert.doesNotThrow(() => { notifyGatewayChanged(); onGatewayChanged(() => {})(); });
    globalThis.BroadcastChannel = class { constructor() { throw new Error('unavailable'); } };
    assert.doesNotThrow(() => { notifyGatewayChanged(); onGatewayChanged(() => {})(); });
  } finally { globalThis.BroadcastChannel = original; }
});
