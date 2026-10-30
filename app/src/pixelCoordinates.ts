/** Maximum individual field value; the full rectangle still requires validation. */
export function pixelFieldMax(field: 'x' | 'y' | 'width' | 'height', width: number, height: number): number {
  if (field === 'x') return width - 1;
  if (field === 'y') return height - 1;
  return field === 'width' ? width : height;
}
