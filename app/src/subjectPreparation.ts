import {
  subjectCandidates,
  validDetailBox,
  safeSubjectViews,
  type Box,
  type SourceAnalysis,
  type SourceSubject,
} from "../vision-policy.mjs";
import {
  prepareAutomaticReference,
  type PreparedReference,
} from "./automaticReference";
import { sha256 } from "./prepareSource";
export type SourceRoi = {
  x: number;
  y: number;
  width: number;
  height: number;
  imageIndex: number;
  originalWidth: number;
  originalHeight: number;
};
export type FrozenReference = {
  blob: Blob;
  sha256: string;
  width: number;
  height: number;
  sourceSha256: string;
  normalizedSha256: string;
  roi: SourceRoi;
};
export type SubjectPreparation = {
  references: PreparedReference[];
  frozen: FrozenReference[];
  subject: SourceSubject;
  detail?: Blob;
  detailRoi?: SourceRoi;
  detailReason?: "DETAIL_LOW_RESOLUTION" | "DETAIL_UNRELIABLE";
};
const check = (signal: AbortSignal) => {
  if (signal.aborted) throw new DOMException("Stopped", "AbortError");
};
async function encode(canvas: HTMLCanvasElement) {
  const result = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!result) throw new Error("Image preparation failed.");
  return result;
}
export function sourcePixelRoi(
  box: Box,
  width: number,
  height: number,
  imageIndex: number,
): SourceRoi {
  const x = Math.max(0, Math.floor(box.x * width)),
    y = Math.max(0, Math.floor(box.y * height));
  return {
    x,
    y,
    width: Math.min(width, Math.ceil((box.x + box.width) * width)) - x,
    height: Math.min(height, Math.ceil((box.y + box.height) * height)) - y,
    imageIndex,
    originalWidth: width,
    originalHeight: height,
  };
}
export async function cropOriginal(
  file: Blob,
  box: Box,
  imageIndex: number,
  signal: AbortSignal,
) {
  check(signal);
  const image = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  try {
    const roi = sourcePixelRoi(box, image.width, image.height, imageIndex),
      canvas = document.createElement("canvas");
    canvas.width = roi.width;
    canvas.height = roi.height;
    canvas
      .getContext("2d")!
      .drawImage(
        image,
        roi.x,
        roi.y,
        roi.width,
        roi.height,
        0,
        0,
        roi.width,
        roi.height,
      );
    const blob = await encode(canvas);
    check(signal);
    return { blob, roi };
  } finally {
    image.close();
  }
}
export async function prepareSubject(
  files: File[],
  normalized: PreparedReference[],
  analysis: SourceAnalysis,
  subjectId: string,
  signal: AbortSignal,
): Promise<SubjectPreparation> {
  const subject = subjectCandidates(analysis).find((s) => s.id === subjectId);
  if (!subject) throw new Error("SUBJECT_UNRELIABLE");
  const views = [subject, ...safeSubjectViews(analysis, subject)].slice(0, 3);
  const result: SubjectPreparation = { references: [], frozen: [], subject };
  for (const view of views) {
    check(signal);
    const crop = await cropOriginal(
      files[view.imageIndex],
      view.box,
      view.imageIndex,
      signal,
    );
    for (const annotation of analysis.textRegions.filter(
      (t) => t.imageIndex === view.imageIndex,
    )) {
      const text = sourcePixelRoi(
        annotation.box,
        crop.roi.originalWidth,
        crop.roi.originalHeight,
        view.imageIndex,
      );
      if (
        Math.min(text.x + text.width, crop.roi.x + crop.roi.width) >
          Math.max(text.x, crop.roi.x) &&
        Math.min(text.y + text.height, crop.roi.y + crop.roi.height) >
          Math.max(text.y, crop.roi.y)
      )
        throw new Error("SUBJECT_OVERLAPS_ANNOTATION");
    }
    const wire = await prepareAutomaticReference(
      new File([crop.blob], "subject.png", { type: "image/png" }),
      signal,
    );
    result.references.push(wire);
    const bytes = Uint8Array.from(atob(wire.dataBase64), (c) =>
      c.charCodeAt(0),
    );
    result.frozen.push({
      blob: new Blob([bytes], { type: "image/png" }),
      sha256: wire.sha256,
      width: wire.width,
      height: wire.height,
      sourceSha256: await sha256(
        new Uint8Array(await files[view.imageIndex].arrayBuffer()),
      ),
      normalizedSha256: normalized[view.imageIndex].sha256,
      roi: crop.roi,
    });
  }
  const detail = validDetailBox(analysis, subject);
  if (!detail) {
    result.detailReason = "DETAIL_UNRELIABLE";
    return result;
  }
  const image = await createImageBitmap(files[subject.imageIndex], {
    imageOrientation: "from-image",
  });
  try {
    const box = sourcePixelRoi(
        detail,
        image.width,
        image.height,
        subject.imageIndex,
      ),
      side = Math.floor(Math.min(box.width, box.height));
    if (side < 96) {
      result.detailReason = "DETAIL_LOW_RESOLUTION";
      return result;
    }
    const roi = {
      ...box,
      x: box.x + Math.floor((box.width - side) / 2),
      y: box.y + Math.floor((box.height - side) / 2),
      width: side,
      height: side,
    };
    if (
      analysis.textRegions.some((t) => {
        if (t.imageIndex !== subject.imageIndex) return false;
        const text = sourcePixelRoi(
          t.box,
          image.width,
          image.height,
          t.imageIndex,
        );
        return (
          Math.min(text.x + text.width, roi.x + roi.width) >
            Math.max(text.x, roi.x) &&
          Math.min(text.y + text.height, roi.y + roi.height) >
            Math.max(text.y, roi.y)
        );
      })
    ) {
      result.detailReason = "DETAIL_UNRELIABLE";
      return result;
    }
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1024;
    canvas
      .getContext("2d")!
      .drawImage(image, roi.x, roi.y, side, side, 0, 0, 1024, 1024);
    result.detail = await encode(canvas);
    result.detailRoi = roi;
    check(signal);
    return result;
  } finally {
    image.close();
  }
}
export async function thawReferences(
  frozen: FrozenReference[],
  signal: AbortSignal,
) {
  const refs: PreparedReference[] = [];
  for (const ref of frozen) {
    check(signal);
    const bytes = new Uint8Array(await ref.blob.arrayBuffer());
    if ((await sha256(bytes)) !== ref.sha256)
      throw new Error("Saved source reference changed.");
    let raw = "";
    for (let i = 0; i < bytes.length; i += 8192)
      raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
    refs.push({
      mimeType: "image/png",
      width: ref.width,
      height: ref.height,
      sha256: ref.sha256,
      dataBase64: btoa(raw),
    });
  }
  return refs;
}
export async function candidatePreview(
  files: File[],
  subject: SourceSubject,
  signal: AbortSignal,
) {
  return (
    await cropOriginal(
      files[subject.imageIndex],
      subject.box,
      subject.imageIndex,
      signal,
    )
  ).blob;
}
