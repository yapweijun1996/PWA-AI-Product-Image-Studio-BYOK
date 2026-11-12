import { inspectImageHeader } from "./imageHeader";
import { sha256 } from "./prepareSource";
import type { StudioStyleId } from "../studio-policy.mjs";
import { AUTOMATIC_LAYOUTS } from "../automatic-policy.mjs";
export type AutoForeground = {
  blob: Blob;
  width: number;
  height: number;
  method: "source-alpha" | "u2netp-v1";
  sourceSha256: string;
  contentBounds?: { x: number; y: number; width: number; height: number };
  sourceDimensions?: { width: number; height: number };
  sourceBounds?: { x: number; y: number; width: number; height: number };
  detailRegion?: { x: number; y: number; width: number; height: number };
  capabilities?: {
    width: number;
    height: number;
    alphaFraction: number;
    category: "UNKNOWN";
    view: "UNKNOWN";
    lighting: "UNKNOWN";
  };
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
    contentBounds: {
      x: bounds.left - x,
      y: bounds.top - y,
      width: bounds.right - bounds.left + 1,
      height: bounds.bottom - bounds.top + 1,
    },
    sourceDimensions: { width: pixels.width, height: pixels.height },
    sourceBounds: { x, y, width: w, height: h },
    detailRegion: chooseDetailRegion(alpha, pixels.width, pixels.height, {
      x,
      y,
      width: w,
      height: h,
    }),
    capabilities: {
      width: pixels.width,
      height: pixels.height,
      alphaFraction: transparent / alpha.length,
      category: "UNKNOWN",
      view: "UNKNOWN",
      lighting: "UNKNOWN",
    },
  };
}
export function chooseDetailRegion(
  alpha: ArrayLike<number>,
  width: number,
  height: number,
  crop: { x: number; y: number; width: number; height: number },
) {
  // Choose a measured opaque source pixel nearest the crop center, never invent
  // a semantic feature (logo, material, category). Crop less than the whole asset.
  const bounds = matteBounds(alpha, width, height);
  let side = Math.max(1, Math.floor(Math.min(crop.width, crop.height) * 0.7));
  if (side % 2 === 0) side--;
  const rw = side,
    rh = side;
  let focusX = bounds.left,
    focusY = bounds.top,
    distance = Infinity;
  for (let y = bounds.top; y <= bounds.bottom; y++)
    for (let x = bounds.left; x <= bounds.right; x++) {
      if (alpha[y * width + x] <= 0.5) continue;
      const d =
        (x - crop.x - crop.width / 2) ** 2 +
        (y - crop.y - crop.height / 2) ** 2;
      if (d < distance) {
        distance = d;
        focusX = x;
        focusY = y;
      }
    }
  if (!Number.isFinite(distance))
    throw new Error("No visible detail region was found.");
  return {
    x: Math.max(
      0,
      Math.min(crop.width - rw, focusX - crop.x - Math.floor(rw / 2)),
    ),
    y: Math.max(
      0,
      Math.min(crop.height - rh, focusY - crop.y - Math.floor(rh / 2)),
    ),
    width: rw,
    height: rh,
  };
}
export function automaticCompositionEvidence(
  foreground: AutoForeground,
  style: StudioStyleId,
) {
  const region = style === "macro" ? foreground.detailRegion : undefined;
  return {
    layout: { ...AUTOMATIC_LAYOUTS[style] },
    ...(region
      ? {
          detailRoi: {
            x: (foreground.sourceBounds?.x ?? 0) + region.x,
            y: (foreground.sourceBounds?.y ?? 0) + region.y,
            width: region.width,
            height: region.height,
          },
          detailUpscaled:
            Math.max(
              (1024 * 0.94) / region.width,
              (1024 * 0.94) / region.height,
            ) > 1,
          detailLimitation:
            "Visible source crop only; resizing adds no authentic detail.",
        }
      : {}),
    ...(style === "billboard"
      ? { artworkLayer: "complete-campaign-v2" as const }
      : {}),
    visualAssessment: "NOT_ASSESSED" as const,
  };
}
export async function composeAutomatic(
  foreground: AutoForeground,
  scene: Blob | undefined,
  style: StudioStyleId,
  signal: AbortSignal,
): Promise<Blob> {
  abort(signal);
  const background = scene ? await createImageBitmap(scene) : null,
    product = await createImageBitmap(foreground.blob);
  try {
    if (background && (background.width !== 1024 || background.height !== 1024))
      throw new Error("The generated image has unexpected dimensions.");
    const c = canvas(1024, 1024),
      ctx = c.getContext("2d")!;
    if (background) ctx.drawImage(background, 0, 0, 1024, 1024);
    else {
      ctx.fillStyle = "#f1f0ec";
      ctx.fillRect(0, 0, 1024, 1024);
    }
    const layout = AUTOMATIC_LAYOUTS[style],
      region = style === "macro" ? foreground.detailRegion : undefined;
    if (style === "macro" && !region)
      throw new Error("Detail crop evidence unavailable.");
    const sw = region?.width ?? product.width,
      sh = region?.height ?? product.height;
    const factor = Math.min(
        (1024 * layout.maxWidth) / sw,
        (1024 * layout.maxHeight) / sh,
      ),
      w = sw * factor,
      h = sh * factor;
    const content = style === "macro" ? undefined : foreground.contentBounds;
    const x =
        layout.centerX * 1024 -
        (content ? content.x + content.width / 2 : sw / 2) * factor,
      y =
        layout.bottom * 1024 -
        (content ? content.y + content.height : sh) * factor;
    if (style !== "macro") {
      // A local soft contact shadow anchors the source foreground to the same
      // declared support line used by the background prompt. Visual fit still
      // needs assessment; generated geometry/light is never certified here.
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,.22)";
      ctx.filter = "blur(12px)";
      ctx.beginPath();
      ctx.ellipse(
        layout.centerX * 1024,
        layout.bottom * 1024 + 3,
        w * 0.43,
        Math.max(7, Math.min(22, w * 0.04)),
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.restore();
    }
    ctx.drawImage(product, region?.x ?? 0, region?.y ?? 0, sw, sh, x, y, w, h);
    abort(signal);
    return await png(c);
  } finally {
    background?.close();
    product.close();
  }
}
// Reference outputs bypass local compositing, so decode them explicitly before
// treating their technical integrity as checked. Header/hash alone is insufficient.
export async function validateAutomaticDecodedImage(
  blob: Blob,
  signal: AbortSignal,
) {
  abort(signal);
  const image = await createImageBitmap(blob);
  try {
    abort(signal);
    if (image.width !== 1024 || image.height !== 1024)
      throw new Error("Unexpected decoded output dimensions.");
  } finally {
    image.close();
  }
}
// The whole completed ad is one immutable layer inside a controlled local display.
export async function mountAutomaticBillboard(
  advertisement: Blob,
  signal: AbortSignal,
): Promise<Blob> {
  abort(signal);
  const ad = await createImageBitmap(advertisement);
  try {
    if (ad.width !== 1024 || ad.height !== 1024)
      throw new Error("Invalid ad canvas.");
    const c = canvas(1024, 1024),
      ctx = c.getContext("2d")!;
    const sky = ctx.createLinearGradient(0, 0, 0, 1024);
    sky.addColorStop(0, "#e4e8e6");
    sky.addColorStop(0.75, "#cdd5d1");
    sky.addColorStop(1, "#9ba9a3");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, 1024, 1024);
    ctx.fillStyle = "#5a6463";
    ctx.fillRect(470, 760, 34, 264);
    ctx.fillRect(550, 760, 34, 264);
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,.25)";
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 12;
    ctx.fillStyle = "#263334";
    ctx.fillRect(137, 66, 750, 750);
    ctx.restore();
    ctx.drawImage(ad, 153, 82, 718, 718);
    const result = await png(c);
    abort(signal);
    return result;
  } finally {
    ad.close();
  }
}

