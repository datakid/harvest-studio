import { hexToLch, oklchHex, isHex } from './color.js';

const TAU = Math.PI * 2;

export const PRESETS = [
  { id: 'sunset', colors: ['#ffb347', '#ff7a59', '#f0475c', '#b4417a', '#6a3fa0'] },
  { id: 'ocean', colors: ['#5fd4e0', '#2fa8c9', '#4c7df0', '#3b56c9', '#6a4fd0'] },
  { id: 'forest', colors: ['#a8d672', '#5fc47a', '#2fa882', '#2b8a6e', '#c9b44a'] },
  { id: 'candy', colors: ['#ff7eb6', '#ffb86b', '#ffe36b', '#6be3b0', '#7bb8ff', '#b58bff'] },
  { id: 'earth', colors: ['#c9784a', '#a85c3a', '#d8a657', '#7a8f4a', '#6b5a4a'] }
];

export const HARMONIES = ['analogous', 'complementary', 'triad', 'split', 'tetrad', 'shades'];

const STEPS = {
  analogous: [-60, -30, 0, 30, 60],
  complementary: [0, 30, 180, 210],
  triad: [0, 120, 240],
  split: [0, 150, 210],
  tetrad: [0, 90, 180, 270]
};

export const harmony = (baseHex, kind) => {
  if (!isHex(baseHex)) return [];
  const [L, C, h] = hexToLch(baseHex);
  const chroma = Math.max(C, 0.1);
  if (kind === 'shades') {
    return [-0.14, -0.07, 0, 0.07, 0.14].map((dl) => oklchHex(Math.min(0.9, Math.max(0.35, L + dl)), chroma, h));
  }
  const steps = STEPS[kind] || STEPS.analogous;
  return steps.map((deg) => oklchHex(L, chroma, h + (deg * Math.PI) / 180 + TAU));
};

export const cleanPalette = (colors) => {
  const seen = new Set();
  const out = [];
  for (const c of Array.isArray(colors) ? colors : []) {
    const hex = String(c).toLowerCase();
    if (isHex(hex) && !seen.has(hex)) {
      seen.add(hex);
      out.push(hex);
    }
  }
  return out.slice(0, 12);
};
