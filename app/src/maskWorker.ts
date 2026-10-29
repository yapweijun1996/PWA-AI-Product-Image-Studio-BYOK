import { renderPixels, type MaskStroke } from './maskRendering';

// This module runs in a dedicated worker, although the app's TypeScript libraries describe Window.
const workerScope = self as unknown as { postMessage: (message: unknown) => void };
self.onmessage = async (event: MessageEvent<{ width: number; height: number; source: Blob; base: Blob | null; strokes: MaskStroke[] }>) => {
  const { width, height, source, base, strokes } = event.data;
  let sourceImage: ImageBitmap | null = null;
  let baseImage: ImageBitmap | null = null;
  try {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context || canvas.width !== width || canvas.height !== height) throw new Error('Full-resolution mask rendering is unavailable.');
    sourceImage = await createImageBitmap(source, { imageOrientation: 'from-image' });
    if (sourceImage.width !== width || sourceImage.height !== height) throw new Error('The source orientation could not be applied safely.');
    if (base) {
      baseImage = await createImageBitmap(base);
      if (baseImage.width !== width || baseImage.height !== height) throw new Error('The saved mask dimensions do not match the source.');
    }
    renderPixels(context, width, height, sourceImage, baseImage, strokes);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    if (blob.type !== 'image/png' || !blob.size) throw new Error('The full-resolution mask could not be encoded as PNG.');
    workerScope.postMessage({ blob });
  } catch (error) {
    workerScope.postMessage({ error: error instanceof Error ? error.message : 'The mask could not be rendered.' });
  } finally { sourceImage?.close(); baseImage?.close(); }
};
