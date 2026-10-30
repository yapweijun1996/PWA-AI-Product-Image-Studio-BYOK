import assert from 'node:assert/strict';
import test from 'node:test';
import { generateStudioScene } from '../studio-provider.mjs';

async function simulate(retryAfter) {
  let calls = 0;
  const transport = async () => {
    calls++;
    return new Response('untrusted provider error', { status: 429, headers: retryAfter === null ? {} : { 'Retry-After': retryAfter } });
  };
  const result = await generateStudioScene({ apiKey: 'synthetic-only', transport, timeoutMs: 1000, prompt: 'validated scene prompt' });
  assert.equal(calls, 1);
  return result;
}

test('a provider 429 is definitive and its bounded delay is safe to display', async () => {
  assert.deepEqual(await simulate('37'), { outcome: 'DEFINITIVE_FAILURE', errorCode: 'PROVIDER_LIMIT', retryAfterSeconds: 37 });
  assert.deepEqual(await simulate('untrusted text'), { outcome: 'DEFINITIVE_FAILURE', errorCode: 'PROVIDER_LIMIT', retryAfterSeconds: null });
  assert.deepEqual(await simulate('86401'), { outcome: 'DEFINITIVE_FAILURE', errorCode: 'PROVIDER_LIMIT', retryAfterSeconds: null });
  assert.deepEqual(await simulate(null), { outcome: 'DEFINITIVE_FAILURE', errorCode: 'PROVIDER_LIMIT', retryAfterSeconds: null });
});

test('a provider HTTP-date retry delay is interpreted without automatic retry', async () => {
  const now = Date.now;
  Date.now = () => 1_700_000_000_000;
  try {
    const result = await simulate(new Date(Date.now() + 30000).toUTCString());
    assert.deepEqual(result, { outcome: 'DEFINITIVE_FAILURE', errorCode: 'PROVIDER_LIMIT', retryAfterSeconds: 30 });
  } finally { Date.now = now; }
});
