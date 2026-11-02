import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { check, finish, NOW, localIo, studioDir } from './util.mjs';
import { runHarvest, encodePng, normalize, analyzeIcon, makeImage, hexToLab, hexToLch, deltaE, hexToRgb, tintFromHex, buildTargets, similarPairs, SEPARATE_DELTA, applyMode } from '../core/index.js';

const enc = (s) => new TextEncoder().encode(s);

const paint = (size, draw, background = null) => {
  const img = makeImage(size, size);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const rgb = draw(Math.hypot(x - c, y - c), x, y) || background;
      if (!rgb) continue;
      const i = (y * size + x) * 4;
      img.data[i] = rgb[0];
      img.data[i + 1] = rgb[1];
      img.data[i + 2] = rgb[2];
      img.data[i + 3] = 255;
    }
  }
  return img;
};

const RED = '#d43b3b';
const ORANGE = '#f08a24';
const GREEN = '#2e9e5b';
const VIOLET = '#6c58d4';
const LAVENDER = '#b9aee6';

const flatRed = paint(180, (r) => (r <= 50 ? hexToRgb(RED) : null));
const ring = paint(180, (r) => (r <= 56 && r >= 38 ? hexToRgb(ORANGE) : null), [255, 255, 255]);
const outlined = paint(180, (r) => (r <= 56 && r >= 46 ? [10, 10, 10] : r < 46 ? hexToRgb(GREEN) : null));
const greyOnly = paint(180, (r) => (r <= 50 ? [120, 120, 124] : r <= 60 ? [60, 60, 64] : null));
const violetSvg = enc('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M12 52 L32 12" stroke="#6c58d4" stroke-width="9" stroke-linecap="round" fill="none"/><path d="M30 52 L52 12" stroke="#b9aee6" stroke-width="9" stroke-linecap="round" fill="none"/></svg>');

const analyse = async (bytes, ext) => analyzeIcon((await normalize(bytes, ext)).img);
const near = (hex, want, limit = 0.03) => {
  const d = deltaE(hexToLab(hex), hexToLab(want));
  assert.ok(d <= limit, hex + ' is ' + d.toFixed(3) + ' from ' + want);
};

await check('T4.1 a single flat red mark gives that red', async () => {
  const a = await analyse(await encodePng(flatRed), 'png');
  near(a.colour.accent, RED);
});

await check('T4.1 a two-colour violet svg gives the stronger violet as the accent', async () => {
  const a = await analyse(violetSvg, 'svg');
  near(a.colour.accent, VIOLET);
});

await check('T4.1 an orange ring on a white square gives the orange', async () => {
  const a = await analyse(await encodePng(ring), 'png');
  near(a.colour.accent, ORANGE);
});

await check('T4.1 a black outline around a green fill does not win', async () => {
  const a = await analyse(await encodePng(outlined), 'png');
  near(a.colour.accent, GREEN);
});

await check('T4.1 a grey-only icon has no accent and falls back to the catalogue gradient', async () => {
  const bytes = await encodePng(greyOnly);
  const a = await analyse(bytes, 'png');
  assert.equal(a.colour, null);
  const catalogueTint = ['#5e8df0', '#7dd3fc', '#075985'];
  const io = { fetchBytes: async () => ({ ok: false, status: 404, bytes: new Uint8Array() }), readLocal: async () => null, readOverride: async () => null, readOutput: async () => null };
  const r = await runHarvest({ targets: [{ key: 'grey', appId: 'grey', variantId: null, url: null, bytes, fileName: 'grey.png', catalogueTint }], overrides: {} }, { profile: 'launcher', mode: 'follow', now: NOW, preview: true }, io);
  assert.equal(r.records[0].tintSource, 'catalogue');
  assert.deepEqual(r.records[0].tint, catalogueTint);
});

await check('T4.2 the violet svg gradient is #6c58d4 to #b9aee6, darker first', async () => {
  const a = await analyse(violetSvg, 'svg');
  assert.equal(a.colour.synthetic, false);
  near(a.colour.gradient[0], VIOLET);
  near(a.colour.gradient[1], LAVENDER);
});

await check('T4.2 a single-colour icon gets a synthetic gradient of the same hue, darker first', async () => {
  const a = await analyse(await encodePng(flatRed), 'png');
  assert.equal(a.colour.synthetic, true);
  const [dark, light] = a.colour.gradient.map(hexToLab);
  assert.ok(dark[0] < light[0]);
  assert.ok(Math.abs(light[0] - dark[0] - 0.12) < 0.03);
});

await check('the tint follows the accent', async () => {
  const a = await analyse(await encodePng(flatRed), 'png');
  assert.deepEqual(a.gradient, tintFromHex(a.colour.accent));
});

