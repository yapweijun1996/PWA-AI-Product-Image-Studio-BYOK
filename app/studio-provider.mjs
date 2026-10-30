import { inflateSync } from 'node:zlib';
import { STUDIO_MODEL, STUDIO_QUALITY, STUDIO_SIZE, STUDIO_MAX_PNG_BYTES } from './studio-policy.mjs';

const ENDPOINT = 'https://api.openai.com/v1/images/generations';
const MAX_RESPONSE = 24 * 1024 * 1024;
const MAX_PNG = STUDIO_MAX_PNG_BYTES;

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function validatePng(base64) {
  if (typeof base64 !== 'string' || base64.length > Math.ceil(MAX_PNG / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new Error('Invalid image');
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length < 57 || bytes.length > MAX_PNG || bytes.toString('base64') !== base64 || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('Invalid image');
  let offset = 8, ihdr = false, end = false, sawData = false, dataEnded = false, bitDepth, colorType, interlace, palette = false;
  const compressed = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset), next = offset + 12 + length;
    if (next > bytes.length) throw new Error('Invalid image');
    const type = bytes.toString('ascii', offset + 4, offset + 8), payload = bytes.subarray(offset + 8, offset + 8 + length);
    if (crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== bytes.readUInt32BE(offset + 8 + length)) throw new Error('Invalid image');
    if (!ihdr) {
      if (type !== 'IHDR' || length !== 13 || payload.readUInt32BE(0) !== 1024 || payload.readUInt32BE(4) !== 1024 || payload[10] !== 0 || payload[11] !== 0 || payload[12] > 1) throw new Error('Invalid image');
      const allowed = { 0: [1,2,4,8,16], 2: [8,16], 3: [1,2,4,8], 4: [8,16], 6: [8,16] };
      if (!allowed[payload[9]]?.includes(payload[8])) throw new Error('Invalid image');
      bitDepth = payload[8]; colorType = payload[9]; interlace = payload[12]; ihdr = true;
    } else if (type === 'IHDR') throw new Error('Invalid image');
    else if (type === 'PLTE') { if (palette || sawData || length === 0 || length > 768 || length % 3 || colorType === 0 || colorType === 4) throw new Error('Invalid image'); palette = true; }
    else if (type === 'IDAT') { if (dataEnded || (colorType === 3 && !palette)) throw new Error('Invalid image'); sawData = true; compressed.push(payload); }
    else if (type === 'IEND') { if (length || !sawData || next !== bytes.length) throw new Error('Invalid image'); end = true; break; }
    else { if (!/^[A-Za-z]{4}$/.test(type) || type[0] === type[0].toUpperCase()) throw new Error('Invalid image'); if (sawData) dataEnded = true; }
    offset = next;
  }
  if (!end) throw new Error('Invalid image');
  const raw = inflateSync(Buffer.concat(compressed), { maxOutputLength: 9 * 1024 * 1024 });
  const bits = bitDepth * ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 })[colorType];
  const passes = interlace ? [[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]] : [[0,0,1,1]];
  let position = 0;
  for (const [x, y, dx, dy] of passes) {
    const width = Math.ceil((1024 - x) / dx), height = Math.ceil((1024 - y) / dy);
    const row = Math.ceil(width * bits / 8) + 1;
    for (let i = 0; i < height; i++) { if (position + row > raw.length || raw[position] > 4) throw new Error('Invalid image'); position += row; }
  }
  if (position !== raw.length) throw new Error('Invalid image');
  return base64;
}
async function limitedText(response) {
  if (!response.body || typeof response.body.getReader !== 'function') throw new Error('Invalid provider response');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > MAX_RESPONSE) throw new Error('Provider response too large');
      chunks.push(value);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } finally { reader.releaseLock(); }
}
function retryAfterSeconds(response) {
  const value = response.headers.get('retry-after');
  if (!value) return null;
  let seconds;
  if (/^\d{1,5}$/.test(value)) seconds = Number(value);
  else if (/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)) {
    const at = Date.parse(value);
    if (!Number.isFinite(at)) return null;
    seconds = Math.max(0, Math.ceil((at - Date.now()) / 1000));
  } else return null;
  return seconds <= 86400 ? seconds : null;
}
function parseUsage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const validToken = (n) => Number.isSafeInteger(n) && n >= 0;
  const { input_tokens, output_tokens, total_tokens } = value;
  if (![input_tokens, output_tokens, total_tokens].every(validToken) ||
      input_tokens > total_tokens || output_tokens !== total_tokens - input_tokens) return null;
  const usage = { input_tokens, output_tokens, total_tokens };
  for (const [key, limit] of [['input_tokens_details', input_tokens], ['output_tokens_details', output_tokens]]) {
    if (!(key in value)) continue;
    const source = value[key];
    if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
    const details = {};
    let remaining = limit;
    for (const field of ['image_tokens', 'text_tokens']) {
      if (!(field in source)) continue;
      if (!validToken(source[field]) || source[field] > remaining) return null;
      details[field] = source[field];
      remaining -= source[field];
    }
    if (Object.keys(details).length) usage[key] = details;
  }
  return usage;
}

export async function generateStudioScene({ apiKey, transport, timeoutMs, prompt }) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, timeoutMs); });
  try {
    const operation = (async () => {
      const response = await transport(ENDPOINT, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: STUDIO_MODEL, prompt, quality: STUDIO_QUALITY, size: STUDIO_SIZE, output_format: 'png', n: 1 })
      });
      if (response.status === 429) return { outcome: 'DEFINITIVE_FAILURE', errorCode: 'PROVIDER_LIMIT', retryAfterSeconds: retryAfterSeconds(response) };
      if (!response.ok) return { outcome: response.status >= 400 && response.status < 500 && response.status !== 408 ? 'DEFINITIVE_FAILURE' : 'UNKNOWN' };
      if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) throw new Error('Invalid provider response');
      const payload = JSON.parse(await limitedText(response));
      if (!payload || !Array.isArray(payload.data) || payload.data.length !== 1) throw new Error('Invalid provider response');
      return { outcome: 'DEFINITIVE_SUCCESS', image: validatePng(payload.data[0]?.b64_json), usage: parseUsage(payload.usage) };
    })();
    return await Promise.race([operation, timeout]);
  } catch { return { outcome: 'UNKNOWN' }; }
  finally { clearTimeout(timer); }
}
