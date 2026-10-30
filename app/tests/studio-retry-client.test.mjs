import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'vite';
import { STUDIO_MODEL, STUDIO_QUALITY, STUDIO_SIZE, STUDIO_SCENE_PROMPT_VERSION, STUDIO_PRESET_VERSION } from '../studio-policy.mjs';

const result = await build({ configFile: 'vite.config.ts', logLevel: 'silent', build: { write: false, minify: false, lib: { entry: 'src/StudioPanel.tsx', formats: ['es'], fileName: 'studio' } } });
const output = Array.isArray(result) ? result[0] : result;
const code = output.output.find((entry) => entry.type === 'chunk').code;
const { retryableStudioAttempt, sanitizedStudioFailure } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

const base = { attemptId: 'a', jobId: 'job', styleId: 'studio', sceneContext: {}, selectedFactIds: [], productSnapshotFingerprint: 'hash', presetVersion: STUDIO_PRESET_VERSION, promptVersion: STUDIO_SCENE_PROMPT_VERSION, model: STUDIO_MODEL, quality: STUDIO_QUALITY, size: STUDIO_SIZE, status: 'DEFINITIVE_FAILURE' };

test('only the latest terminal or explicitly reviewed UNKNOWN attempt is retryable', () => {
  const second = { ...base, attemptId: 'b', retryOf: 'a', status: 'DEFINITIVE_SUCCESS' };
  assert.equal(retryableStudioAttempt(base, [base]), true);
  assert.equal(retryableStudioAttempt(base, [base, second]), false);
  assert.equal(retryableStudioAttempt(second, [base, second]), true);
  assert.equal(retryableStudioAttempt({ ...second, status: 'PREPARED' }, [base, second]), false);
  assert.equal(retryableStudioAttempt({ ...second, status: 'SUBMITTED' }, [base, second]), false);
  assert.equal(retryableStudioAttempt({ ...second, status: 'UNKNOWN' }, [base, second]), false);
  const reviewed = { ...second, status: 'UNKNOWN', acknowledgedAt: '2026-10-30T12:00:00.000Z', recordedOutcome: 'UNKNOWN' };
  assert.equal(retryableStudioAttempt(reviewed, [base, reviewed]), true);
  assert.equal(retryableStudioAttempt({ ...second, cleanupPending: true }, [base, second]), false);
  assert.equal(retryableStudioAttempt({ ...second, cleanupPending: true, acknowledgedAt: reviewed.acknowledgedAt, recordedOutcome: 'DEFINITIVE_SUCCESS' }, [base, second]), true);
  assert.equal(retryableStudioAttempt({ ...second, cleanupPending: true, acknowledgedAt: reviewed.acknowledgedAt, recordedOutcome: 'DEFINITIVE_FAILURE' }, [base, second]), false);
  assert.equal(retryableStudioAttempt({ ...base, styleId: undefined }, [base]), false);
  assert.equal(retryableStudioAttempt({ ...base, promptVersion: '1.0.0' }, [base]), false);
  assert.equal(retryableStudioAttempt(second, [base, second, { ...base, attemptId: 'c', retryOf: 'a' }]), false);
});

test('failure metadata is bounded and never stores gateway text', () => {
  assert.deepEqual(sanitizedStudioFailure(429, { outcome: 'DEFINITIVE_FAILURE', code: 'PROVIDER_LIMIT', retryAfterSeconds: 42, message: 'secret' }), { category: 'provider_limit', retryAfterSeconds: 42 });
  for (const seconds of [0, 86401, 1.5, '42']) assert.deepEqual(sanitizedStudioFailure(429, { outcome: 'DEFINITIVE_FAILURE', code: 'RATE_LIMITED', retryAfterSeconds: seconds, message: 'secret' }), { category: 'rate_limited' });
  assert.deepEqual(sanitizedStudioFailure(503, { outcome: 'DEFINITIVE_FAILURE', code: 'RECOVERY_REQUIRED', message: 'secret' }), { category: 'pre_send' });
  assert.deepEqual(sanitizedStudioFailure(500, { outcome: 'UNKNOWN', message: 'secret' }), { category: 'unknown' });
  assert.deepEqual(sanitizedStudioFailure(400, { outcome: 'DEFINITIVE_FAILURE', message: 'secret' }), { category: 'rejected' });
  assert.deepEqual(sanitizedStudioFailure(400, {}, true), { category: 'pre_send' });
});