const catalogue = JSON.parse(await fs.readFile(path.join(studioDir, 'config', 'catalogue.json'), 'utf8'));
const targets = buildTargets(catalogue);
const groupOf = new Map(targets.map((t) => [t.key, t.groupId]));
const separate = (extra = {}, io = localIo()) => runHarvest({ targets, overrides: {} }, { profile: 'launcher', mode: 'separate', now: NOW, local: true, seed: 'a1b2c3d4', preview: true, ...extra }, io);
const hueGap = (a, b) => {
  const d = Math.abs(a - b) % (Math.PI * 2);
  return (Math.min(d, Math.PI * 2 - d) * 180) / Math.PI;
};

const first = await separate();

await check('T4.3 in separate mode no pair inside a group has a ΔE under 0.06', () => {
  const tints = first.records.map((r) => ({ key: r.key, tint: r.tint }));
  assert.equal(tints.length, 34);
  assert.deepEqual(similarPairs(tints, groupOf, SEPARATE_DELTA), []);
  assert.deepEqual(first.report.colour.tightGroups, []);
});

await check('T4.3 every tint stays within 25 degrees of hue, 15% of chroma and 0.05 of lightness of its source', () => {
  let moved = 0;
  for (const r of first.records) {
    const src = hexToLch((r.sourceTint || r.tint)[0]);
    const now = hexToLch(r.tint[0]);
    if (r.sourceTint) moved++;
    assert.ok(hueGap(src[2], now[2]) <= 25.5, r.key + ' hue');
    assert.ok(Math.abs(now[1] / src[1] - 1) <= 0.15 + 1e-9, r.key + ' chroma');
    assert.ok(Math.abs(now[0] - src[0]) <= 0.05 + 1e-9, r.key + ' lightness');
  }
  assert.ok(moved >= 10, String(moved));
});

await check('T4.3 locked tints are untouched and act as fixed points', async () => {
  const base = await runHarvest({ targets, overrides: {} }, { profile: 'launcher', mode: 'separate', now: NOW, local: true, seed: 'a1b2c3d4' }, localIo());
  const files = new Map(Object.entries(base.export.files));
  const manifest = JSON.parse(Buffer.from(files.get('manifest.v2.json')).toString('utf8'));
  const victim = first.records.find((r) => r.key === 'dafter');
  const neighbour = first.records.find((r) => r.key !== 'dafter' && groupOf.get(r.key) === groupOf.get('dafter'));
  const pinned = tintFromHex(neighbour.tint[0]);
  manifest.icons.dafter.tint = pinned;
  manifest.icons.dafter.locked = true;
  files.set('manifest.v2.json', new TextEncoder().encode(JSON.stringify(manifest)));
  const again = await runHarvest({ targets, overrides: {} }, { profile: 'launcher', mode: 'separate', now: NOW, local: true, seed: 'a1b2c3d4', preview: true }, localIo({ readOutput: async (name) => files.get(name) || null }));
  const rec = again.records.find((r) => r.key === 'dafter');
  assert.deepEqual(rec.tint, pinned);
  assert.equal(rec.locked, true);
  assert.notDeepEqual(rec.tint, victim.tint);
  const group = again.records.filter((r) => groupOf.get(r.key) === groupOf.get('dafter'));
  assert.deepEqual(similarPairs(group.map((r) => ({ key: r.key, tint: r.tint })), groupOf, SEPARATE_DELTA), []);
});

await check('T4.4 the same seed gives the same output across two runs', async () => {
  const again = await separate();
  assert.deepEqual(again.records.map((r) => [r.key, r.tint, r.sourceTint || null]), first.records.map((r) => [r.key, r.tint, r.sourceTint || null]));
});

await check('the launcher default is separate within each tab', async () => {
  const r = await runHarvest({ targets, overrides: {} }, { profile: 'launcher', now: NOW, local: true, seed: 'a1b2c3d4', preview: true }, localIo());
  assert.equal(r.report.colour.mode, 'separate');
  assert.deepEqual(similarPairs(r.records.map((x) => ({ key: x.key, tint: x.tint })), groupOf, SEPARATE_DELTA), []);
});

await check('the notes terracotta cluster comes out distinct in separate mode', () => {
  const hexes = ['#d27556', '#d47354', '#d47452', '#cb7a5b'];
  const entries = Object.fromEntries(hexes.map((h, i) => ['t' + i, { tint: tintFromHex(h), locked: false }]));
  const appOf = new Map(hexes.map((_, i) => ['t' + i, 'app' + i]));
  const groupOfCluster = new Map(hexes.map((_, i) => ['t' + i, 'core']));
  const before = similarPairs(Object.entries(entries).map(([key, e]) => ({ key, tint: e.tint })), groupOfCluster, SEPARATE_DELTA);
  assert.ok(before.length >= 4, String(before.length));
  const res = applyMode(entries, appOf, { mode: 'separate', seed: 'a1b2c3d4', groupOf: groupOfCluster });
  assert.deepEqual(res.tight, []);
  assert.deepEqual(similarPairs(Object.entries(entries).map(([key, e]) => ({ key, tint: e.tint })), groupOfCluster, SEPARATE_DELTA), []);
});

finish();
