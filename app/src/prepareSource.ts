import { inspectImageHeader } from './imageHeader';
import type { Product } from './products';

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PIXELS = 24_000_000;
const MAX_DIMENSION = 20_000;
const PREVIEW_EDGE = 1600;

type SourceMetadata = Product['sourceAssets'][number];
export type PreparedSource = { file: File; metadata: SourceMetadata; exifOrientation: number; previewUrl: string };

export async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function loadImage(file: File): Promise<{ image: CanvasImageSource; width: number; height: number; release: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const image = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { image, width: image.width, height: image.height, release: () => image.close() };
    } catch {
      // Fall back to the browser's image decoder when ImageBitmap is unavailable.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('The image could not be decoded.'));
      image.src = url;
    });
    return { image, width: image.naturalWidth, height: image.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

export async function prepareSource(file: File): Promise<PreparedSource> {
  if (file.size < 1 || file.size > MAX_BYTES) throw new Error('Choose an image no larger than 20 MiB.');
  if (!file.name.trim() || [...file.name].length > 255) throw new Error('The image filename must contain 1–255 characters.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const header = inspectImageHeader(bytes);
  if (file.type && file.type !== header.mimeType) throw new Error('The file type does not match its image contents.');
  if (header.width > MAX_DIMENSION || header.height > MAX_DIMENSION || header.width * header.height > MAX_PIXELS) {
    throw new Error('The image exceeds the 24-megapixel or 20,000-pixel dimension limit.');
  }
  const hash = await sha256(bytes);
  const decoded = await loadImage(file);
  try {
    const rotated = header.orientation >= 5 && header.orientation <= 8;
    const width = rotated ? header.height : header.width;
    const height = rotated ? header.width : header.height;
    if (decoded.width !== width || decoded.height !== height) {
      throw new Error('This browser could not apply the image orientation safely.');
    }
    const scale = Math.min(1, PREVIEW_EDGE / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image preview is unavailable on this device.');
    context.drawImage(decoded.image, 0, 0, canvas.width, canvas.height);
    const preview = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!preview) throw new Error('The image preview could not be created.');
    return {
      exifOrientation: header.orientation,
      file,
      metadata: { assetId: crypto.randomUUID(), sha256: hash, mimeType: header.mimeType, width, height, cameraView: 'UNKNOWN', filename: file.name },
      previewUrl: URL.createObjectURL(preview),
    };
  } finally {
    decoded.release();
  }
}
