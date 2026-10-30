import { inspectImageHeader } from './imageHeader';

export type StrictCompositeMapping = { x: number; y: number; width: number; height: number; sourceWidth: number; sourceHeight: number };
type Inputs = { source: Blob; mask: Blob; scene: Blob; sourceWidth: number; sourceHeight: number; signal: AbortSignal };
type RenderInputs = Omit<Inputs, 'signal'>;
type Result = { blob: Blob; mapping: StrictCompositeMapping };
const EDGE = 1024;
const MAX_PIXELS = 24_000_000;
const MAX_DIMENSION = 20_000;
const MAX_BYTES = 64 * 1024 * 1024;
const cancelled = () => new Error('Strict composite rendering was cancelled.');

export function strictMapping(sourceWidth: number, sourceHeight: number): StrictCompositeMapping {
  const scale = Math.min(819.2 / sourceWidth, 819.2 / sourceHeight);
  const width = sourceWidth * scale, height = sourceHeight * scale;
  return { x: (EDGE - width) / 2, y: (EDGE - height) / 2, width, height, sourceWidth, sourceHeight };
}

// Mask alpha is already final coverage, not an opacity multiplier.
export function applyFinalCoverage(source: Uint8ClampedArray, mask: Uint8ClampedArray): void {
  if (source.length !== mask.length || source.length % 4 !== 0) throw new Error('Mask dimensions do not match the source.');
  let selected = false;
  for (let i = 3; i < source.length; i += 4) {
    if (mask[i] > source[i]) throw new Error('Mask coverage exceeds source alpha.');
    if (mask[i]) selected = true;
  }
  if (!selected) throw new Error('The mask is empty.');
  for (let i = 3; i < source.length; i += 4) source[i] = mask[i];
}

type Canvas = HTMLCanvasElement | OffscreenCanvas;
type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Decoded = { image: CanvasImageSource; width: number; height: number; release: () => void };
function makeCanvas(width: number, height: number): Canvas {
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(width, height);
  canvas.width = width; canvas.height = height;
  return canvas;
}
function context(canvas: Canvas): Context {
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as Context | null;
  if (!ctx) throw new Error('Canvas rendering is unavailable on this device.');
  return ctx;
}
async function decode(blob: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    try {
      const image = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      return { image, width: image.width, height: image.height, release: () => image.close() };
    } catch { /* Use the browser image decoder on the main thread. */ }
  }
  if (typeof Image === 'undefined') throw new Error('Image decoding is unavailable on this device.');
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('The image could not be decoded.'));
      image.src = url;
    });
    return { image, width: image.naturalWidth, height: image.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch (error) { URL.revokeObjectURL(url); throw error; }
}
async function header(blob: Blob) {
  if (!blob.size || blob.size > MAX_BYTES) throw new Error('Image size is outside the supported limit.');
  const info = inspectImageHeader(new Uint8Array(await blob.arrayBuffer()));
  if (!info.width || !info.height || info.width > MAX_DIMENSION || info.height > MAX_DIMENSION || info.width * info.height > MAX_PIXELS) throw new Error('Image dimensions exceed the supported limit.');
  if (blob.type && blob.type !== info.mimeType) throw new Error('Image type does not match its contents.');
  return info;
}
async function png(canvas: Canvas): Promise<Blob> {
  const blob = 'convertToBlob' in canvas
    ? await canvas.convertToBlob({ type: 'image/png' })
    : await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob || blob.type !== 'image/png') throw new Error('PNG encoding is unavailable on this device.');
  return blob;
}

