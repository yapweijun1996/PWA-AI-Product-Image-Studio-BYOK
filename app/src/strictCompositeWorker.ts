import { renderStrictCompositePixels } from './strictComposite';

self.onmessage = async (event: MessageEvent) => {
  try {
    const result = await renderStrictCompositePixels(event.data);
    self.postMessage({ result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Strict composite rendering failed.';
    self.postMessage({ error: message, fallback: message === 'Image decoding is unavailable on this device.' || message === 'Canvas rendering is unavailable on this device.' });
  }
};
