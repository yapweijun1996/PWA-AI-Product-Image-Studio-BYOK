import { inspectImageHeader } from "./imageHeader";
import { sha256 } from "./prepareSource";
import type { StudioStyleId } from "../studio-policy.mjs";
export type AutoForeground = {
  blob: Blob;
  width: number;
  height: number;
  method: "source-alpha" | "u2netp-v1";
  sourceSha256: string;
};
const abort = (signal: AbortSignal) => {
  if (signal.aborted) throw new DOMException("Stopped", "AbortError");
};
function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}
async function png(c: HTMLCanvasElement) {
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
  if (!blob) throw new Error("Image encoding unavailable.");
  return blob;
}
export function matteBounds(
  alpha: ArrayLike<number>,
  width: number,
  height: number,
) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > 24_000_000 ||
    alpha.length !== width * height
  )
    throw new Error("Invalid automatic selection dimensions.");
  let left = width,
    top = height,
    right = -1,
    bottom = -1,
    count = 0;
  for (let i = 0; i < alpha.length; i++)
    if (!Number.isFinite(alpha[i]) || alpha[i] < 0 || alpha[i] > 1)
      throw new Error("Invalid automatic selection pixels.");
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (alpha[y * width + x] > 0.1) {
        count++;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
  if (
    count < Math.max(4, width * height * 0.002) ||
    right - left < 2 ||
    bottom - top < 2
  )
    throw new Error(
      "No clear product was found. No image generation was sent.",
    );
  return { left, top, right, bottom };
}
export async function prepareForeground(
  file: File,
  signal: AbortSignal,
  progress: (s: string) => void,
): Promise<AutoForeground> {
  if (!file.size || file.size > 20 * 1024 * 1024)
    throw new Error("Choose one image up to 20 MiB.");
  const bytes = new Uint8Array(await file.arrayBuffer()),
    header = inspectImageHeader(bytes);
  if (file.type && file.type !== header.mimeType)
    throw new Error("The file type does not match its contents.");
  if (
    header.width * header.height > 24_000_000 ||
    Math.max(header.width, header.height) > 20000
  )
    throw new Error("Choose an image up to 24 megapixels.");
  const image = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  if (signal.aborted) {
    image.close();
    abort(signal);
  }
  const c = canvas(image.width, image.height),
    ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0);
  image.close();
  const pixels = ctx.getImageData(0, 0, c.width, c.height);
  let transparent = 0;
  for (let i = 3; i < pixels.data.length; i += 4)
    if (pixels.data[i] < 250) transparent++;
  let method: AutoForeground["method"] = "source-alpha";
  const alpha = new Float32Array(c.width * c.height);
  if (transparent > alpha.length * 0.01) {
    for (let i = 0; i < alpha.length; i++)
      alpha[i] = pixels.data[i * 4 + 3] / 255;
  } else {
    method = "u2netp-v1";
    progress("Preparing your product…");
    const small = canvas(320, 320),
      sc = small.getContext("2d")!;
    sc.drawImage(c, 0, 0, 320, 320);
    const rgb = sc.getImageData(0, 0, 320, 320).data,
      input = new Float32Array(3 * 320 * 320),
      mean = [0.485, 0.456, 0.406],
      std = [0.229, 0.224, 0.225];
    let maxRGB = 1;
    for (let i = 0; i < rgb.length; i += 4)
      for (let k = 0; k < 3; k++) maxRGB = Math.max(maxRGB, rgb[i + k]);
    for (let i = 0; i < 320 * 320; i++)
      for (let channel = 0; channel < 3; channel++)
        input[channel * 320 * 320 + i] =
          (rgb[i * 4 + channel] / maxRGB - mean[channel]) / std[channel];
    const worker = new Worker(
      new URL("./autoMatteWorker.ts", import.meta.url),
      { type: "module" },
    );
    const mask = await new Promise<Float32Array>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          finish(
            new Error(
              "Automatic product selection timed out. No image generation was sent.",
            ),
          ),
        180_000,
      );
      const finish = (error?: Error, value?: Float32Array) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", cancel);
        worker.terminate();
        error ? reject(error) : resolve(value!);
      };
      const cancel = () => finish(new DOMException("Stopped", "AbortError"));
      signal.addEventListener("abort", cancel, { once: true });
      worker.onerror = () =>
        finish(
          new Error(
            "Automatic product selection is unavailable on this device.",
          ),
        );
      worker.onmessage = (e) => {
        if (e.data.progress) progress(e.data.progress);
        else if (e.data.error) finish(new Error(e.data.error));
        else if (e.data.alpha instanceof Float32Array)
          finish(undefined, e.data.alpha);
      };
      worker.postMessage({ pixels: input }, [input.buffer]);
      if (signal.aborted) cancel();
    });
    matteBounds(mask, 320, 320);
    if (mask.filter((n) => n > 0.1).length > mask.length * 0.98)
      throw new Error(
        "The product could not be separated from its background. No image generation was sent.",
      );
    const data = sc.createImageData(320, 320);
    for (let i = 0; i < mask.length; i++)
      data.data[i * 4 + 3] = Math.round(Math.min(1, mask[i] * 1.1) * 255);
    sc.putImageData(data, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(small, 0, 0, c.width, c.height);
    const scaled = ctx.getImageData(0, 0, c.width, c.height).data;
    for (let i = 0; i < alpha.length; i++) {
      alpha[i] = scaled[i * 4 + 3] / 255;
      pixels.data[i * 4 + 3] = Math.min(
        pixels.data[i * 4 + 3],
        scaled[i * 4 + 3],
      );
    }
    ctx.putImageData(pixels, 0, 0);
  }
  abort(signal);
  const bounds = matteBounds(alpha, c.width, c.height),
    pad = Math.max(2, Math.round(Math.max(c.width, c.height) * 0.015));
  const x = Math.max(0, bounds.left - pad),
    y = Math.max(0, bounds.top - pad),
    w = Math.min(c.width, bounds.right + pad + 1) - x,
    h = Math.min(c.height, bounds.bottom + pad + 1) - y;
  const crop = canvas(w, h);
  crop.getContext("2d")!.drawImage(c, x, y, w, h, 0, 0, w, h);
  const blob = await png(crop);
  c.width = c.height = 0;
  abort(signal);
  return {
    blob,
    width: w,
    height: h,
    method,
    sourceSha256: await sha256(bytes),
  };
}
export async function composeAutomatic(
  foreground: AutoForeground,
  scene: Blob,
  style: StudioStyleId,
  signal: AbortSignal,
): Promise<Blob> {
  abort(signal);
  const background = await createImageBitmap(scene),
    product = await createImageBitmap(foreground.blob);
  try {
    if (background.width !== 1024 || background.height !== 1024)
      throw new Error("The generated image has unexpected dimensions.");
    const c = canvas(1024, 1024),
      ctx = c.getContext("2d")!;
    ctx.drawImage(background, 0, 0, 1024, 1024);
    const layouts = {
      studio: [0.76, 0.5, 0.52],
      hero: [0.86, 0.5, 0.52],
      lifestyle: [0.62, 0.34, 0.58],
      flat_lay: [0.72, 0.5, 0.5],
      macro: [0.94, 0.5, 0.5],
      ugc: [0.62, 0.65, 0.55],
      billboard: [0.55, 0.5, 0.45],
    } as const;
    const [scale, cx, cy] = layouts[style],
      factor = Math.min(
        (1024 * scale) / product.width,
        (1024 * scale) / product.height,
      ),
      w = product.width * factor,
      h = product.height * factor;
    if (style === "billboard") {
      ctx.fillStyle = "#202927";
      ctx.fillRect(165, 95, 694, 730);
      ctx.fillStyle = "#fff";
      ctx.fillRect(181, 111, 662, 698);
      ctx.fillStyle = "#333";
      ctx.fillRect(490, 825, 44, 199);
    }
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,.24)";
    ctx.shadowBlur = 25;
    ctx.shadowOffsetY = 16;
    ctx.drawImage(product, cx * 1024 - w / 2, cy * 1024 - h / 2, w, h);
    ctx.restore();
    const blob = await png(c);
    abort(signal);
    return blob;
  } finally {
    background.close();
    product.close();
  }
}
