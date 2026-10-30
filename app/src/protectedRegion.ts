import type { StrictRect } from './strictComposite';

type Point = { x: number; y: number };

// Expand to whole source pixels so fractional screen coordinates never omit an edge.
export function regionFromDrag(start: Point, end: Point, width: number, height: number): StrictRect | null {
  if (![start.x, start.y, end.x, end.y, width, height].every(Number.isFinite) ||
      !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) return null;
  const clamp = (value: number, limit: number) => Math.max(0, Math.min(limit, value));
  const x1 = clamp(start.x, width), x2 = clamp(end.x, width), y1 = clamp(start.y, height), y2 = clamp(end.y, height);
  if (Math.abs(x2 - x1) < 1 || Math.abs(y2 - y1) < 1) return null;
  const x = Math.floor(Math.min(x1, x2)), y = Math.floor(Math.min(y1, y2));
  return { x, y, width: Math.ceil(Math.max(x1, x2)) - x, height: Math.ceil(Math.max(y1, y2)) - y };
}
