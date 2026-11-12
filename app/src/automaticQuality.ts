import type { AutoItem } from "./automaticStore";
export async function localSimilarity(items: AutoItem[]) {
  const ready = items.filter(
      (i) => i.status === "READY" && i.output && i.style !== "macro",
    ),
    samples = new Map<string, Uint8ClampedArray>();
  for (const item of ready) {
    const image = await createImageBitmap(item.output!);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 16;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(image, 0, 0, 16, 16);
      samples.set(item.id, ctx.getImageData(0, 0, 16, 16).data);
    } finally {
      image.close();
    }
    item.similarity = [];
  }
  for (let a = 0; a < ready.length; a++)
    for (let b = a + 1; b < ready.length; b++) {
      const left = samples.get(ready[a].id)!,
        right = samples.get(ready[b].id)!;
      let squared = 0;
      for (let i = 0; i < left.length; i++)
        if (i % 4 !== 3) squared += (left[i] - right[i]) ** 2;
      const distance = Math.sqrt(squared / (16 * 16 * 3)) / 255;
      if (distance < 0.035) {
        ready[a].similarity!.push({ otherStyle: ready[b].style, distance });
        ready[b].similarity!.push({ otherStyle: ready[a].style, distance });
      }
    }
}
export function needsAttention(item: AutoItem) {
  return Boolean(
    item.similarity?.length ||
    (item.semantic &&
      (item.semantic.outputSha256 !== item.sha256 ||
        item.semantic.identity !== "consistent" ||
        item.semantic.composition !== "usable" ||
        item.semantic.confidence < 0.8 ||
        item.semantic.reasons.length)),
  );
}
export function usableItem(item: AutoItem) {
  return item.status === "READY" && Boolean(item.output && item.sha256);
}
