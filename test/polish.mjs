import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { check, finish, NOW, localIo, studioDir } from './util.mjs';
import { runHarvest, buildTargets, makeImage, traceGlyph, strokeWidth, maskOf, glyphInSafeArea, cornersRounded, alphaBounds, alphaCentroid, polishReport, STROKE_OUTLIER } from '../core/index.js';

const catalogue = JSON.parse(await fs.readFile(path.join(studioDir, 'config', 'catalogue.json'), 'utf8'));
const targets = buildTargets(catalogue);
const run = await runHarvest({ targets, overrides: {} }, { profile: 'launcher', now: NOW, local: true, seed: 'a1b2c3d4' }, localIo());
const polish = run.report.polish;

await check('T4.5 the report carries a polish score and the safe area, rounding and pairs meet the targets', () => {
  assert.equal(polish.tiles, 34);
  assert.ok(polish.safeArea >= 0.95, String(polish.safeArea));
  assert.equal(polish.rounded, 1);
  assert.equal(polish.similarPairs, 0);
  assert.equal(run.report.colour.mode, 'separate');
  for (const k of ['glyphTiles', 'rasterFallbacks', 'contrastFlags', 'strokeRetraced']) assert.ok(k in polish, k);
  assert.ok(polish.rasterFallbacks <= 2);
  assert.equal(polish.contrastFlags, 0);
});

await check('T4.5 every glyph fills 72 percent of its cell and sits on the cell centre', () => {
  const glyphs = run.records.filter((r) => r.glyphImage);
  assert.ok(glyphs.length >= 30);
  for (const r of glyphs) {
    const b = alphaBounds(r.glyphImage);
    assert.ok(Math.abs(Math.max(b.width, b.height) / 128 - 0.72) <= 0.04, r.key);
    const [cx, cy] = alphaCentroid(r.glyphImage);
    assert.ok(Math.abs(cx - 64) / 128 <= 0.03 && Math.abs(cy - 64) / 128 <= 0.03, r.key);
  }
});

await check('the safe-area test rejects marks that are too big, too small or off centre', () => {
  const mark = (x0, y0, size) => {
    const g = makeImage(128, 128);
    for (let y = y0; y < y0 + size; y++) for (let x = x0; x < x0 + size; x++) g.data[(y * 128 + x) * 4 + 3] = 255;
    return g;
  };
  assert.equal(glyphInSafeArea(mark(18, 18, 92)), true);
  assert.equal(glyphInSafeArea(mark(4, 4, 120)), false);
  assert.equal(glyphInSafeArea(mark(40, 40, 48)), false);
  assert.equal(glyphInSafeArea(mark(30, 18, 92)), false);
});

await check('cornersRounded accepts any image because the atlas masks the corners', () => {
  const img = makeImage(192, 192);
  img.data.fill(255);
  assert.equal(cornersRounded(img), true);
});

const ring = (soft) => {
  const g = makeImage(128, 128);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const r = Math.hypot(x - 63.5, y - 63.5);
      const edge = Math.min(r - 30, 46 - r);
      const a = Math.max(0, Math.min(1, 0.5 + edge / soft));
      const i = (y * 128 + x) * 4;
      g.data[i] = g.data[i + 1] = g.data[i + 2] = 255;
      g.data[i + 3] = Math.round(a * 255);
    }
  }
  return g;
};

await check('a heavier threshold traces a thinner stroke and a lighter one a thicker stroke', async () => {
  const g = ring(10);
  const mid = await traceGlyph(g, 'ring');
  const thin = await traceGlyph(g, 'ring', { bias: 40 });
  const thick = await traceGlyph(g, 'ring', { bias: -40 });
  assert.ok(thin.stroke < mid.stroke, thin.stroke + ' ' + mid.stroke);
  assert.ok(thick.stroke > mid.stroke, thick.stroke + ' ' + mid.stroke);
  assert.ok(Math.abs(strokeWidth(maskOf(g), 128, 128) - mid.stroke) < 1.5);
});

await check('every re-traced glyph moved closer to the set median and is marked', () => {
  const widths = run.report.items.filter((i) => i.trace && i.trace.accepted && i.trace.stroke).map((i) => i.trace.stroke).sort((a, b) => a - b);
  const median = widths[Math.floor(widths.length / 2)];
  assert.ok(median > 0);
  const marked = run.report.items.filter((i) => i.trace && i.trace.retraced).map((i) => i.key).sort();
  assert.deepEqual(marked, polish.strokeRetraced);
  assert.ok(marked.length >= 1);
  for (const k of marked) {
    const t = run.report.items.find((i) => i.key === k).trace;
    assert.ok(Math.abs(Math.log(t.stroke / median)) < Math.abs(Math.log(t.strokeWas / median)), k + ' ' + t.strokeWas + ' to ' + t.stroke);
    assert.ok(t.strokeWas / median > STROKE_OUTLIER || t.strokeWas / median < 1 / STROKE_OUTLIER, k);
  }
});

await check('polishReport counts raster fallbacks, contrast flags and similar pairs', () => {
  const a = { key: 'a', image: makeImage(192, 192), glyphImage: makeImage(128, 128), tint: ['#336699', '#ffffff', '#000000'], trace: null };
  const b = { key: 'b', image: makeImage(192, 192), glyphImage: null, tint: ['#336699', '#ffffff', '#000000'], trace: null };
  const r = polishReport({ records: [a, b], groupOf: new Map([['a', 'g'], ['b', 'g']]), contrastFlagged: ['a'] });
  assert.equal(r.similarPairs, 1);
  assert.equal(r.rasterFallbacks, 1);
  assert.equal(r.contrastFlags, 1);
  assert.equal(r.glyphTiles, 1);
});

finish();
