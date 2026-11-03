import { smooth } from './color.js';
import { makeImage, cropImage, pasteImage, resizeTo } from './pixels.js';
import { rasterSvg, resizeKernel } from './codecs.js';
import { lazyInit, utf8 } from './runtime.js';

export const solve3 = (m, v) => {
  const a = m.map((r, i) => [...r, v[i]]);
  for (let i = 0; i < 3; i++) {
    let piv = i;
    for (let r = i + 1; r < 3; r++) if (Math.abs(a[r][i]) > Math.abs(a[piv][i])) piv = r;
    if (Math.abs(a[piv][i]) < 1e-9) return null;
    [a[i], a[piv]] = [a[piv], a[i]];
    for (let r = 0; r < 3; r++) {
      if (r === i) continue;
      const f = a[r][i] / a[i][i];
      for (let c = i; c < 4; c++) a[r][c] -= f * a[i][c];
    }
  }
  return [a[0][3] / a[0][0], a[1][3] / a[1][1], a[2][3] / a[2][2]];
};

export const fitBackground = (pts, lab, w, h) => {
  if (pts.length < 40) return null;
  const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const rhs = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of pts) {
    const f = [1, (p % w) / w, Math.floor(p / w) / h];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) m[i][j] += f[i] * f[j];
      for (let c = 0; c < 3; c++) rhs[c][i] += f[i] * lab[p * 3 + c];
    }
  }
  const coef = [0, 1, 2].map((c) => solve3(m, rhs[c]));
  if (coef.some((c) => !c)) return null;
  return (p) => {
    const x = (p % w) / w;
    const y = Math.floor(p / w) / h;
    return coef.map((k) => k[0] + k[1] * x + k[2] * y);
  };
};

export const GLYPH_SIZE = 128;
export const GLYPH_CONTENT = 92;
export const GLYPH_PAD = 18;
export const SAFE_TARGET = GLYPH_CONTENT / GLYPH_SIZE;
export const SAFE_TOLERANCE = 0.04;
export const CENTRE_TOLERANCE = 0.03;

export const alphaCentroid = (img) => {
  let sum = 0;
  let sx = 0;
  let sy = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const a = img.data[(y * img.width + x) * 4 + 3];
      sum += a;
      sx += a * (x + 0.5);
      sy += a * (y + 0.5);
    }
  }
  return sum ? [sx / sum, sy / sum] : [img.width / 2, img.height / 2];
};

export const alphaBounds = (img, threshold = 128) => {
  let minX = img.width;
  let minY = img.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3] < threshold) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
};

const GLYPH_MARGIN = 6;

const centreOnCentroid = (content) => {
  const [cx, cy] = alphaCentroid(content);
  const bounds = alphaBounds(content) || { x: 0, y: 0, width: content.width, height: content.height };
  const place = (centroid, from, size) => {
    const want = GLYPH_SIZE / 2 - centroid;
    return Math.round(Math.min(GLYPH_SIZE - GLYPH_MARGIN - (from + size), Math.max(GLYPH_MARGIN - from, want)));
  };
  const out = makeImage(GLYPH_SIZE, GLYPH_SIZE);
  return pasteImage(out, content, place(cx, bounds.x, bounds.width), place(cy, bounds.y, bounds.height));
};

