import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateSync } from 'node:zlib';
import { generateStudioScene } from '../studio-provider.mjs';

function crc(bytes) { let c = 0xffffffff; for (const b of bytes) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const name = Buffer.from(type), len = Buffer.alloc(4), sum = Buffer.alloc(4); len.writeUInt32BE(data.length); sum.writeUInt32BE(crc(Buffer.concat([name, data]))); return Buffer.concat([len, name, data, sum]); }
const header = Buffer.alloc(13); header.writeUInt32BE(1024, 0); header.writeUInt32BE(1024, 4); header[8] = 8; header[9] = 6;
const image = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.alloc(1024 * (1 + 1024 * 4)))), chunk('IEND', Buffer.alloc(0))]).toString('base64');

async function simulate(usage) {
  let calls = 0;
  const transport = async () => {
    calls++;
    return new Response(JSON.stringify({ data: [{ b64_json: image }], usage }), { headers: { 'content-type': 'application/json' } });
  };
  const result = await generateStudioScene({ apiKey: 'synthetic-only', transport, timeoutMs: 1000 });
  assert.equal(calls, 1);
  assert.equal(result.outcome, 'DEFINITIVE_SUCCESS');
  assert.equal(result.image, image);
  return result.usage;
}

test('usage retains only allowlisted token fields', async () => {
  const usage = { input_tokens: 12, output_tokens: 8, total_tokens: 20, input_tokens_details: { image_tokens: 7, text_tokens: 5, secret: 'private' }, output_tokens_details: { image_tokens: 8, text_tokens: 0, prompt: 'private' }, key: 'private' };
  assert.deepEqual(await simulate(usage), { input_tokens: 12, output_tokens: 8, total_tokens: 20, input_tokens_details: { image_tokens: 7, text_tokens: 5 }, output_tokens_details: { image_tokens: 8, text_tokens: 0 } });
  assert.deepEqual(await simulate({ input_tokens: 12, output_tokens: 8, total_tokens: 20 }), { input_tokens: 12, output_tokens: 8, total_tokens: 20 });
  assert.deepEqual(await simulate({ input_tokens: 12, output_tokens: 8, total_tokens: 20, input_tokens_details: { text_tokens: 5 } }), { input_tokens: 12, output_tokens: 8, total_tokens: 20, input_tokens_details: { text_tokens: 5 } });
});

test('missing or malformed usage never changes image success', async () => {
  for (const usage of [undefined, null, [], {}, { input_tokens: -1, output_tokens: 1, total_tokens: 0 }, { input_tokens: 1.5, output_tokens: 1, total_tokens: 2 }, { input_tokens: Number.MAX_SAFE_INTEGER + 1, output_tokens: 0, total_tokens: Number.MAX_SAFE_INTEGER + 1 }, { input_tokens: 1, output_tokens: 1, total_tokens: 3 }, { input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: null }, { input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: { image_tokens: 1, text_tokens: 1 } }, { input_tokens: 1, output_tokens: 1, total_tokens: 2, output_tokens_details: { image_tokens: 2 } }, { input_tokens: 1, output_tokens: 1, total_tokens: 2, output_tokens_details: { text_tokens: '1' } }]) {
    assert.equal(await simulate(usage), null);
  }
});
