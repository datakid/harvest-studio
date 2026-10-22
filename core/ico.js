import { decodePng } from './codecs.js';

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47];
const MIN_TARGET = 192;

const isPng = (bytes, offset) => PNG_SIG.every((v, i) => bytes[offset + i] === v);

export const readIcoEntries = (bytes) => {
  if (bytes.length < 6 || bytes[0] !== 0 || bytes[1] !== 0) throw new Error('not an ico file');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = view.getUint16(2, true);
  if (type !== 1 && type !== 2) throw new Error('not an ico file');
  const count = view.getUint16(4, true);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 16;
    if (at + 16 > bytes.length) break;
    const offset = view.getUint32(at + 12, true);
    const declared = view.getUint32(at + 8, true);
    if (offset >= bytes.length) continue;
    entries.push({ index: i, width: bytes[at] || 256, height: bytes[at + 1] || 256, bpp: view.getUint16(at + 6, true), offset, size: Math.min(declared || bytes.length - offset, bytes.length - offset) });
  }
  if (!entries.length) throw new Error('ico has no usable entries');
  return entries;
};

export const orderFrames = (entries) => {
  const byDepth = (a, b) => b.bpp - a.bpp;
  const big = entries.filter((e) => Math.max(e.width, e.height) >= MIN_TARGET).sort((a, b) => a.width - b.width || byDepth(a, b));
  const small = entries.filter((e) => Math.max(e.width, e.height) < MIN_TARGET).sort((a, b) => b.width - a.width || byDepth(a, b));
  return big.concat(small);
};

const rowStride = (width, bits) => ((width * bits + 31) >> 5) << 2;

export const decodeBmpFrame = (bytes, entry) => {
  const data = bytes.subarray(entry.offset, entry.offset + entry.size);
  if (data.length < 40) throw new Error('bitmap header is truncated');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const headerSize = view.getUint32(0, true);
  if (headerSize < 40 || headerSize > data.length) throw new Error('bitmap header is invalid');
  const width = Math.abs(view.getInt32(4, true)) || entry.width;
  const signedHeight = view.getInt32(8, true);
  const rawHeight = Math.abs(signedHeight);
  const bitCount = view.getUint16(14, true);
  const compression = view.getUint32(16, true);
  const clrUsed = view.getUint32(32, true);
  if (compression !== 0 && !(compression === 3 && (bitCount === 32 || bitCount === 24))) throw new Error('compressed bitmap frames are not supported');
  if (![1, 4, 8, 16, 24, 32].includes(bitCount)) throw new Error('unsupported bit depth ' + bitCount);
  if (bitCount === 16 && compression !== 0) throw new Error('unsupported bit depth 16');
  const height = rawHeight >= width * 2 || rawHeight === entry.height * 2 ? rawHeight >> 1 : rawHeight;
  if (!width || !height || width > 1024 || height > 1024) throw new Error('bitmap size is invalid');
  const paletteCount = bitCount <= 8 ? clrUsed || 1 << bitCount : 0;
  const masksBytes = compression === 3 && headerSize === 40 ? 12 : 0;
  const paletteAt = headerSize + masksBytes;
  const pixelsAt = paletteAt + paletteCount * 4;
  const stride = rowStride(width, bitCount);
  if (pixelsAt + stride * height > data.length) throw new Error('bitmap data is truncated');
  const maskStride = rowStride(width, 1);
  const maskAt = pixelsAt + stride * height;
  const hasMask = maskAt + maskStride * height <= data.length;
  const topDown = signedHeight < 0;
  const out = new Uint8ClampedArray(width * height * 4);
  let anyAlpha = false;
  const maskBit = (x, y) => (hasMask ? (data[maskAt + y * maskStride + (x >> 3)] >> (7 - (x & 7))) & 1 : 0);
  for (let y = 0; y < height; y++) {
    const fileRow = topDown ? y : height - 1 - y;
    const row = pixelsAt + fileRow * stride;
    const maskRow = topDown ? y : height - 1 - y;
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      let r;
      let g;
      let b;
      let a = 255;
      if (bitCount === 32) {
        b = data[row + x * 4];
        g = data[row + x * 4 + 1];
        r = data[row + x * 4 + 2];
        a = data[row + x * 4 + 3];
        if (a) anyAlpha = true;
      } else if (bitCount === 24) {
        b = data[row + x * 3];
        g = data[row + x * 3 + 1];
        r = data[row + x * 3 + 2];
      } else if (bitCount === 16) {
        const v = data[row + x * 2] | (data[row + x * 2 + 1] << 8);
        r = Math.round((((v >> 10) & 31) * 255) / 31);
        g = Math.round((((v >> 5) & 31) * 255) / 31);
        b = Math.round(((v & 31) * 255) / 31);
      } else {
        const index = bitCount === 8 ? data[row + x] : bitCount === 4 ? (data[row + (x >> 1)] >> (x & 1 ? 0 : 4)) & 15 : (data[row + (x >> 3)] >> (7 - (x & 7))) & 1;
        const at = paletteAt + Math.min(index, paletteCount - 1) * 4;
        b = data[at];
        g = data[at + 1];
        r = data[at + 2];
      }
      if (bitCount !== 32) a = maskBit(x, maskRow) ? 0 : 255;
      out[p] = r;
      out[p + 1] = g;
      out[p + 2] = b;
      out[p + 3] = a;
    }
  }
  if (bitCount === 32 && !anyAlpha) {
    for (let y = 0; y < height; y++) {
      const maskRow = topDown ? y : height - 1 - y;
      for (let x = 0; x < width; x++) out[(y * width + x) * 4 + 3] = maskBit(x, maskRow) ? 0 : 255;
    }
  }
  return { width, height, data: out };
};

const isBlank = (image) => {
  for (let p = 3; p < image.data.length; p += 4) if (image.data[p] !== 0) return false;
  return true;
};

export const decodeIcoBytes = async (bytes) => {
  if (isPng(bytes, 0)) {
    const image = await decodePng(bytes);
    return { image, srcWidth: image.width };
  }
  const entries = orderFrames(readIcoEntries(bytes));
  const failures = [];
  for (const entry of entries) {
    try {
      const frame = bytes.subarray(entry.offset, entry.offset + entry.size);
      const image = isPng(frame, 0) ? await decodePng(frame) : decodeBmpFrame(bytes, entry);
      if (isBlank(image)) {
        failures.push(entry.width + 'x' + entry.height + ': fully transparent');
        continue;
      }
      return { image, srcWidth: image.width };
    } catch (e) {
      failures.push(entry.width + 'x' + entry.height + ': ' + (e && e.message ? e.message : e));
    }
  }
  throw new Error('no usable ico frame (' + failures.slice(0, 3).join('; ') + ')');
};