export const extractGlyph = async (data, lab, w, h) => {
  const n = w * h;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  let solid = 0;
  for (let p = 0; p < n; p++) {
    if (data[p * 4 + 3] < 128) continue;
    const x = p % w;
    const y = (p - x) / w;
    solid++;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!solid) return null;
  const fill = solid / ((maxX - minX + 1) * (maxY - minY + 1));
  const clear = (x, y) => x < 0 || y < 0 || x >= w || y >= h || data[(y * w + x) * 4 + 3] < 128;
  const nearEdge = (p, d) => {
    const x = p % w;
    const y = (p - x) / w;
    return clear(x - d, y) || clear(x + d, y) || clear(x, y - d) || clear(x, y + d);
  };

  const plainAlpha = () => {
    const alpha = new Float32Array(n);
    for (let p = 0; p < n; p++) alpha[p] = data[p * 4 + 3] / 255;
    return alpha;
  };

  const uniformAlpha = () => {
    let count = 0;
    let L = 0;
    let A = 0;
    let B = 0;
    const band = new Uint8Array(n);
    for (let p = 0; p < n; p++) {
      if (data[p * 4 + 3] < 200 || !nearEdge(p, 3)) continue;
      band[p] = 1;
      count++;
      L += lab[p * 3];
      A += lab[p * 3 + 1];
      B += lab[p * 3 + 2];
    }
    if (!count) return null;
    L /= count;
    A /= count;
    B /= count;
    let spread = 0;
    for (let p = 0; p < n; p++) {
      if (!band[p]) continue;
      const dl = lab[p * 3] - L;
      const da = lab[p * 3 + 1] - A;
      const db = lab[p * 3 + 2] - B;
      spread += Math.sqrt(dl * dl + da * da + db * db);
    }
    if (spread / count > 0.06) return null;
    const alpha = new Float32Array(n);
    for (let p = 0; p < n; p++) {
      const dl = lab[p * 3] - L;
      const da = lab[p * 3 + 1] - A;
      const db = lab[p * 3 + 2] - B;
      alpha[p] = (data[p * 4 + 3] / 255) * smooth(0.08, 0.22, Math.sqrt(dl * dl + da * da + db * db));
    }
    return alpha;
  };

  const ringAlpha = () => {
    const ring = [];
    for (let p = 0; p < n; p++) {
      if (data[p * 4 + 3] < 200) continue;
      if (!nearEdge(p, 7) && nearEdge(p, 16)) ring.push(p);
    }
    const bgAt = fitBackground(ring, lab, w, h);
    if (!bgAt) return null;
    let res = 0;
    for (const p of ring) {
      const b = bgAt(p);
      res += Math.hypot(lab[p * 3] - b[0], lab[p * 3 + 1] - b[1], lab[p * 3 + 2] - b[2]);
    }
    if (res / ring.length > 0.05) return null;
    const alpha = new Float32Array(n);
    for (let p = 0; p < n; p++) {
      if (nearEdge(p, 7)) continue;
      const b = bgAt(p);
      alpha[p] = (data[p * 4 + 3] / 255) * smooth(0.08, 0.22, Math.hypot(lab[p * 3] - b[0], lab[p * 3 + 1] - b[1], lab[p * 3 + 2] - b[2]));
    }
    return alpha;
  };

  const robustBounds = (alpha) => {
    const label = new Int32Array(n).fill(-1);
    const comps = [];
    for (let start = 0; start < n; start++) {
      if (alpha[start] < 0.5 || label[start] >= 0) continue;
      const id = comps.length;
      const comp = { area: 0, x0: w, y0: h, x1: -1, y1: -1 };
      const stack = [start];
      label[start] = id;
      while (stack.length) {
        const p = stack.pop();
        const x = p % w;
        const y = (p - x) / w;
        comp.area++;
        if (x < comp.x0) comp.x0 = x;
        if (x > comp.x1) comp.x1 = x;
        if (y < comp.y0) comp.y0 = y;
        if (y > comp.y1) comp.y1 = y;
        if (x > 0 && alpha[p - 1] >= 0.5 && label[p - 1] < 0) {
          label[p - 1] = id;
          stack.push(p - 1);
        }
        if (x < w - 1 && alpha[p + 1] >= 0.5 && label[p + 1] < 0) {
          label[p + 1] = id;
          stack.push(p + 1);
        }
        if (y > 0 && alpha[p - w] >= 0.5 && label[p - w] < 0) {
          label[p - w] = id;
          stack.push(p - w);
        }
        if (y < h - 1 && alpha[p + w] >= 0.5 && label[p + w] < 0) {
          label[p + w] = id;
          stack.push(p + w);
        }
      }
      comps.push(comp);
    }
    const total = comps.reduce((s2, c) => s2 + c.area, 0);
    const kept = comps.filter((c) => c.area >= total * 0.005);
    const use = kept.length ? kept : comps;
    return { on: total, x0: Math.min(...use.map((c) => c.x0)), y0: Math.min(...use.map((c) => c.y0)), x1: Math.max(...use.map((c) => c.x1)), y1: Math.max(...use.map((c) => c.y1)) };
  };

  const finish = async (alpha) => {
    const found = robustBounds(alpha);
    const on = found.on;
    const gx0 = found.x0;
    const gy0 = found.y0;
    const gx1 = found.x1;
    const gy1 = found.y1;
    if (!on) return null;
    const cover = on / n;
    const gfill = on / ((gx1 - gx0 + 1) * (gy1 - gy0 + 1));
    if (cover < 0.02 || cover > 0.6 || gfill > 0.85) return null;
    const full = makeImage(w, h);
    for (let p = 0; p < n; p++) {
      full.data[p * 4] = 255;
      full.data[p * 4 + 1] = 255;
      full.data[p * 4 + 2] = 255;
      full.data[p * 4 + 3] = Math.round(alpha[p] * 255);
    }
    const cropped = cropImage(full, gx0, gy0, gx1 - gx0 + 1, gy1 - gy0 + 1);
    return centreOnCentroid(await resizeTo(cropped, GLYPH_CONTENT, GLYPH_CONTENT));
  };

  const attempts = fill >= 0.7 ? [uniformAlpha, ringAlpha] : [plainAlpha];
  for (const make of attempts) {
    const alpha = make();
    if (!alpha) continue;
    const glyph = await finish(alpha);
    if (glyph) return glyph;
  }
  return null;
};

