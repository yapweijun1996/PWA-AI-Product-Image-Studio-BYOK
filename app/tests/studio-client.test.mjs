import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, webcrypto } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { build } from 'vite';

const result = await build({ configFile: 'vite.config.ts', logLevel: 'silent', build: { write: false, minify: false, lib: { entry: 'src/StudioPanel.tsx', formats: ['es'], fileName: 'studio' } } });
const output = Array.isArray(result) ? result[0] : result;
const code = output.output.find((entry) => entry.type === 'chunk').code;
const { decodeScene, decodeAcknowledgement, decodeReviewRevision, withStudioAttemptLock, withStudioReviewLock, sceneFailure, approvalFailure, cleanupPending } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
if (!globalThis.crypto) globalThis.crypto = webcrypto;
globalThis.createImageBitmap = async () => ({ width: 1024, height: 1024, close() {} });

function crc(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0); }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(name, data) {
  const type = Buffer.from(name), out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length); type.copy(out, 4); data.copy(out, 8); out.writeUInt32BE(crc(Buffer.concat([type, data])), data.length + 8);
  return out;
}
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1024); ihdr.writeUInt32BE(1024, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.alloc((1024 * 4 + 1) * 1024))), chunk('IEND', Buffer.alloc(0))]);
const id = '85e94161-691a-4d9e-9d6e-f5217a47bb21';
function response() { return { clientAttemptId: id, outcome: 'DEFINITIVE_SUCCESS', model: 'gpt-image-2.5-flare', image: { mimeType: 'image/png', dataBase64: png.toString('base64'), width: 1024, height: 1024 }, usage: null, observedUSD: null, providerRequestId: null }; }

test('accepts and hashes the synthetic scene without claiming an observed charge', async () => {
  const scene = await decodeScene(response(), id);
  assert.equal(scene.hash, createHash('sha256').update(png).digest('hex'));
  assert.equal(scene.observedUSD, null);
  assert.deepEqual(Buffer.from(await scene.blob.arrayBuffer()), png);
});
test('cleanup marker blocks on present and malformed values', () => {
  assert.equal(cleanupPending(new Headers()), false);
  assert.equal(cleanupPending(new Headers({ 'X-Studio-Cleanup-Pending': '1' })), true);
  assert.equal(cleanupPending(new Headers({ 'X-Studio-Cleanup-Pending': 'invalid' })), true);
});

test('pre-dispatch recovery failure gives a fixed owner-review warning', () => {
  const failure = sceneFailure(503, { code: 'RECOVERY_REQUIRED', outcome: 'DEFINITIVE_FAILURE', message: 'untrusted' });
  assert.equal(failure.definitive, true);
  assert.equal(failure.message, 'No image request was sent; journal evidence requires owner review. Preserve records and do not bypass the block.');
});


test('rejects mismatched identity, dimensions, malformed base64 and a corrupt image', async () => {
  const wrongId = response(); wrongId.clientAttemptId = 'other';
  const wrongSize = response(); wrongSize.image.width = 512;
  const invalid = response(); invalid.image.dataBase64 = 'not base64!';
  const wrongImage = response(); wrongImage.image.dataBase64 = Buffer.from('not an image').toString('base64');
  for (const value of [wrongId, wrongSize, invalid, wrongImage]) await assert.rejects(decodeScene(value, id));
});

test('acknowledgement receipt requires exact identity, outcome and valid ISO timestamp', () => {
  const receipt = { clientAttemptId: id, recordedOutcome: 'UNKNOWN', acknowledgedAt: '2026-10-30T12:00:00.000Z' };
  assert.deepEqual(decodeAcknowledgement(receipt, id), { recordedOutcome: 'UNKNOWN', acknowledgedAt: receipt.acknowledgedAt });
  for (const outcome of ['DEFINITIVE_SUCCESS', 'DEFINITIVE_FAILURE']) assert.equal(decodeAcknowledgement({ ...receipt, recordedOutcome: outcome }, id).recordedOutcome, outcome);
  for (const invalid of [
    { ...receipt, clientAttemptId: 'other' },
    { ...receipt, recordedOutcome: 'SUBMITTED' },
    { ...receipt, acknowledgedAt: '2026-02-30T12:00:00.000Z' },
    { ...receipt, acknowledgedAt: '2026-10-30' },
    { ...receipt, acknowledgedAt: null },
  ]) assert.throws(() => decodeAcknowledgement(invalid, id), /Invalid acknowledgement/);
});

