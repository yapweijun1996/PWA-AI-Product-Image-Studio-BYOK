export type ImageHeader = {
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
  orientation: number;
};

const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function text(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function exifOrientation(bytes: Uint8Array, start: number, end: number): number {
  if (text(bytes, start, 6) === 'Exif\0\0') start += 6;
  if (start + 8 > end) throw new Error('The image has invalid EXIF metadata.');
  const order = text(bytes, start, 2);
  if (order !== 'II' && order !== 'MM') throw new Error('The image has invalid EXIF metadata.');
  const little = order === 'II';
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (offset: number) => {
    if (offset < start || offset + 2 > end) throw new Error('The image has invalid EXIF metadata.');
    return view.getUint16(offset, little);
  };
  const u32 = (offset: number) => {
    if (offset < start || offset + 4 > end) throw new Error('The image has invalid EXIF metadata.');
    return view.getUint32(offset, little);
  };
  if (u16(start + 2) !== 42) throw new Error('The image has invalid EXIF metadata.');
  const ifd = start + u32(start + 4);
  const count = u16(ifd);
  if (ifd + 2 + count * 12 + 4 > end) throw new Error('The image has invalid EXIF metadata.');
  for (let index = 0; index < count; index++) {
    const entry = ifd + 2 + index * 12;
    if (u16(entry) !== 0x0112) continue;
    if (u16(entry + 2) !== 3 || u32(entry + 4) !== 1) throw new Error('The image has invalid EXIF orientation.');
    const orientation = u16(entry + 8);
    if (orientation < 1 || orientation > 8) throw new Error('The image has invalid EXIF orientation.');
    return orientation;
  }
  return 1;
}

export function inspectImageHeader(bytes: Uint8Array): ImageHeader {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const invalid = () => { throw new Error('The file is not a supported, valid PNG, JPEG or WebP image.'); };
  if (bytes.length >= 33 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) {
    let offset = 8;
    let width = 0, height = 0, orientation = 1, sawEnd = false;
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset);
      const type = text(bytes, offset + 4, 4);
      const data = offset + 8;
      const end = data + length;
      if (end + 4 > bytes.length) invalid();
      if (offset === 8) {
        if (type !== 'IHDR' || length !== 13) invalid();
        width = view.getUint32(data); height = view.getUint32(data + 4);
      }
      if (type === 'acTL') throw new Error('Animated images are not supported as product sources.');
      if (type === 'eXIf') orientation = exifOrientation(bytes, data, end);
      offset = end + 4;
      if (type === 'IEND') { sawEnd = true; break; }
    }
    if (!width || !height || !sawEnd) invalid();
    return { mimeType: 'image/png', width, height, orientation };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2, width = 0, height = 0, orientation = 1;
    while (offset + 1 < bytes.length) {
      if (bytes[offset++] !== 0xff) invalid();
      while (offset < bytes.length && bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) invalid();
      const length = view.getUint16(offset);
      const end = offset + length;
      if (length < 2 || end > bytes.length) invalid();
      if (marker === 0xe1 && length >= 8 && text(bytes, offset + 2, 6) === 'Exif\0\0') {
        orientation = exifOrientation(bytes, offset + 2, end);
      }
      if (JPEG_SOF.has(marker)) {
        if (length < 8) invalid();
        height = view.getUint16(offset + 3); width = view.getUint16(offset + 5);
      }
      offset = end;
    }
    if (!width || !height) invalid();
    return { mimeType: 'image/jpeg', width, height, orientation };
  }
  if (bytes.length >= 20 && text(bytes, 0, 4) === 'RIFF' && text(bytes, 8, 4) === 'WEBP') {
    const end = view.getUint32(4, true) + 8;
    if (end > bytes.length || end < 20) invalid();
    let offset = 12, width = 0, height = 0, orientation = 1;
    while (offset + 8 <= end) {
      const type = text(bytes, offset, 4);
      const length = view.getUint32(offset + 4, true);
      const data = offset + 8, chunkEnd = data + length;
      if (chunkEnd > end) invalid();
      if (type === 'VP8X') {
        if (length < 10) invalid();
        if (bytes[data] & 0x02) throw new Error('Animated images are not supported as product sources.');
        width = 1 + bytes[data + 4] + (bytes[data + 5] << 8) + (bytes[data + 6] << 16);
        height = 1 + bytes[data + 7] + (bytes[data + 8] << 8) + (bytes[data + 9] << 16);
      } else if (type === 'VP8 ' && !width) {
        if (length < 10 || bytes[data + 3] !== 0x9d || bytes[data + 4] !== 0x01 || bytes[data + 5] !== 0x2a) invalid();
        width = view.getUint16(data + 6, true) & 0x3fff;
        height = view.getUint16(data + 8, true) & 0x3fff;
      } else if (type === 'VP8L' && !width) {
        if (length < 5 || bytes[data] !== 0x2f) invalid();
        const bits = view.getUint32(data + 1, true);
        width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1;
      } else if (type === 'EXIF') {
        orientation = exifOrientation(bytes, data, chunkEnd);
      } else if (type === 'ANIM' || type === 'ANMF') {
        throw new Error('Animated images are not supported as product sources.');
      }
      offset = chunkEnd + (length & 1);
    }
    if (!width || !height || offset !== end) invalid();
    return { mimeType: 'image/webp', width, height, orientation };
  }
  return invalid();
}