export const TRACE = Object.freeze({ turdsize: 2, alphamax: 1, opticurve: 1, opttolerance: 0.2, extractcolors: false });
export const SYMBOL_MAX_BYTES = 1536;
export const IOU_MIN = 0.95;
export const THRESHOLD = 128;

const potraceReady = lazyInit(async () => {
  const mod = await import('esm-potrace-wasm');
  await mod.init();
  return mod.potrace;
});

const svgoReady = lazyInit(async () => (await import('svgo/browser')).optimize);

const NUM = /([a-zA-Z])|(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)/gi;

export const parsePath = (d) => {
  const tokens = [];
  for (const m of d.matchAll(NUM)) tokens.push(m[1] ? { c: m[1] } : { n: Number(m[2]) });
  const segs = [];
  let i = 0;
  let cmd = null;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let lastC = null;
  const num = () => tokens[i++].n;
  while (i < tokens.length) {
    if (tokens[i].c) {
      cmd = tokens[i++].c;
      if (cmd === 'z' || cmd === 'Z') {
        segs.push({ t: 'Z' });
        cx = sx;
        cy = sy;
        lastC = null;
        continue;
      }
    }
    const rel = cmd === cmd.toLowerCase();
    const up = cmd.toUpperCase();
    if (up === 'M') {
      const x = num() + (rel ? cx : 0);
      const y = num() + (rel ? cy : 0);
      segs.push({ t: 'M', p: [x, y] });
      cx = sx = x;
      cy = sy = y;
      cmd = rel ? 'l' : 'L';
      lastC = null;
    } else if (up === 'L') {
      const x = num() + (rel ? cx : 0);
      const y = num() + (rel ? cy : 0);
      segs.push({ t: 'L', p: [x, y] });
      cx = x;
      cy = y;
      lastC = null;
    } else if (up === 'H') {
      const x = num() + (rel ? cx : 0);
      segs.push({ t: 'L', p: [x, cy] });
      cx = x;
      lastC = null;
    } else if (up === 'V') {
      const y = num() + (rel ? cy : 0);
      segs.push({ t: 'L', p: [cx, y] });
      cy = y;
      lastC = null;
    } else if (up === 'C') {
      const a = [num() + (rel ? cx : 0), num() + (rel ? cy : 0)];
      const b = [num() + (rel ? cx : 0), num() + (rel ? cy : 0)];
      const e = [num() + (rel ? cx : 0), num() + (rel ? cy : 0)];
      segs.push({ t: 'C', p: [...a, ...b, ...e] });
      lastC = b;
      cx = e[0];
      cy = e[1];
    } else if (up === 'S') {
      const a = lastC ? [2 * cx - lastC[0], 2 * cy - lastC[1]] : [cx, cy];
      const b = [num() + (rel ? cx : 0), num() + (rel ? cy : 0)];
      const e = [num() + (rel ? cx : 0), num() + (rel ? cy : 0)];
      segs.push({ t: 'C', p: [...a, ...b, ...e] });
      lastC = b;
      cx = e[0];
      cy = e[1];
    } else if (up === 'Q') {
      const q = [num() + (rel ? cx : 0), num() + (rel ? cy : 0)];
      const e = [num() + (rel ? cx : 0), num() + (rel ? cy : 0)];
      const a = [cx + (2 / 3) * (q[0] - cx), cy + (2 / 3) * (q[1] - cy)];
      const b = [e[0] + (2 / 3) * (q[0] - e[0]), e[1] + (2 / 3) * (q[1] - e[1])];
      segs.push({ t: 'C', p: [...a, ...b, ...e] });
      cx = e[0];
      cy = e[1];
      lastC = null;
    } else {
      throw new Error('unsupported path command ' + cmd);
    }
  }
  return segs;
};

