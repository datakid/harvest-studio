export const SCALE_MIN = 0.5;
export const SCALE_MAX = 0.9;
export const OFFSET_MAX = 0.12;
export const WEIGHT_MIN = -2;
export const WEIGHT_MAX = 2;
export const WEIGHT_STEP = 20;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export const cleanAdjust = (raw) => {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  if (raw.render === 'glyph' || raw.render === 'image') out.render = raw.render;
  const scale = num(raw.scale);
  if (scale !== null) out.scale = Math.round(clamp(scale, SCALE_MIN, SCALE_MAX) * 1000) / 1000;
  const o = raw.offset && typeof raw.offset === 'object' ? raw.offset : null;
  if (o) {
    const x = Math.round(clamp(num(o.x) || 0, -OFFSET_MAX, OFFSET_MAX) * 1000) / 1000;
    const y = Math.round(clamp(num(o.y) || 0, -OFFSET_MAX, OFFSET_MAX) * 1000) / 1000;
    if (x || y) out.offset = { x, y };
  }
  if (raw.background === 'keep' || raw.background === 'remove') out.background = raw.background;
  const weight = num(raw.weight);
  if (weight !== null) {
    const w = Math.round(clamp(weight, WEIGHT_MIN, WEIGHT_MAX));
    if (w) out.weight = w;
  }
  if (typeof raw.twoTone === 'boolean') out.twoTone = raw.twoTone;
  if (raw.invert === true) out.invert = true;
  if (raw.exclude === true) out.exclude = true;
  return out;
};

export const isEmptyAdjust = (a) => Object.keys(cleanAdjust(a)).length === 0;

export const shapesGlyph = (a) => {
  const c = cleanAdjust(a);
  return c.scale !== undefined || c.offset !== undefined || c.twoTone !== undefined || c.invert === true || c.background !== undefined;
};

export const adjustSignature = (a) => JSON.stringify(cleanAdjust(a));

export const adjustMapOf = (raw) => {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const key of Object.keys(raw).sort()) {
    const c = cleanAdjust(raw[key]);
    if (Object.keys(c).length) out[key] = c;
  }
  return out;
};
