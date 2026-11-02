const curve = (c) => {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const LIN = Float64Array.from({ length: 256 }, (_, i) => curve(i));

export const srgbToLin = (c) => (Number.isInteger(c) && c >= 0 && c <= 255 ? LIN[c] : curve(c));

export const linToSrgb = (c) => {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, v)) * 255);
};

export const toOklab = (r, g, b) => {
  const R = srgbToLin(r);
  const G = srgbToLin(g);
  const B = srgbToLin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  ];
};

export const fromOklab = (L, a, b) => {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ];
};

export const oklchHex = (L, C, h) => {
  for (let i = Math.round(C / 0.005); i >= 0; i--) {
    const c = i * 0.005;
    const rgb = fromOklab(L, c * Math.cos(h), c * Math.sin(h));
    if (rgb.every((v) => v >= -1e-4 && v <= 1.0001)) return '#' + rgb.map((v) => linToSrgb(v).toString(16).padStart(2, '0')).join('');
  }
  return '#808080';
};

export const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export const isHex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

export const hexToRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

export const rgbToHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

export const hexToLab = (hex) => {
  const [r, g, b] = hexToRgb(hex);
  return toOklab(r, g, b);
};

export const deltaE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export const hexToLch = (hex) => {
  const [L, a, b] = hexToLab(hex);
  return [L, Math.hypot(a, b), Math.atan2(b, a)];
};

export const lchToHex = (L, C, h) => oklchHex(L, C, h);

export const blendHex = (hex, mix, ratio) => {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r + (mix[0] - r) * ratio, g + (mix[1] - g) * ratio, b + (mix[2] - b) * ratio);
};

export const luminance = (hex) => {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b);
};

export const contrastRatio = (a, b) => {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

export const hueDegrees = (hex) => {
  const [, , h] = hexToLch(hex);
  return ((h * 180) / Math.PI + 360) % 360;
};

export const KMEANS_K = 5;
export const KMEANS_ITERATIONS = 8;
export const COLOUR_GRID = 64;
export const ACCENT_MIN_CHROMA = 0.03;
export const ACCENT_MIN_AREA = 0.005;
export const STRONG_SHARE = 0.03;
export const GRADIENT_MIN_DELTA = 0.08;
export const GRADIENT_MIN_AREA = 0.08;
export const SYNTHETIC_SHIFT = 0.06;
export const SYNTHETIC_CHROMA = 0.9;

const gridPoints = (data, w, h) => {
  const grid = Math.max(1, Math.min(COLOUR_GRID, w, h));
  const points = [];
  for (let gy = 0; gy < grid; gy++) {
    const y0 = Math.floor((gy * h) / grid);
    const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * h) / grid));
    for (let gx = 0; gx < grid; gx++) {
      const x0 = Math.floor((gx * w) / grid);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * w) / grid));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * w + x) * 4;
          const al = data[i + 3];
          r += data[i] * al;
          g += data[i + 1] * al;
          b += data[i + 2] * al;
          a += al;
          count++;
        }
      }
      const weight = a / (count * 255);
      if (weight < 0.5) continue;
      const [L, A, B] = toOklab(r / a, g / a, b / a);
      points.push({ L, a: A, b: B, w: weight, edge: gx < 2 || gy < 2 || gx >= grid - 2 || gy >= grid - 2 });
    }
  }
  return points;
};

const labDistance = (p, c) => Math.hypot(p.L - c.L, p.a - c.a, p.b - c.b);

const seedCentres = (points, k) => {
  let first = 0;
  for (let i = 1; i < points.length; i++) if (points[i].w > points[first].w) first = i;
  const centres = [{ L: points[first].L, a: points[first].a, b: points[first].b }];
  const near = points.map((p) => labDistance(p, centres[0]));
  while (centres.length < k) {
    let pick = -1;
    let far = 1e-6;
    for (let i = 0; i < points.length; i++) {
      if (near[i] > far) {
        far = near[i];
        pick = i;
      }
    }
    if (pick < 0) break;
    const c = { L: points[pick].L, a: points[pick].a, b: points[pick].b };
    centres.push(c);
    for (let i = 0; i < points.length; i++) near[i] = Math.min(near[i], labDistance(points[i], c));
  }
  return centres;
};