const fmt = (v, digits = 1) => {
  const scale = 10 ** digits;
  const r = Math.round(v * scale) / scale;
  return Object.is(r, -0) ? '0' : String(r);
};

export const emitPath = (segs, map, digits = 1) => {
  let out = '';
  for (const s of segs) {
    if (s.t === 'Z') out += 'Z';
    else {
      const pts = [];
      for (let k = 0; k < s.p.length; k += 2) {
        const [x, y] = map(s.p[k], s.p[k + 1]);
        pts.push(fmt(x, digits), fmt(y, digits));
      }
      out += s.t + pts.join(' ');
    }
  }
  return out;
};

export const toViewBoxPath = (svg, size, digits = 1) => {
  const t = /translate\(\s*([-\d.]+)[ ,]+([-\d.]+)\s*\)\s*scale\(\s*([-\d.]+)[ ,]+([-\d.]+)\s*\)/.exec(svg);
  const [tx, ty, sx, sy] = t ? [Number(t[1]), Number(t[2]), Number(t[3]), Number(t[4])] : [0, 0, 1, 1];
  const k = 24 / size;
  const ds = [...svg.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1]);
  if (!ds.length) return '';
  return ds.map((d) => emitPath(parsePath(d), (x, y) => [(x * sx + tx) * k, (y * sy + ty) * k], digits)).join('');
};

export const maskOf = (img, threshold = THRESHOLD) => {
  const n = img.width * img.height;
  const mask = new Uint8Array(n);
  for (let p = 0; p < n; p++) mask[p] = img.data[p * 4 + 3] >= threshold ? 1 : 0;
  return mask;
};

export const strokeWidth = (mask, w, h) => {
  let area = 0;
  let edges = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      area++;
      if (x === 0 || !mask[y * w + x - 1]) edges++;
      if (x === w - 1 || !mask[y * w + x + 1]) edges++;
      if (y === 0 || !mask[(y - 1) * w + x]) edges++;
      if (y === h - 1 || !mask[(y + 1) * w + x]) edges++;
    }
  }
  return edges ? (2 * area) / edges : 0;
};

export const iou = (a, b) => {
  let inter = 0;
  let union = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] && b[i]) inter++;
    if (a[i] || b[i]) union++;
  }
  return union ? inter / union : 1;
};

export const symbolMarkup = (key, d) => `<symbol id="g-${key}" viewBox="0 0 24 24"><path d="${d}"/></symbol>`;

export const TRACE_B = Object.freeze({ turdsize: 4, alphamax: 1.2, opticurve: 1, opttolerance: 0.4, extractcolors: false });
export const TRACE_SIZE = 256;
export const IOU_CLEAN = 0.92;
export const CLEAN_MAX_BYTES = 2048;
export const CLEAN_MAX_SUBPATHS = 12;

export const otsuThreshold = (values) => {
  const hist = new Float64Array(256);
  for (const v of values) hist[v]++;
  const total = values.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let wB = 0;
  let sumB = 0;
  let best = -1;
  let level = THRESHOLD;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      level = t;
    }
  }
  return Math.min(192, Math.max(64, level + 1));
};

const dilate = (mask, w, h) => {
  const horizontal = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let v = mask[row + x];
      if (x > 0) v |= mask[row + x - 1];
      if (x < w - 1) v |= mask[row + x + 1];
      horizontal[row + x] = v;
    }
  }
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const i = row + x;
      let v = horizontal[i];
      if (y > 0) v |= horizontal[i - w];
      if (y < h - 1) v |= horizontal[i + w];
      out[i] = v;
    }
  }
  return out;
};

const erode = (mask, w, h) => {
  const horizontal = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let v = mask[row + x];
      if (x > 0) v &= mask[row + x - 1];
      if (x < w - 1) v &= mask[row + x + 1];
      horizontal[row + x] = v;
    }
  }
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const i = row + x;
      let v = horizontal[i];
      if (y > 0) v &= horizontal[i - w];
      if (y < h - 1) v &= horizontal[i + w];
      out[i] = v;
    }
  }
  return out;
};

const subPaths = (d) => (d.match(/M/gi) || []).length;

const upscaledLuma = async (glyph) => {
  const size = TRACE_SIZE;
  const big = glyph.width === size ? glyph : await resizeKernel(glyph, size, size, 'catrom');
  const lum = new Uint8Array(size * size);
  for (let p = 0; p < lum.length; p++) {
    const i = p * 4;
    lum[p] = Math.round(((0.299 * big.data[i] + 0.587 * big.data[i + 1] + 0.114 * big.data[i + 2]) * big.data[i + 3]) / 255);
  }
  return lum;
};

