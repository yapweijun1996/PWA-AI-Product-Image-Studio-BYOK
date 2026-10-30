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
  assert.deepEqual(await simulate('untrusted text'), { outcome: 'DEFINITIVE_FAILURE', errorCode: 'PROVIDER_LIMIT', retryAfterSeconds: null, retryAfterRequiresReview: true });
  assert.deepEqual(await simulate('86401'), { outcome: 'DEFINITIVE_FAILURE', errorCode: 'PROVIDER_LIMIT', retryAfterSeconds: null, retryAfterRequiresReview: true });
  assert.deepEqual(await simulate('1000000000000000000000000'), { outcome: 'DEFINITIVE_FAILURE', errorCode: 'PROVIDER_LIMIT', retryAfterSeconds: null, retryAfterRequiresReview: true });
  assert.deepEqual(await simulate(''), { outcome: 'DEFINITIVE_FAILURE', errorCode: 'PROVIDER_LIMIT', retryAfterSeconds: null, retryAfterRequiresReview: true });
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

test('unused error response streams are cancelled without delaying or changing the outcome', async () => {
  for (const [status, outcome] of [[400, 'DEFINITIVE_FAILURE'], [408, 'UNKNOWN'], [429, 'DEFINITIVE_FAILURE'], [500, 'UNKNOWN']]) {
    let cancelled = false, calls = 0;
    const body = new ReadableStream({ cancel() { cancelled = true; return new Promise(() => {}); } });
    const result = await generateStudioScene({ apiKey: 'synthetic-only', prompt: 'synthetic', timeoutMs: 100,
      transport: async () => { calls++; return new Response(body, { status }); } });
    assert.equal(result.outcome, outcome);
    assert.equal(cancelled, true);
    assert.equal(calls, 1);
  }
});

test('invalid or oversized successful response bodies are cancelled and remain UNKNOWN', async () => {
  for (const oversized of [false, true]) {
    let cancelled = false, calls = 0;
    const body = new ReadableStream({ start(controller) { if (oversized) controller.enqueue(new Uint8Array(24 * 1024 * 1024 + 1)); }, cancel() { cancelled = true; } });
    const result = await generateStudioScene({ apiKey: 'synthetic-only', prompt: 'synthetic', timeoutMs: 1000,
      transport: async () => { calls++; return new Response(body, { status: 200, headers: { 'content-type': oversized ? 'application/json' : 'text/plain' } }); } });
    assert.equal(result.outcome, 'UNKNOWN');
    assert.equal(cancelled, true);
    assert.equal(calls, 1);
  }
});

test('timeout cancels a stalled provider response stream and remains UNKNOWN', async () => {
  let cancelled = false, calls = 0;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  const result = await generateStudioScene({ apiKey: 'synthetic-only', prompt: 'synthetic', timeoutMs: 20,
    transport: async () => { calls++; return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }); } });
  assert.equal(result.outcome, 'UNKNOWN');
  assert.equal(cancelled, true);
  assert.equal(calls, 1);
});