// Shared by the worker and the main-thread fallback; allocations and decodes are sequential.
export async function renderStrictCompositePixels(inputs: RenderInputs, checkCancelled: () => void = () => {}): Promise<Result> {
  const { source, mask, scene, sourceWidth, sourceHeight } = inputs;
  if (!Number.isInteger(sourceWidth) || !Number.isInteger(sourceHeight) || sourceWidth < 1 || sourceHeight < 1 || sourceWidth > MAX_DIMENSION || sourceHeight > MAX_DIMENSION || sourceWidth * sourceHeight > MAX_PIXELS) throw new Error('Invalid source dimensions.');
  const sourceHeader = await header(source); checkCancelled();
  const maskHeader = await header(mask); checkCancelled();
  const sceneHeader = await header(scene); checkCancelled();
  const oriented = (info: typeof sourceHeader) => info.orientation >= 5 && info.orientation <= 8 ? [info.height, info.width] : [info.width, info.height];
  const [sw, sh] = oriented(sourceHeader);
  if (sw !== sourceWidth || sh !== sourceHeight) throw new Error('Source dimensions or orientation do not match.');
  if (maskHeader.mimeType !== 'image/png' || maskHeader.orientation !== 1 || maskHeader.width !== sw || maskHeader.height !== sh) throw new Error('Mask dimensions do not match the source.');
  const canvases: Canvas[] = [];
  let decoded: Decoded | undefined;
  try {
    const product = makeCanvas(sw, sh); canvases.push(product);
    const productContext = context(product);
    decoded = await decode(source); checkCancelled();
    if (decoded.width !== sw || decoded.height !== sh) throw new Error('This browser could not apply the source orientation safely.');
    productContext.drawImage(decoded.image, 0, 0); decoded.release(); decoded = undefined;
    const pixels = productContext.getImageData(0, 0, sw, sh);
    productContext.clearRect(0, 0, sw, sh);
    decoded = await decode(mask); checkCancelled();
    if (decoded.width !== sw || decoded.height !== sh) throw new Error('Mask dimensions do not match the source.');
    productContext.drawImage(decoded.image, 0, 0); decoded.release(); decoded = undefined;
    const coverage = productContext.getImageData(0, 0, sw, sh);
    applyFinalCoverage(pixels.data, coverage.data);
    productContext.putImageData(pixels, 0, 0); checkCancelled();
    const output = makeCanvas(EDGE, EDGE); canvases.push(output);
    const outputContext = context(output);
    decoded = await decode(scene); checkCancelled();
    const [sceneWidth, sceneHeight] = oriented(sceneHeader);
    if (decoded.width !== sceneWidth || decoded.height !== sceneHeight) throw new Error('This browser could not apply the scene orientation safely.');
    const scale = Math.max(EDGE / sceneWidth, EDGE / sceneHeight);
    outputContext.drawImage(decoded.image, (EDGE - sceneWidth * scale) / 2, (EDGE - sceneHeight * scale) / 2, sceneWidth * scale, sceneHeight * scale);
    decoded.release(); decoded = undefined;
    const mapping = strictMapping(sw, sh);
    outputContext.drawImage(product, mapping.x, mapping.y, mapping.width, mapping.height);
    checkCancelled();
    const blob = await png(output); checkCancelled();
    return { blob, mapping };
  } finally {
    decoded?.release();
    for (const canvas of canvases) { canvas.width = 0; canvas.height = 0; }
  }
}

export async function renderStrictComposite(inputs: Inputs): Promise<Result> {
  const { signal, ...data } = inputs;
  const check = () => { if (signal.aborted) throw cancelled(); };
  check();
  if (typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function') {
    let worker: Worker | undefined;
    try { worker = new Worker(new URL('./strictCompositeWorker.ts', import.meta.url), { type: 'module' }); } catch { /* Fall back when workers are blocked. */ }
    if (worker) {
      const active = worker;
      const result = await new Promise<Result | null>((resolve, reject) => {
        const cleanup = () => { signal.removeEventListener('abort', abort); active.terminate(); };
        const abort = () => { cleanup(); reject(cancelled()); };
        signal.addEventListener('abort', abort, { once: true });
        active.onmessage = (event: MessageEvent<{ result?: Result; error?: string; fallback?: boolean }>) => {
          cleanup();
          if (event.data.fallback) resolve(null);
          else if (event.data.error) reject(new Error(event.data.error));
          else if (event.data.result) resolve(event.data.result);
          else reject(new Error('Invalid worker response.'));
        };
        active.onerror = () => { cleanup(); resolve(null); };
        active.onmessageerror = () => { cleanup(); resolve(null); };
        try { active.postMessage(data); } catch { cleanup(); resolve(null); }
        if (signal.aborted) abort();
      });
      check();
      if (result) return result;
    }
  }
  return renderStrictCompositePixels(data, check);
}