const traceMask = (lum, cleaned, bias) => {
  const size = TRACE_SIZE;
  let mask;
  if (cleaned) {
    const level = Math.min(230, Math.max(25, otsuThreshold(lum) + bias));
    mask = lum.map((v) => (v >= level ? 1 : 0));
    mask = dilate(erode(mask, size, size), size, size);
    mask = erode(dilate(mask, size, size), size, size);
  } else mask = lum.map((v) => (v >= THRESHOLD + bias ? 1 : 0));
  const bw = new Uint8ClampedArray(size * size * 4);
  for (let p = 0; p < mask.length; p++) {
    const v = mask[p] ? 0 : 255;
    bw[p * 4] = v;
    bw[p * 4 + 1] = v;
    bw[p * 4 + 2] = v;
    bw[p * 4 + 3] = 255;
  }
  return new ImageData(bw, size, size);
};

export const traceGlyph = async (glyph, key, { bias = 0 } = {}) => {
  const mask = maskOf(glyph, THRESHOLD + bias);
  const { width: w, height: h } = glyph;
  const luma = await upscaledLuma(glyph);
  const inputs = {};
  const inputOf = (variant) => (inputs[variant] ||= traceMask(luma, variant === 'cleaned', bias));
  const potrace = await potraceReady();
  const optimize = await svgoReady();
  const traced = new Map();
  const tracedWith = async (variant, options) => {
    const id = variant + (options === TRACE ? 'a' : 'b');
    if (!traced.has(id)) traced.set(id, await potrace(inputOf(variant), { ...options }));
    return traced.get(id);
  };
  const candidate = async (variant, options, digits) => {
    const raw = toViewBoxPath(await tracedWith(variant, options), TRACE_SIZE, digits);
    if (!raw) return null;
    const optimised = optimize(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${raw}"/></svg>`, {
      multipass: true,
      plugins: [{ name: 'convertPathData', params: { floatPrecision: digits } }]
    });
    const m = /\sd="([^"]+)"/.exec(optimised.data);
    const d = m ? m[1] : raw;
    const symbol = symbolMarkup(key, d);
    const bytes = utf8(symbol).length;
    const raster = await rasterSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${w}" height="${h}"><path d="${d}"/></svg>`, { width: w });
    const drawn = maskOf(raster);
    return { d, symbol, bytes, iou: iou(mask, drawn), subPaths: subPaths(d), stroke: strokeWidth(drawn, w, h) };
  };
  const better = (a, b) => {
    if (!a) return b;
    if (!b) return a;
    const fitsA = a.bytes <= SYMBOL_MAX_BYTES;
    const fitsB = b.bytes <= SYMBOL_MAX_BYTES;
    if (fitsA !== fitsB) return fitsA ? a : b;
    const ia = Math.round(a.iou * 10000);
    const ib = Math.round(b.iou * 10000);
    if (ia !== ib) return ia > ib ? a : b;
    return b.bytes < a.bytes ? b : a;
  };
  let best = null;
  const order = [];
  for (const digits of [1, 2]) for (const variant of ['cleaned', 'plain']) for (const options of [TRACE, TRACE_B]) order.push([variant, options, digits]);
  for (const [variant, options, digits] of order) {
    best = better(best, await candidate(variant, options, digits));
    if (best && best.iou >= IOU_MIN && best.bytes <= SYMBOL_MAX_BYTES) break;
  }
  if (!best) return { accepted: false, reason: 'empty trace', d: null, symbol: null, bytes: 0, iou: 0 };
  const { d, symbol, bytes, iou: score, stroke } = best;
  if (bytes > SYMBOL_MAX_BYTES) return { accepted: false, reason: 'symbol over ' + SYMBOL_MAX_BYTES + ' bytes', d, symbol, bytes, iou: score, stroke };
  if (score >= IOU_MIN) return { accepted: true, reason: null, d, symbol, bytes, iou: score, stroke };
  if (score >= IOU_CLEAN && d.length < CLEAN_MAX_BYTES && best.subPaths <= CLEAN_MAX_SUBPATHS) return { accepted: true, reason: null, clean: true, d, symbol, bytes, iou: score, stroke };
  return { accepted: false, reason: 'trace IoU below ' + IOU_MIN, d, symbol, bytes, iou: score, stroke };
};
