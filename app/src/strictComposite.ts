import { inspectImageHeader } from './imageHeader';
import { sha256 } from './prepareSource';

export type StrictCompositeMapping = { x: number; y: number; width: number; height: number; sourceWidth: number; sourceHeight: number };
export type StrictRect = { x: number; y: number; width: number; height: number };
export type StrictRecipe = {
  version: 1; styleId: 'studio' | 'hero' | 'lifestyle' | 'flat_lay' | 'macro' | 'ugc' | 'billboard';
  sourceView: 'TOP' | 'OTHER' | 'UNKNOWN'; topViewConfirmed?: true; crop?: StrictRect;
  display?: StrictRect; displayFrontFacing?: true; copy?: string; copyLayerSha256?: string;
};
export type ProtectedEvidence = { version: 1; sourceSha256: string; maskSha256: string; width: number; height: number; regions: StrictRect[] };
type Inputs = { source: Blob; mask: Blob; scene: Blob; sourceWidth: number; sourceHeight: number; signal: AbortSignal; recipe?: StrictRecipe; copyLayer?: Blob; protectedEvidence?: ProtectedEvidence };
type RenderInputs = Omit<Inputs, 'signal'>;
type Result = { blob: Blob; mapping: StrictCompositeMapping; ad?: Blob; copyLayer?: Blob };
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

