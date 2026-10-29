export type MaskPoint = { x: number; y: number };
export type MaskStroke = { tool: 'draw' | 'erase'; size: number; points: MaskPoint[] };

export function paintStroke(context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, stroke: MaskStroke, skipInitial = false) {
  context.save();
  context.globalCompositeOperation = stroke.tool === 'erase' ? 'destination-out' : 'source-over';
  context.fillStyle = '#ffffff';
  context.strokeStyle = '#ffffff';
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.lineWidth = stroke.size;
  const first = stroke.points[0];
  if (first) {
    if (!skipInitial) {
      context.beginPath();
      context.arc(first.x, first.y, stroke.size / 2, 0, Math.PI * 2);
      context.fill();
    }
    for (let i = 1; i < stroke.points.length; i++) {
      const previous = stroke.points[i - 1];
      const point = stroke.points[i];
      context.beginPath();
      context.arc(previous.x, previous.y, stroke.size / 2, 0, Math.PI * 2);
      context.fill();
      context.beginPath();
      context.moveTo(previous.x, previous.y);
      context.lineTo(point.x, point.y);
      context.stroke();
    }
  }
  context.restore();
}

export function renderPixels(context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, width: number, height: number, source: CanvasImageSource, base: CanvasImageSource | null, strokes: MaskStroke[]) {
  context.drawImage(source, 0, 0);
  const sourcePixels = context.getImageData(0, 0, width, height);
  context.clearRect(0, 0, width, height);
  if (base) context.drawImage(base, 0, 0);
  else {
    for (let i = 0; i < sourcePixels.data.length; i += 4) {
      sourcePixels.data[i] = 255; sourcePixels.data[i + 1] = 255; sourcePixels.data[i + 2] = 255;
    }
    context.putImageData(sourcePixels, 0, 0);
  }
  for (const stroke of strokes) paintStroke(context, stroke);
  const result = context.getImageData(0, 0, width, height);
  let selected = false;
  for (let i = 0; i < result.data.length; i += 4) {
    result.data[i] = 255; result.data[i + 1] = 255; result.data[i + 2] = 255;
    result.data[i + 3] = Math.min(result.data[i + 3], sourcePixels.data[i + 3]);
    if (result.data[i + 3]) selected = true;
  }
  if (!selected) throw new Error('The mask is empty. Draw a selection before saving.');
  context.putImageData(result, 0, 0);
}

export async function renderMaskOnMainThread(width: number, height: number, source: Blob, base: Blob | null, strokes: MaskStroke[]): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context || canvas.width !== width || canvas.height !== height) throw new Error('Full-resolution mask rendering is unavailable on this device.');
  const urls: string[] = [];
  async function decode(blob: Blob): Promise<HTMLImageElement> {
    const url = URL.createObjectURL(blob); urls.push(url);
    const image = new Image();
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('An image needed for the mask could not be decoded.')); image.src = url; });
    if (image.naturalWidth !== width || image.naturalHeight !== height) throw new Error('Image dimensions or orientation do not match the source.');
    return image;
  }
  try {
    const sourceImage = await decode(source);
    const baseImage = base ? await decode(base) : null;
    renderPixels(context, width, height, sourceImage, baseImage, strokes);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob || blob.type !== 'image/png' || !blob.size) throw new Error('The full-resolution mask could not be encoded as PNG.');
    return blob;
  } finally { for (const url of urls) URL.revokeObjectURL(url); canvas.width = 0; canvas.height = 0; }
}

export function renderMask(width: number, height: number, source: Blob, base: Blob | null, strokes: MaskStroke[], signal: AbortSignal): Promise<Blob> {
  if (signal.aborted) return Promise.reject(new Error('Mask rendering was cancelled.'));
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap !== 'function') {
    return renderMaskOnMainThread(width, height, source, base, strokes).then((blob) => {
      if (signal.aborted) throw new Error('Mask rendering was cancelled.');
      return blob;
    });
  }
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try { worker = new Worker(new URL('./maskWorker.ts', import.meta.url), { type: 'module' }); }
    catch { reject(new Error('The mask rendering worker could not be started. No mask was saved.')); return; }
    const cleanup = () => { signal.removeEventListener('abort', abort); worker.terminate(); };
    const abort = () => { cleanup(); reject(new Error('Mask rendering was cancelled.')); };
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = () => { cleanup(); reject(new Error('The mask rendering worker failed. No mask was saved.')); };
    worker.onmessage = (event: MessageEvent<{ blob?: Blob; error?: string }>) => {
      cleanup();
      if (event.data.blob instanceof Blob && event.data.blob.type === 'image/png' && event.data.blob.size) resolve(event.data.blob);
      else reject(new Error(event.data.error || 'The mask could not be rendered.'));
    };
    worker.postMessage({ width, height, source, base, strokes });
  });
}