export async function foregroundGeometry(foreground: AutoForeground) {
  const image = await createImageBitmap(foreground.blob);
  try {
    const c = canvas(64, 64),
      ctx = c.getContext("2d")!;
    ctx.drawImage(image, 0, 0, 64, 64);
    const pixels = ctx.getImageData(0, 0, 64, 64).data,
      seen = new Uint8Array(4096);
    let total = 0,
      largest = 0,
      left = 64,
      right = -1,
      top = 64,
      bottom = -1;
    for (let i = 0; i < 4096; i++)
      if (pixels[i * 4 + 3] > 128) {
        total++;
        left = Math.min(left, i % 64);
        right = Math.max(right, i % 64);
        top = Math.min(top, Math.floor(i / 64));
        bottom = Math.max(bottom, Math.floor(i / 64));
      }
    for (let i = 0; i < 4096; i++) {
      if (seen[i] || pixels[i * 4 + 3] <= 128) continue;
      const queue = [i];
      seen[i] = 1;
      for (let at = 0; at < queue.length; at++) {
        const p = queue[at],
          x = p % 64,
          y = Math.floor(p / 64);
        for (const n of [
          x > 0 ? p - 1 : -1,
          x < 63 ? p + 1 : -1,
          y > 0 ? p - 64 : -1,
          y < 63 ? p + 64 : -1,
        ])
          if (n >= 0 && !seen[n] && pixels[n * 4 + 3] > 128) {
            seen[n] = 1;
            queue.push(n);
          }
      }
      largest = Math.max(largest, queue.length);
    }
    const rectangleFill = total
        ? total / ((right - left + 1) * (bottom - top + 1))
        : 0,
      sourceCoverage =
        foreground.contentBounds && foreground.sourceDimensions
          ? (foreground.contentBounds.width * foreground.contentBounds.height) /
            (foreground.sourceDimensions.width *
              foreground.sourceDimensions.height)
          : 0;
    return {
      largestFraction: total ? largest / total : 0,
      rectangleFill,
      sourceCoverage,
    };
  } finally {
    image.close();
  }
}
export async function strictForegroundReliable(foreground: AutoForeground) {
  const shape = await foregroundGeometry(foreground);
  return (
    shape.largestFraction > 0.9 &&
    !(shape.rectangleFill > 0.96 && shape.sourceCoverage > 0.8)
  );
}
export async function strictDetailReliable(foreground: AutoForeground) {
  return (
    foreground.method === "source-alpha" &&
    Boolean(
      foreground.detailRegion &&
      Math.min(foreground.detailRegion.width, foreground.detailRegion.height) >=
        96,
    ) &&
    (await strictForegroundReliable(foreground)) &&
    (await foregroundGeometry(foreground)).rectangleFill < 0.96
  );
}
