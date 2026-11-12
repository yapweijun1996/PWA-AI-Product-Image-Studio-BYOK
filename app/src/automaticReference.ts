import { inspectImageHeader } from './imageHeader.ts';
import { sha256 } from './prepareSource.ts';
import { AUTOMATIC_MAX_REFERENCES, AUTOMATIC_REFERENCE_MAX_EDGE, AUTOMATIC_REFERENCE_MAX_BYTES } from '../automatic-policy.mjs';
export type PreparedReference = { mimeType: 'image/png'; width: number; height: number; sha256: string; dataBase64: string };
const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});
function pngCrc(bytes: Uint8Array, start: number, end: number) {
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}
// Accept only the three essential PNG chunk types. No EXIF, text, filenames,
// timestamps or other source metadata crosses the image transmission boundary.
export function stripPngMetadata(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const chunks: Uint8Array[] = [bytes.slice(0, 8)];
  const header = inspectImageHeader(bytes);
  if (header.mimeType !== 'image/png') throw new Error('Reference must be PNG.');
  let offset = 8, ended = false, data = false, first = true, dataEnded = false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset), end = offset + 12 + length;
    if (end > bytes.length) throw new Error('Invalid reference PNG.');
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    if (pngCrc(bytes, offset + 4, end - 4) !== view.getUint32(end - 4)) throw new Error("Invalid reference PNG checksum.");
    if (!first && type === "IHDR") throw new Error("Invalid reference PNG order.");
    if (data && type !== "IDAT") dataEnded = true;
    if (dataEnded && type === "IDAT") throw new Error("Invalid reference PNG order.");
    if (first && (type !== 'IHDR' || length !== 13)) throw new Error('Invalid reference PNG.');
    first = false;
    if (['IHDR', 'IDAT', 'IEND'].includes(type)) chunks.push(bytes.slice(offset, end));
    else if (type[0] === type[0].toUpperCase()) throw new Error('Unsupported reference PNG.');
    if (type === 'IDAT') data = true;
    offset = end;
    if (type === 'IEND') { if (length !== 0) throw new Error('Invalid reference PNG.'); ended = true; break; }
  }
  if (!ended || !data || offset !== bytes.length) throw new Error('Invalid reference PNG.');
  const result = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0; for (const chunk of chunks) { result.set(chunk, at); at += chunk.length; }
  return new Uint8Array(result);
}
export async function prepareAutomaticReference(file: File, signal: AbortSignal): Promise<PreparedReference> {
  if (!file.size || file.size > 20 * 1024 * 1024) throw new Error('Choose reference images up to 20 MiB each.');
  const input = new Uint8Array(await file.arrayBuffer()), h = inspectImageHeader(input);
  if ((file.type && file.type !== h.mimeType) || h.width * h.height > 24_000_000 || Math.max(h.width, h.height) > 20000) throw new Error('Choose references up to 24 megapixels with a matching image type.');
  const image = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
    const scale = Math.min(1, AUTOMATIC_REFERENCE_MAX_EDGE / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'));
    if (!blob) throw new Error('Reference preparation unavailable.');
    const bytes = stripPngMetadata(new Uint8Array(await blob.arrayBuffer()));
    if (bytes.length > AUTOMATIC_REFERENCE_MAX_BYTES) throw new Error('Prepared reference exceeds the image limit.');
    let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
    return { mimeType: 'image/png', width: canvas.width, height: canvas.height, sha256: await sha256(bytes), dataBase64: btoa(binary) };
  } finally { image.close(); }
}
export async function validateAutomaticReferences(value: unknown): Promise<Uint8Array[]> {
  if (!Array.isArray(value) || value.length < 1 || value.length > AUTOMATIC_MAX_REFERENCES) throw new Error('Invalid references.');
  return Promise.all(value.map(async ref => {
    if (!ref || typeof ref !== 'object' || Object.keys(ref).sort().join(',') !== 'dataBase64,height,mimeType,sha256,width' || ref.mimeType !== 'image/png' || !Number.isInteger(ref.width) || !Number.isInteger(ref.height) || ref.width < 1 || ref.height < 1 || Math.max(ref.width, ref.height) > AUTOMATIC_REFERENCE_MAX_EDGE || typeof ref.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(ref.sha256) || typeof ref.dataBase64 !== 'string' || ref.dataBase64.length > Math.ceil(AUTOMATIC_REFERENCE_MAX_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(ref.dataBase64)) throw new Error('Invalid reference.');
    const raw = atob(ref.dataBase64), bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
    if (bytes.length > AUTOMATIC_REFERENCE_MAX_BYTES || btoa(raw) !== ref.dataBase64) throw new Error('Invalid reference.');
    const header = inspectImageHeader(bytes), stripped = stripPngMetadata(bytes);
    if (header.width !== ref.width || header.height !== ref.height || stripped.length !== bytes.length || await sha256(bytes) !== ref.sha256) throw new Error('Reference content changed.');
    return bytes;
  }));
}
