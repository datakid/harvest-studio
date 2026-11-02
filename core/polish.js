import { roundCorners } from './pixels.js';
import { alphaBounds, alphaCentroid, GLYPH_SIZE, SAFE_TARGET, SAFE_TOLERANCE, CENTRE_TOLERANCE } from './glyph.js';
import { similarPairs } from './tints.js';

const ratio = (n, d) => (d ? Math.round((n / d) * 1000) / 1000 : 1);

export const glyphInSafeArea = (glyph) => {
  const b = alphaBounds(glyph);
  if (!b) return false;
  const fill = Math.max(b.width, b.height) / GLYPH_SIZE;
  const [cx, cy] = alphaCentroid(glyph);
  const off = Math.max(Math.abs(cx - GLYPH_SIZE / 2), Math.abs(cy - GLYPH_SIZE / 2)) / GLYPH_SIZE;
  return Math.abs(fill - SAFE_TARGET) <= SAFE_TOLERANCE && off <= CENTRE_TOLERANCE;
};

export const cornersRounded = (img) => {
  const out = roundCorners(img);
  const { width: w, height: h } = out;
  for (const [ox, oy] of [[0, 0], [w - 3, 0], [0, h - 3], [w - 3, h - 3]]) {
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) if (out.data[((oy + y) * w + ox + x) * 4 + 3] > 8) return false;
  }
  return true;
};

export const polishReport = ({ records, groupOf, strokeRetraced = [], contrastFlagged = [] }) => {
  const tiles = records.filter((r) => r.image);
  const glyphTiles = tiles.filter((r) => r.glyphImage);
  const safe = glyphTiles.filter((r) => glyphInSafeArea(r.glyphImage)).length;
  const rounded = tiles.filter((r) => cornersRounded(r.image)).length;
  const raster = glyphTiles.filter((r) => !(r.trace && r.trace.accepted)).length;
  const pairs = similarPairs(tiles.filter((r) => r.tint).map((r) => ({ key: r.key, tint: r.tint })), groupOf);
  return {
    tiles: tiles.length,
    glyphTiles: glyphTiles.length,
    safeArea: ratio(safe, glyphTiles.length),
    rounded: ratio(rounded, tiles.length),
    similarPairs: pairs.length,
    rasterFallbacks: raster,
    contrastFlags: contrastFlagged.length,
    strokeRetraced: [...strokeRetraced].sort()
  };
};
