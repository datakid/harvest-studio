import { encodePng } from '../core/index.js';

export const bookImage = (size) => {
  const data = new Uint8ClampedArray(size * size * 4);
  const ink = (x, y, a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const p = (y * size + x) * 4;
    data[p + 3] = Math.max(data[p + 3], a);
  };
  const stroke = Math.max(1, Math.round(size / 16));
  const left = Math.round(size * 0.1);
  const right = size - left;
  const top = Math.round(size * 0.2);
  const bottom = size - Math.round(size * 0.16);
  const mid = size >> 1;
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const outer = x < left + stroke || x >= right - stroke || y < top + stroke || y >= bottom - stroke;
      const spine = Math.abs(x - mid) < stroke;
      const rule = (y - top) % Math.max(4, Math.round(size / 6)) < Math.max(1, stroke - 1) && y > top + stroke * 2 && Math.abs(x - mid) > stroke * 2 && x > left + stroke * 2 && x < right - stroke * 2;
      if (outer || spine || rule) ink(x, y, x === left || y === top ? 200 : 255);
    }
  }
  return { width: size, height: size, data };
};

const u16 = (v) => [v & 255, (v >> 8) & 255];
const u32 = (v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];

const rowStride = (width, bits) => Math.ceil((width * bits) / 32) * 4;

const maskRows = (img) => {
  const stride = rowStride(img.width, 1);
  const out = new Uint8Array(stride * img.height);
  for (let y = 0; y < img.height; y++) {
    const dst = img.height - 1 - y;
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3] < 128) out[dst * stride + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return out;
};

export const bmpFrame = (img, { bpp = 32, alpha = 'real', mask = true, singleHeight = false } = {}) => {
  const { width, height } = img;
  const palette = [];
  if (bpp <= 8) {
    const seen = new Map();
    for (let p = 0; p < width * height; p++) {
      const key = img.data[p * 4] + ',' + img.data[p * 4 + 1] + ',' + img.data[p * 4 + 2];
      if (!seen.has(key) && seen.size < 1 << bpp) seen.set(key, seen.size);
    }
    for (const key of seen.keys()) palette.push(key.split(',').map(Number));
    img = { ...img, indexOf: (p) => seen.get(img.data[p * 4] + ',' + img.data[p * 4 + 1] + ',' + img.data[p * 4 + 2]) ?? 0 };
  }
  const stride = rowStride(width, bpp);
  const xor = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const dst = (height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      const r = img.data[p * 4];
      const g = img.data[p * 4 + 1];
      const b = img.data[p * 4 + 2];
      const a = img.data[p * 4 + 3];
      if (bpp === 32) {
        xor.set([b, g, r, alpha === 'zero' ? 0 : a], dst + x * 4);
      } else if (bpp === 24) {
        xor.set([b, g, r], dst + x * 3);
      } else if (bpp === 8) {
        xor[dst + x] = img.indexOf(p);
      } else if (bpp === 4) {
        xor[dst + (x >> 1)] |= img.indexOf(p) << (x & 1 ? 0 : 4);
      } else if (bpp === 1) {
        xor[dst + (x >> 3)] |= img.indexOf(p) << (7 - (x & 7));
      }
    }
  }
  const header = [...u32(40), ...u32(width), ...u32(singleHeight || !mask ? height : height * 2), ...u16(1), ...u16(bpp), ...u32(0), ...u32(0), ...u32(0), ...u32(0), ...u32(palette.length), ...u32(0)];
  const paletteBytes = palette.flatMap(([r, g, b]) => [b, g, r, 0]);
  const parts = [Uint8Array.from(header), Uint8Array.from(paletteBytes), xor];
  if (mask) parts.push(maskRows(img));
  const size = parts.reduce((n, a) => n + a.length, 0);
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.length;
  }
  return { width, height, bpp, bytes };
};

export const pngFrame = async (img) => ({ width: img.width, height: img.height, bpp: 32, bytes: await encodePng(img, { optimise: false }) });

export const buildIco = (frames) => {
  const head = 6 + frames.length * 16;
  const total = frames.reduce((n, f) => n + f.bytes.length, head);
  const out = new Uint8Array(total);
  out.set([0, 0, 1, 0, ...u16(frames.length)], 0);
  let offset = head;
  frames.forEach((f, i) => {
    out.set([f.width >= 256 ? 0 : f.width, f.height >= 256 ? 0 : f.height, 0, 0, ...u16(1), ...u16(f.bpp), ...u32(f.bytes.length), ...u32(offset)], 6 + i * 16);
    out.set(f.bytes, offset);
    offset += f.bytes.length;
  });
  return out;
};

export const damaged = (frame) => ({ ...frame, bytes: frame.bytes.slice(0, 20) });