test('only version 1 interrupted submissions can acquire a recovery lock', async () => {
  let calls = 0;
  const locks = { async request(name, options, callback) {
    assert.equal(name, `studio-attempt:${id}`);
    assert.deepEqual(options, { mode: 'exclusive', ifAvailable: true });
    calls++;
    return callback({});
  } };
  const action = async () => 'reviewed';
  for (const recoveryLockVersion of [undefined, null, '1', 0, 2]) {
    await assert.rejects(withStudioReviewLock({ attemptId: id, status: 'SUBMITTED', recoveryLockVersion }, locks, action), /invalid lock version|predates/);
  }
  await assert.rejects(withStudioReviewLock({ attemptId: id, status: 'SUBMITTED', recoveryLockVersion: 1 }, undefined, action), /does not support Web Locks/);
  assert.equal(calls, 0);
  assert.equal(await withStudioReviewLock({ attemptId: id, status: 'UNKNOWN' }, undefined, action), 'reviewed');
  assert.equal(await withStudioReviewLock({ attemptId: id, status: 'SUBMITTED', recoveryLockVersion: 1 }, locks, action), 'reviewed');
  assert.equal(calls, 1);
});

test('busy recovery lock never invokes review and stays held through outcome storage', async () => {
  let held = false, reviewed = false, stored = false;
  const locks = { async request(_name, _options, callback) {
    if (held) return callback(null);
    held = true;
    try { return await callback({}); } finally { held = false; }
  } };
  await withStudioAttemptLock(id, locks, async () => {
    await assert.rejects(withStudioReviewLock({ attemptId: id, status: 'SUBMITTED', recoveryLockVersion: 1 }, locks, async () => { reviewed = true; }), /still active/);
    assert.equal(held, true);
    stored = true;
  });
  assert.equal(stored, true);
  assert.equal(reviewed, false);
  assert.equal(held, false);
});

test('stale approval is a definitive pre-send failure requiring fresh authorization', () => {
  const result = sceneFailure(409, { code: 'APPROVAL_STALE', outcome: 'DEFINITIVE_FAILURE' });
  assert.equal(result.definitive, true);
  assert.match(result.message, /new consent.*new approval/);
  assert.equal(sceneFailure(409, { code: 'APPROVAL_STALE', outcome: 'UNKNOWN' }).definitive, false);
});

test('gateway review revision must be a nonnegative safe integer', () => {
  assert.equal(decodeReviewRevision({ reviewRevision: 0 }), 0);
  assert.equal(decodeReviewRevision({ reviewRevision: 23 }), 23);
  for (const value of [null, {}, { reviewRevision: null }, { reviewRevision: '1' },
    { reviewRevision: -1 }, { reviewRevision: 1.5 }, { reviewRevision: Number.MAX_SAFE_INTEGER + 1 }]) {
    assert.throws(() => decodeReviewRevision(value), /Invalid gateway/);
  }
});

test('stale approval requires a gateway recheck and separate new consent', () => {
  const stale = approvalFailure(409, { code: 'APPROVAL_STALE', outcome: 'DEFINITIVE_FAILURE' });
  assert.equal(stale.stale, true);
  assert.match(stale.message, /Check the gateway.*new consent/);
  assert.equal(approvalFailure(409, { code: 'APPROVAL_STALE', outcome: 'UNKNOWN' }).stale, false);
  assert.equal(approvalFailure(400, { code: 'APPROVAL_STALE', outcome: 'DEFINITIVE_FAILURE' }).stale, false);
});
