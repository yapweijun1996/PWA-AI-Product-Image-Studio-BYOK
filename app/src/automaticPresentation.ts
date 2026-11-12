import { automaticStyleLabel } from "../automatic-policy.mjs";
import type { AutoItem } from "./automaticStore";
import { t } from "./ui/i18n";
export function resultLabel(item: AutoItem) {
  if (item.provenance?.policyVersion !== "2.0.0")
    return t(
      item.style === "billboard"
        ? "Billboard (legacy)"
        : item.style === "macro"
          ? "Detail (legacy)"
          : item.style === "flat_lay"
            ? "Tabletop (legacy)"
            : automaticStyleLabel(item.style, item.provenance?.mode),
    );
  return t(
    item.style === "flat_lay"
      ? "Tabletop"
      : item.style === "macro"
        ? "Detail"
        : automaticStyleLabel(item.style, item.provenance.mode),
  );
}
export function downloadAutomatic(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export function imageFilename(item: AutoItem) {
  return `${item.style === "billboard" && item.provenance?.policyVersion === "2.0.0" ? "campaign" : item.style}-${item.id.slice(0, 8)}.png`;
}
export function userCopyAllowed(value: string) {
  return (
    value.length <= 240 &&
    !/[\p{Cc}\p{Cf}]/u.test(value.replace(/\n/g, "")) &&
    !/\b(?:sk-[A-Za-z0-9_-]{8,}|bearer\s+[A-Za-z0-9_-]{8,}|(?:api[ -]*key|password|secret|token)\s*[:=]\s*\S+)/i.test(
      value,
    )
  );
}
export async function campaignCopy(
  base: Blob,
  brand: string,
  headline: string,
) {
  if (
    brand.length > 80 ||
    headline.length > 160 ||
    !userCopyAllowed(brand) ||
    !userCopyAllowed(headline)
  )
    throw new Error("COPY_NOT_ALLOWED");
  const image = await createImageBitmap(base);
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 1024;
    const ctx = c.getContext("2d")!;
    const wrap = (text: string, size: number) => {
      ctx.font = `600 ${size}px system-ui`;
      const lines: string[] = [];
      let line = "";
      for (const char of text) {
        if (char === "\n" || ctx.measureText(line + char).width > 232) {
          lines.push(line);
          line = "";
        }
        if (char !== "\n") line += char;
      }
      if (line || text.endsWith("\n")) lines.push(line);
      return lines;
    };
    let brandSize = 24,
      headlineSize = 34,
      brandLines = wrap(brand, brandSize),
      headlineLines = wrap(headline, headlineSize);
    const height = () =>
      brandLines.length * brandSize * 1.3 +
      headlineLines.length * headlineSize * 1.3 +
      80;
    while (height() > 860 && headlineSize > 16) {
      brandSize = Math.max(12, brandSize - 1);
      headlineSize -= 1;
      brandLines = wrap(brand, brandSize);
      headlineLines = wrap(headline, headlineSize);
    }
    if (height() > 860) throw new Error("COPY_TOO_LONG");
    ctx.drawImage(image, 0, 0);
    ctx.fillStyle = "rgba(10,20,20,.7)";
    ctx.fillRect(24, 48, 280, height());
    ctx.fillStyle = "#ffffff";
    let y = 84;
    for (const [lines, size] of [
      [brandLines, brandSize],
      [headlineLines, headlineSize],
    ] as const) {
      ctx.font = `600 ${size}px system-ui`;
      for (const line of lines) {
        ctx.fillText(line, 48, y);
        y += size * 1.3;
      }
      y += 24;
    }
    const blob = await new Promise<Blob | null>((resolve) =>
      c.toBlob(resolve, "image/png"),
    );
    if (!blob) throw new Error("OUTPUT_UNREADABLE");
    return blob;
  } finally {
    image.close();
  }
}