export const clusterColours = (points, k = KMEANS_K, iterations = KMEANS_ITERATIONS) => {
  if (!points.length) return [];
  const centres = seedCentres(points, k);
  const owner = new Int16Array(points.length);
  for (let it = 0; it < iterations; it++) {
    const sums = centres.map(() => ({ w: 0, L: 0, a: 0, b: 0 }));
    for (let i = 0; i < points.length; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < centres.length; c++) {
        const d = labDistance(points[i], centres[c]);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      owner[i] = best;
      const s = sums[best];
      s.w += points[i].w;
      s.L += points[i].L * points[i].w;
      s.a += points[i].a * points[i].w;
      s.b += points[i].b * points[i].w;
    }
    for (let c = 0; c < centres.length; c++) {
      if (sums[c].w) centres[c] = { L: sums[c].L / sums[c].w, a: sums[c].a / sums[c].w, b: sums[c].b / sums[c].w };
    }
  }
  const total = points.reduce((n, p) => n + p.w, 0);
  const stats = centres.map((c) => ({ ...c, w: 0, edge: 0 }));
  for (let i = 0; i < points.length; i++) {
    stats[owner[i]].w += points[i].w;
    if (points[i].edge) stats[owner[i]].edge += points[i].w;
  }
  return stats
    .filter((s) => s.w > 0)
    .map((s) => ({ L: s.L, a: s.a, b: s.b, chroma: Math.hypot(s.a, s.b), area: s.w / total, edge: s.edge / s.w }));
};

export const clusterScore = (c) => {
  let score = c.area ** 0.6 * c.chroma ** 1.2;
  if (c.L > 0.95 || c.L < 0.12) score *= 0.2;
  if (c.edge > 0.25) score *= 0.4;
  return score;
};

const clusterHex = (c) => '#' + fromOklab(c.L, c.a, c.b).map((v) => linToSrgb(Math.min(1, Math.max(0, v))).toString(16).padStart(2, '0')).join('');

export const extractColours = (data, w, h) => {
  const clusters = clusterColours(gridPoints(data, w, h));
  const ranked = clusters
    .filter((c) => c.chroma > ACCENT_MIN_CHROMA && c.area >= ACCENT_MIN_AREA)
    .map((c) => ({ ...c, score: clusterScore(c) }))
    .sort((x, y) => y.score - x.score || x.L - y.L);
  if (!ranked.length) return null;
  const accent = ranked[0];
  const second = ranked
    .slice(1)
    .filter((c) => c.L >= 0.12 && c.L <= 0.95 && c.area >= GRADIENT_MIN_AREA && labDistance(c, accent) > GRADIENT_MIN_DELTA)[0];
  let stops;
  let synthetic = false;
  if (second) stops = [accent, second].sort((x, y) => x.L - y.L).map(clusterHex);
  else {
    const hue = Math.atan2(accent.b, accent.a);
    const chroma = accent.chroma * SYNTHETIC_CHROMA;
    stops = [oklchHex(accent.L - SYNTHETIC_SHIFT, chroma, hue), oklchHex(accent.L + SYNTHETIC_SHIFT, chroma, hue)];
    synthetic = true;
  }
  return { accent: clusterHex(accent), gradient: stops, synthetic, share: accent.area, chroma: accent.chroma };
};

export const tintFromOklch = (c, h) => [oklchHex(0.66, c, h), oklchHex(0.86, Math.min(c * 0.75, 0.11), h), oklchHex(0.38, Math.min(c, 0.12), h)];

export const tintFromHex = (hex) => {
  const [, C, h] = hexToLch(hex);
  const c = Math.min(Math.max(C, 0.06), 0.16);
  return tintFromOklch(c, h);
};

export const imageToLab = (data, n) => {
  const lab = new Float32Array(n * 3);
  for (let p = 0; p < n; p++) {
    const [L, a, b] = toOklab(data[p * 4], data[p * 4 + 1], data[p * 4 + 2]);
    lab[p * 3] = L;
    lab[p * 3 + 1] = a;
    lab[p * 3 + 2] = b;
  }
  return lab;
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const GLYPH_INK = '#fafafa';

export const launcherTile = (c1, theme) => {
  const [L, C, h] = hexToLch(c1);
  const tile = theme === 'light' ? oklchHex(clamp(L, 0.52, 0.64), clamp(C, 0.09, 0.17), h) : oklchHex(clamp(L, 0.62, 0.72), clamp(C, 0.07, 0.14), h);
  return tile;
};

export const tileContrast = (c1, theme) => contrastRatio(GLYPH_INK, launcherTile(c1, theme));

export const MIN_CONTRAST = 3;
export const NUDGE_STEP = 0.02;
export const NUDGE_MAX = 0.12;

export const passesContrast = (tint) => !tint || !tint[0] || ['light', 'dark'].every((t) => tileContrast(tint[0], t) >= MIN_CONTRAST);

export const nudgeForContrast = (tint) => {
  if (!tint || !tint[0]) return { tint, status: 'none', steps: 0 };
  if (passesContrast(tint)) return { tint, status: 'ok', steps: 0 };
  const lch = tint.map(hexToLch);
  for (let step = 1; step <= Math.round(NUDGE_MAX / NUDGE_STEP); step++) {
    const dl = -step * NUDGE_STEP;
    const next = lch.map(([L, C, h]) => oklchHex(clamp(L + dl, 0.15, 0.95), C, h));
    if (passesContrast(next)) return { tint: next, status: 'nudged', steps: step };
  }
  return { tint, status: 'flagged', steps: 0 };
};
