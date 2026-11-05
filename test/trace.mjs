import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { check, finish, fixtureTargets, localIo, fixturesDir, NOW } from './util.mjs';
import { runHarvest, normalize, analyzeIcon, traceGlyph, otsuThreshold, encodeMaskAtlas, makeImage, IOU_CLEAN, IOU_MIN } from '../core/index.js';

const run = await runHarvest({ targets: await fixtureTargets(), overrides: {} }, { profile: 'launcher', mode: 'follow', now: NOW, local: true }, localIo());
const items = run.report.items;
const SIX = ['ledger-form--folio', 'protocols', 'roi--full', 'qisma-mizan--full', 'plan-maker--full', 'criteria-builder--meridian'];

await check('T3.4a at most two of the six listed icons stay raster', () => {
  const raster = SIX.filter((k) => items.find((i) => i.key === k).glyph !== 'symbol');
  assert.ok(raster.length <= 2, raster.join(', '));
});

await check('T3.4a no accepted trace has an IoU under 0.92 and every accepted trace under 0.95 is a clean shape', () => {
  const traces = items.filter((i) => i.trace && i.trace.accepted);
  assert.ok(traces.length >= 28);
  for (const i of traces) {
    assert.ok(i.trace.iou >= IOU_CLEAN, i.key + ' ' + i.trace.iou);
    if (i.trace.iou < IOU_MIN) assert.equal(i.trace.clean, true, i.key);
  }
});

await check('T3.4b the glyph atlas is at most 9216 bytes', () => {
  assert.ok(run.report.atlas.glyphAtlasBytes <= 9216, String(run.report.atlas.glyphAtlasBytes));
  const file = Object.keys(run.export.files).find((f) => /^glyph-atlas\./.test(f));
  assert.ok(file);
  assert.equal(run.export.files[file].length, run.report.atlas.glyphAtlasBytes);
});

const glyphs = [];
for (const key of ['ledger-form--folio', 'roi--full', 'plan-maker--full', 'criteria-builder--meridian', 'text-tools--weft', 'dafter']) {
  const { img } = await normalize(new Uint8Array(await fs.readFile(path.join(fixturesDir, key + '.png'))), 'png');
  const analysis = await analyzeIcon(img);
  if (analysis.glyph) glyphs.push([key, analysis.glyph]);
}

await check('T3.4c tracing is deterministic: two runs give the same path strings', async () => {
  assert.ok(glyphs.length >= 5);
  for (const [key, glyph] of glyphs) {
    const a = await traceGlyph(glyph, key);
    const b = await traceGlyph(glyph, key);
    assert.equal(a.d, b.d, key);
    assert.equal(a.iou, b.iou, key);
    assert.equal(a.accepted, b.accepted, key);
  }
});

await check('T3.4c the shipped sprite is identical across two harvests', async () => {
  const again = await runHarvest({ targets: await fixtureTargets(), overrides: {} }, { profile: 'launcher', mode: 'follow', now: NOW, local: true }, localIo());
  assert.deepEqual(Object.keys(again.export.files).sort(), Object.keys(run.export.files).sort());
  for (const name of Object.keys(run.export.files)) assert.deepEqual(again.export.files[name], run.export.files[name], name);
});

await check('Otsu finds the gap between two clusters of values', () => {
  const values = new Uint8Array(1000);
  for (let i = 0; i < 1000; i++) values[i] = i < 500 ? 30 + (i % 20) : 200 + (i % 20);
  const level = otsuThreshold(values);
  assert.ok(level > 49 && level <= 200, String(level));
});

await check('a mask atlas that is too big for lossless falls back to lossy alpha', async () => {
  const img = makeImage(256, 256);
  let seed = 0x9e3779b9;
  for (let i = 0; i < img.data.length; i += 4) {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    img.data[i + 3] = ((t ^ (t >>> 14)) >>> 0) & 255;
  }
  const noisy = await encodeMaskAtlas(img);
  assert.equal(noisy.mode, 'lossy-alpha-q70');
  const plain = makeImage(256, 256);
  for (let y = 40; y < 200; y++) for (let x = 60; x < 190; x++) plain.data[(y * 256 + x) * 4 + 3] = 255;
  assert.equal((await encodeMaskAtlas(plain)).mode, 'lossless');
});

const dotted = (every) => {
  const g = makeImage(128, 128);
  const set = (x, y) => {
    const i = (y * 128 + x) * 4;
    g.data[i] = g.data[i + 1] = g.data[i + 2] = g.data[i + 3] = 255;
  };
  for (let y = 24; y < 104; y++) for (let x = 24; x < 104; x++) if (x < 32 || x >= 96 || y < 32 || y >= 96) set(x, y);
  for (let y = 36; y < 92; y += every) for (let x = 36; x < 92; x += every) set(x, y);
  return g;
};

await check('a clean shape between 0.92 and 0.95 is accepted and marked clean', async () => {
  const t = await traceGlyph(dotted(5), 'frame');
  assert.ok(t.iou >= IOU_CLEAN && t.iou < IOU_MIN, String(t.iou));
  assert.equal(t.accepted, true);
  assert.equal(t.clean, true);
  assert.ok(t.d.length < 2048 && (t.d.match(/M/g) || []).length <= 12);
});

await check('a trace under 0.92 is rejected and one over 0.95 is accepted without the clean mark', async () => {
  const low = await traceGlyph(dotted(3), 'frame');
  assert.ok(low.iou < IOU_CLEAN, String(low.iou));
  assert.equal(low.accepted, false);
  const high = await traceGlyph(dotted(7), 'frame');
  assert.ok(high.iou >= IOU_MIN);
  assert.equal(high.accepted, true);
  assert.equal(high.clean, undefined);
});

finish();
