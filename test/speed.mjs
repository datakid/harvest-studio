import assert from 'node:assert/strict';
import { check, finish, fixtureTargets, localIo, NOW } from './util.mjs';
import { runHarvest, encodeAtlas, packAtlas, srgbToLin, ATLAS_LIMIT } from '../core/index.js';

const targets = await fixtureTargets();
const full = await runHarvest({ targets, overrides: {} }, { profile: 'launcher', local: true, now: NOW }, localIo());
const preview = await runHarvest({ targets, overrides: {} }, { profile: 'launcher', local: true, now: NOW, preview: true }, localIo());
const icons = full.records.filter((r) => r.image);
const atlasOf = (list) => packAtlas(list.map((r) => ({ key: r.key, image: r.image })), 128);

await check('a preview harvest returns the same records without building the export', () => {
  assert.deepEqual(preview.records.map((r) => [r.key, r.status, r.tint]), full.records.map((r) => [r.key, r.status, r.tint]));
  assert.deepEqual(Object.keys(preview.export.files), ['harvest-report.json']);
  assert.equal(preview.report.gate, null);
  assert.equal(preview.report.items.length, full.report.items.length);
  assert.ok(full.report.gate.ok);
});

await check('a small set stays lossless', async () => {
  const pack = await atlasOf(icons.slice(0, 4));
  const enc = await encodeAtlas(pack.image);
  assert.equal(enc.mode, 'lossless');
  assert.ok(enc.fits);
});

await check('the full catalogue falls back to lossy, fits the budget, and encodes quickly', async () => {
  const pack = await atlasOf(icons);
  const start = performance.now();
  const enc = await encodeAtlas(pack.image);
  const took = performance.now() - start;
  assert.match(enc.mode, /^lossy-q/);
  assert.ok(enc.fits && enc.bytes.length <= ATLAS_LIMIT);
  assert.ok(took < 3000, String(Math.round(took)));
});

await check('the colour lookup table matches the formula', () => {
  for (let c = 0; c < 256; c++) {
    const v = c / 255;
    const expected = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    assert.equal(srgbToLin(c), expected);
  }
  assert.equal(srgbToLin(127.5), ((127.5 / 255 + 0.055) / 1.055) ** 2.4);
});

finish();