export function recipeMapping(recipe: StrictRecipe, sw: number, sh: number): StrictCompositeMapping {
  if (!recipe || recipe.version !== 1 || !['studio', 'hero', 'lifestyle', 'flat_lay', 'macro', 'ugc', 'billboard'].includes(recipe.styleId) ||
      !['TOP', 'OTHER', 'UNKNOWN'].includes(recipe.sourceView) ||
      !Number.isSafeInteger(sw) || !Number.isSafeInteger(sh) || sw < 1 || sh < 1 ||
      Object.keys(recipe).some((key) => !['version', 'styleId', 'sourceView', 'topViewConfirmed', 'crop', 'display', 'displayFrontFacing', 'copy', 'copyLayerSha256'].includes(key))) throw new Error('Unsupported composition recipe.');
  const rect = (r: StrictRect | undefined, width: number, height: number) => !!r &&
    Object.keys(r).length === 4 && ['x', 'y', 'width', 'height'].every((key) => Object.hasOwn(r, key)) &&
    [r.x, r.y, r.width, r.height].every(Number.isSafeInteger) && r.x >= 0 && r.y >= 0 &&
    r.width > 0 && r.height > 0 && r.x + r.width <= width && r.y + r.height <= height;
  if (recipe.styleId !== 'macro' && recipe.crop !== undefined) throw new Error('A crop is only supported for macro.');
  if (recipe.styleId !== 'billboard' && (recipe.display !== undefined || recipe.displayFrontFacing !== undefined || recipe.copy !== undefined || recipe.copyLayerSha256 !== undefined)) throw new Error('Display options are only supported for billboard.');
  if (recipe.styleId === 'flat_lay' && recipe.sourceView === 'UNKNOWN') throw new Error('Confirm the source viewpoint before choosing flat-lay.');
  if ((recipe.topViewConfirmed !== undefined && recipe.topViewConfirmed !== true) ||
      (recipe.styleId === 'flat_lay' && recipe.sourceView === 'TOP') !== (recipe.topViewConfirmed === true)) throw new Error('A true overhead flat-lay requires explicit source-view confirmation.');
  if (recipe.styleId === 'macro' && !rect(recipe.crop, sw, sh)) throw new Error('Choose a valid oriented source-pixel macro crop.');
  if (recipe.styleId === 'billboard' && (!rect(recipe.display, EDGE, EDGE) || recipe.displayFrontFacing !== true ||
      typeof recipe.copy !== 'string' || recipe.copy.length > 100 || /[\r\n\t]/.test(recipe.copy))) throw new Error('Inspect and select a front-facing rectangular display and enter one line of exact copy or no copy.');
  if (recipe.copyLayerSha256 !== undefined && (recipe.styleId !== 'billboard' || !recipe.copy || !/^[a-f0-9]{64}$/.test(recipe.copyLayerSha256))) throw new Error('The copy layer identity is invalid.');
  if (recipe.styleId === 'studio') return strictMapping(sw, sh);
  if (recipe.styleId === 'billboard') {
    const d = recipe.display!;
    const scale = Math.min(d.width / 1024, d.height / 1024);
    return { x: d.x + (d.width - 1024 * scale) / 2, y: d.y + (d.height - 1024 * scale) / 2, width: 1024 * scale, height: 1024 * scale, sourceWidth: sw, sourceHeight: sh };
  }
  const crop = recipe.crop;
  const sourceW = crop?.width ?? sw, sourceH = crop?.height ?? sh;
  const layout = { hero: [0.86, 0.50, 0.48], lifestyle: [0.62, 0.30, 0.61],
    flat_lay: [0.72, 0.50, 0.50], macro: [0.94, 0.50, 0.50], ugc: [0.58, 0.67, 0.59] }[recipe.styleId]!;
  const scale = Math.min(EDGE * layout[0] / sourceW, EDGE * layout[0] / sourceH);
  const width = sourceW * scale, height = sourceH * scale;
  return { x: Math.max(0, Math.min(EDGE - width, EDGE * layout[1] - width / 2)),
    y: Math.max(0, Math.min(EDGE - height, EDGE * layout[2] - height / 2)), width, height, sourceWidth: sw, sourceHeight: sh };
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

// A protected rectangle must be opaque in both inputs: otherwise the scene can
// show through even when the mask preserves the source's original alpha.
// This source-space check alone does not verify selection completeness or output resampling.
export function assertProtectedCoverage(width: number, height: number, source: Uint8ClampedArray,
  mask: Uint8ClampedArray, regions: StrictRect[], crop?: StrictRect): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
      width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS ||
      !(source instanceof Uint8ClampedArray) || !(mask instanceof Uint8ClampedArray) ||
      source.length !== width * height * 4 || mask.length !== source.length ||
      !Array.isArray(regions) || regions.length < 1 || regions.length > 32) {
    throw new Error('Protected-region evidence is missing or invalid.');
  }
  const validRect = (value: StrictRect): boolean => !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === 4 && ['x', 'y', 'width', 'height'].every((key) => Object.hasOwn(value, key)) &&
    [value.x, value.y, value.width, value.height].every(Number.isSafeInteger) && value.x >= 0 && value.y >= 0 &&
    value.width > 0 && value.height > 0 && value.x + value.width <= width && value.y + value.height <= height;
  if (crop !== undefined && !validRect(crop)) throw new Error('The protected-region crop is invalid.');
  let work = 0;
  for (const region of regions) {
    if (!validRect(region) || (work += region.width * region.height) > width * height) throw new Error('Protected-region bounds or work limit are invalid.');
    if (crop && (region.x < crop.x || region.y < crop.y || region.x + region.width > crop.x + crop.width ||
        region.y + region.height > crop.y + crop.height)) throw new Error('The crop excludes protected source pixels.');
    for (let y = region.y; y < region.y + region.height; y++) {
      for (let x = region.x; x < region.x + region.width; x++) {
        const alpha = (y * width + x) * 4 + 3;
        if (source[alpha] !== 255 || mask[alpha] !== 255) throw new Error('A protected source pixel is not fully covered.');
      }
    }
  }
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
  const protectedEvidence = inputs.protectedEvidence === undefined ? undefined : structuredClone(inputs.protectedEvidence);
  const recipe = inputs.recipe === undefined ? undefined : structuredClone(inputs.recipe);
  if (!Number.isInteger(sourceWidth) || !Number.isInteger(sourceHeight) || sourceWidth < 1 || sourceHeight < 1 || sourceWidth > MAX_DIMENSION || sourceHeight > MAX_DIMENSION || sourceWidth * sourceHeight > MAX_PIXELS) throw new Error('Invalid source dimensions.');
  const sourceHeader = await header(source); checkCancelled();
  const maskHeader = await header(mask); checkCancelled();
  const sceneHeader = await header(scene); checkCancelled();
  const oriented = (info: typeof sourceHeader) => info.orientation >= 5 && info.orientation <= 8 ? [info.height, info.width] : [info.width, info.height];
  const [sw, sh] = oriented(sourceHeader);
  if (sw !== sourceWidth || sh !== sourceHeight) throw new Error('Source dimensions or orientation do not match.');
  if (maskHeader.mimeType !== 'image/png' || maskHeader.orientation !== 1 || maskHeader.width !== sw || maskHeader.height !== sh) throw new Error('Mask dimensions do not match the source.');
  if (protectedEvidence !== undefined) {
    const keys = ['version', 'sourceSha256', 'maskSha256', 'width', 'height', 'regions'];
    if (!protectedEvidence || typeof protectedEvidence !== 'object' || Array.isArray(protectedEvidence) ||
        Object.keys(protectedEvidence).length !== keys.length || keys.some((key) => !Object.hasOwn(protectedEvidence, key)) ||
        protectedEvidence.version !== 1 || protectedEvidence.width !== sw || protectedEvidence.height !== sh ||
        typeof protectedEvidence.sourceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(protectedEvidence.sourceSha256) ||
        typeof protectedEvidence.maskSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(protectedEvidence.maskSha256)) {
      throw new Error('Protected-region evidence is missing or invalid.');
    }
    const sourceHash = await sha256(new Uint8Array(await source.arrayBuffer())); checkCancelled();
    const maskHash = await sha256(new Uint8Array(await mask.arrayBuffer())); checkCancelled();
    if (sourceHash !== protectedEvidence.sourceSha256 || maskHash !== protectedEvidence.maskSha256) throw new Error('Protected-region evidence does not match the source and mask.');
  }
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
    if (protectedEvidence !== undefined) {
      assertProtectedCoverage(sw, sh, pixels.data, coverage.data, protectedEvidence.regions,
        recipe?.styleId === 'macro' ? recipe.crop : undefined);
    }
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
    const mapping = recipe ? recipeMapping(recipe, sw, sh) : strictMapping(sw, sh);
    let ad: Blob | undefined, copyLayer: Blob | undefined;
    if (recipe?.styleId === 'macro') {
      const crop = recipe.crop!;
      const selected = productContext.getImageData(crop.x, crop.y, crop.width, crop.height).data;
      if (!selected.some((value, index) => index % 4 === 3 && value !== 0)) throw new Error('The macro crop contains no visible product pixels.');
      outputContext.drawImage(product, crop.x, crop.y, crop.width, crop.height, mapping.x, mapping.y, mapping.width, mapping.height);
    } else if (recipe?.styleId === 'billboard') {
      const canvas = makeCanvas(EDGE, EDGE); canvases.push(canvas);
      const adContext = context(canvas);
      adContext.fillStyle = '#ffffff'; adContext.fillRect(0, 0, EDGE, EDGE);
      const copy = recipe.copy!;
      const scale = Math.min(720 / sw, (copy ? 650 : 820) / sh);
      const w = sw * scale, h = sh * scale;
      adContext.drawImage(product, (EDGE - w) / 2, (copy ? 720 : EDGE) / 2 - h / 2, w, h);
      if (copy) {
        if (inputs.copyLayer) {
          const layerHeader = await header(inputs.copyLayer);
          if (layerHeader.mimeType !== 'image/png' || layerHeader.width !== EDGE || layerHeader.height !== EDGE || layerHeader.orientation !== 1) throw new Error('The copy layer dimensions are invalid.');
          decoded = await decode(inputs.copyLayer); checkCancelled();
          if (decoded.width !== EDGE || decoded.height !== EDGE) throw new Error('The copy layer dimensions are invalid.');
          adContext.drawImage(decoded.image, 0, 0); decoded.release(); decoded = undefined;
          copyLayer = inputs.copyLayer;
        } else {
          const layer = makeCanvas(EDGE, EDGE); canvases.push(layer);
          const text = context(layer);
          text.fillStyle = '#111111'; text.font = '40px sans-serif'; text.textAlign = 'center'; text.textBaseline = 'middle';
          if (text.measureText(copy).width > 920) throw new Error('The exact copy does not fit on the ad.');
          text.fillText(copy, EDGE / 2, 875);
          copyLayer = await png(layer); checkCancelled();
          adContext.drawImage(layer, 0, 0);
        }
      } else if (inputs.copyLayer) throw new Error('An empty ad cannot have a copy layer.');
      ad = await png(canvas); checkCancelled();
      outputContext.drawImage(canvas, mapping.x, mapping.y, mapping.width, mapping.height);
    } else outputContext.drawImage(product, mapping.x, mapping.y, mapping.width, mapping.height);
    checkCancelled();
    const blob = await png(output); checkCancelled();
    return { blob, mapping, ...(ad ? { ad } : {}), ...(copyLayer ? { copyLayer } : {}) };
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
