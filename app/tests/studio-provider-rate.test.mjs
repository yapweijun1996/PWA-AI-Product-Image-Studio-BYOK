import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { STUDIO_MAX_RETRY_AFTER_SECONDS } from '../studio-policy.mjs';
import { generateStudioScene } from '../studio-provider.mjs';

async function simulate(retryAfter, date = null) {
  let calls = 0;
  const transport = async () => {
    calls++;
    return new Response('untrusted provider error', { status: 429, headers: { ...(retryAfter === null ? {} : { 'Retry-After': retryAfter }), ...(date === null ? {} : { Date: date }) } });
  };
  const result = await generateStudioScene({ apiKey: 'synthetic-only', transport, timeoutMs: 1000, prompt: 'validated scene prompt' });
  assert.equal(calls, 1);
  return result;
}

test('a provider 429 is definitive and its bounded delay is safe to display', async () => {
  assert.deepEqual(await simulate('37'), { outcome: 'DEFINITIVE_FAILURE', errorCode: 'PROVIDER_LIMIT', retryAfterSeconds: 37 });
  assert.deepEqual(await simulate('untrusted text'), { outcome: 'DEFINITIVE_FAILURE', errorCode: 'PROVIDER_LIMIT', retryAfterSeconds: null, retryAfterRequiresReview: true });
  assert.deepEqual(await simulate('86401'), { outcome: 'DEFINITIVE_FAILURE', errorCode: 'PROVIDER_LIMIT', retryAfterSeconds: 86401 });
  assert.deepEqual(await simulate('2147483647'), { outcome: 'DEFINITIVE_FAILURE', errorCode: 'PROVIDER_LIMIT', retryAfterSeconds: 2147483647 });
  assert.deepEqual(await simulate('000000000086401'), { outcome: 'DEFINITIVE_FAILURE', errorCode: 'PROVIDER_LIMIT', retryAfterSeconds: 86401 });
  assert.deepEqual(await simulate('2147483648'), { outcome: 'DEFINITIVE_FAILURE', errorCode: 'PROVIDER_LIMIT', retryAfterSeconds: null, retryAfterRequiresReview: true });
  assert.deepEqual(await simulate('1000000000000000000000000'), { outcome: 'DEFINITIVE_FAILURE', errorCode: 'PROVIDER_LIMIT', retryAfterSeconds: null, retryAfterRequiresReview: true });
  assert.deepEqual(await simulate(''), { outcome: 'DEFINITIVE_FAILURE', errorCode: 'PROVIDER_LIMIT', retryAfterSeconds: null, retryAfterRequiresReview: true });
  assert.deepEqual(await simulate(null), { outcome: 'DEFINITIVE_FAILURE', errorCode: 'PROVIDER_LIMIT', retryAfterSeconds: null });
});

test('a provider HTTP-date retry delay is interpreted without automatic retry', async () => {
  const now = Date.now;
  Date.now = () => 1_700_000_000_000;
  try {
    const result = await simulate(new Date(Date.now() + 30000).toUTCString(), new Date(Date.now()).toUTCString());
    assert.deepEqual(result, { outcome: 'DEFINITIVE_FAILURE', errorCode: 'PROVIDER_LIMIT', retryAfterSeconds: 30 });
    const longResult = await simulate(new Date(Date.now() + 86401000).toUTCString(), new Date(Date.now()).toUTCString());
    assert.equal(longResult.retryAfterSeconds, 86401);
  } finally { Date.now = now; }
});

test('HTTP-date retry does not shorten a provider interval when the local clock is fast', async () => {
  const now = Date.now; const providerNow = 1_700_000_000_000;
  Date.now = () => providerNow + 2 * 60 * 60 * 1000;
  let calls = 0;
  try {
    const result = await generateStudioScene({ apiKey: 'synthetic-only', prompt: 'synthetic', timeoutMs: 1000,
      transport: async () => { calls++; return new Response('synthetic', { status: 429, headers: {
        date: new Date(providerNow).toUTCString(), 'retry-after': new Date(providerNow + 3600 * 1000).toUTCString(),
      } }); } });
    assert.equal(result.retryAfterSeconds, 3600);
    assert.equal(calls, 1);
  } finally { Date.now = now; }
});

test('HTTP-date without a provider date requires manual review', async () => {
  const result = await simulate(new Date(Date.now() + 3600000).toUTCString());
  assert.deepEqual(result, { outcome: 'DEFINITIVE_FAILURE', errorCode: 'PROVIDER_LIMIT', retryAfterSeconds: null, retryAfterRequiresReview: true });
});

test('HTTP-date uses the longer local interval and rejects a malformed server date', async () => {
  const now = Date.now, providerNow = 1_700_000_000_000;
  Date.now = () => providerNow - 3600 * 1000;
  try {
    for (const [date, expected] of [[new Date(providerNow).toUTCString(), 7200], ['invalid date', null]]) {
      const result = await generateStudioScene({ apiKey: 'synthetic-only', prompt: 'synthetic', timeoutMs: 1000,
        transport: async () => new Response('synthetic', { status: 429, headers: {
          date, 'retry-after': new Date(providerNow + 3600 * 1000).toUTCString(),
        } }) });
      assert.equal(result.retryAfterSeconds, expected);
      assert.equal(result.retryAfterRequiresReview === true, expected === null);
    }
  } finally { Date.now = now; }
});

test('malformed HTTP-date guidance requires review instead of normalizing it', async () => {
  const now = Date.now; Date.now = () => Date.parse('Wed, 28 Feb 2024 00:00:00 GMT');
  try {
    for (const value of ['Thu, 31 Feb 2024 00:00:00 GMT', 'Mon, 01 Mar 2024 00:00:00 GMT']) {
      assert.deepEqual(await simulate(value), { outcome: 'DEFINITIVE_FAILURE', errorCode: 'PROVIDER_LIMIT', retryAfterSeconds: null, retryAfterRequiresReview: true });
    }
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


test('long retry schema matches policy and older schema rejects extended records', async () => {
  const schema = JSON.parse(await readFile(new URL('../../contracts/schemas/generation-job.schema.json', import.meta.url), 'utf8'));
  const sample = JSON.parse(await readFile(new URL('../../fixtures/sample-generation-job.json', import.meta.url), 'utf8'));
  const field = schema.properties.attempts.items.properties.retryAfterSeconds;
  assert.equal(field.maximum, STUDIO_MAX_RETRY_AFTER_SECONDS);
  sample.attempts[0].retryAfterSeconds = 86401;
  const ajv = new Ajv2020({ strict: true }); addFormats(ajv);
  assert.equal(ajv.compile(schema)(sample), true);
  const legacy = structuredClone(schema); legacy.$id += '/legacy';
  legacy.properties.attempts.items.properties.retryAfterSeconds.maximum = 86400;
  assert.equal(ajv.compile(legacy)(sample), false);
  sample.attempts[0].retryAfterSeconds = STUDIO_MAX_RETRY_AFTER_SECONDS + 1;
  assert.equal(ajv.getSchema(schema.$id)(sample), false);
});
