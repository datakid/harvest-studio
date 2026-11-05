import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { check, finish, fixtureTargets, localIo, fixturesDir, studioDir, NOW } from './util.mjs';
import { runHarvest, buildTargets, analyzeIcon, traceGlyphAuto, makeImage, decodeImage, alphaBounds, v4Violations, tintV4, MID_ALPHA, GLYPH_V4_SIZE, LAYERED_MAX_BYTES, glyphStats } from '../core/index.js';

const require = createRequire(import.meta.url);
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(JSON.parse(await fs.readFile(path.join(studioDir, 'config', 'manifest.v2.schema.json'), 'utf8')));

const targets = await fixtureTargets();
const go = (extra = {}) => runHarvest({ targets, overrides: {} }, { profile: 'launcher', local: true, now: NOW, seed: '0a1b2c3d', ...extra }, localIo());

const catalogue = JSON.parse(await fs.readFile(path.join(studioDir, 'config', 'catalogue.json'), 'utf8'));
const v3 = await go();
const v4 = await go({ target: 'v4' });
const legacy = await go({ target: 'v4', profile: 'legacy-v1' });
const EDGE = (GLYPH_V4_SIZE - 124) / 2 / GLYPH_V4_SIZE;

await check('T9.1 the default target adds no v4 fields and no target to the report', () => {
  for (const e of Object.values(v3.export.manifest.icons)) for (const k of ['ink', 'bbox', 'layers', 'tintRole']) assert.ok(!(k in e), k);
  assert.ok(!('target' in v3.report));
  assert.ok(v3.records.every((r) => !r.glyphImage || r.glyphImage.width !== GLYPH_V4_SIZE));
});

await check('T9.2 the v4 manifest validates against the schema and carries ink, bbox, layers and tintRole on every glyph', () => {
  assert.ok(validate(v4.export.manifest), JSON.stringify(validate.errors && validate.errors.slice(0, 3)));
  assert.equal(v4.report.target, 'v4');
  for (const [key, e] of Object.entries(v4.export.manifest.icons)) {
    assert.ok(e.ink > 0 && e.ink < 1, key);
    assert.equal(e.bbox.length, 4, key);
    assert.ok(e.layers === 1 || e.layers === 2, key);
    if (e.tint) assert.ok(e.tintRole === 'brand' || e.tintRole === 'authored', key);
    else assert.ok(!('tintRole' in e), key);
  }
});

await check('T9.3 every v4 mark sits inside the central 124 px box of a 192 px canvas', () => {
  const glyphs = v4.records.filter((r) => r.glyphImage);
  assert.ok(glyphs.length >= 30);
  for (const r of glyphs) {
    assert.equal(r.glyphImage.width, GLYPH_V4_SIZE, r.key);
    const b = alphaBounds(r.glyphImage);
    assert.ok(b.x >= 33 && b.y >= 33 && b.x + b.width <= 159 && b.y + b.height <= 159, r.key + ' ' + JSON.stringify(b));
    assert.ok(Math.max(b.width, b.height) >= 118, r.key);
  }
  for (const e of Object.values(v4.export.manifest.icons)) {
    const [x, y, w, h] = e.bbox;
    assert.ok(x >= EDGE - 0.006 && y >= EDGE - 0.006 && x + w <= 1 - EDGE + 0.006 && y + h <= 1 - EDGE + 0.006);
  }
});

await check('T9.4 every tint satisfies the v4 OKLCH rules or is listed as non-conforming', () => {
  const listed = new Set(v4.report.v4.nonConforming.map((x) => x.key));
  for (const [key, e] of Object.entries(v4.export.manifest.icons)) {
    if (!e.tint) continue;
    const bad = v4Violations(e.tint);
    if (bad.length) assert.ok(listed.has(key), key + ' ' + bad.join(', '));
  }
  for (const item of v4.report.v4.nonConforming) assert.ok(item.violations.length > 0);
  assert.equal(v4.report.polish.contrastFlags, 0);
});

await check('T9.5 colour separation survives the v4 constraints on the catalogue and look-alike icons stay few', async () => {
  const cat = await runHarvest({ targets: buildTargets(catalogue), overrides: {} }, { profile: 'launcher', local: true, now: NOW, seed: 'a1b2c3d4', target: 'v4' }, localIo());
  assert.equal(cat.report.summary.default, 0);
  assert.ok(cat.report.polish.similarPairs <= 3, String(cat.report.polish.similarPairs));
  assert.ok(cat.report.polish.safeArea >= 0.95, String(cat.report.polish.safeArea));
  assert.equal(cat.report.polish.contrastFlags, 0);
});

await check('T9.6 tintV4 output obeys the rules for a spread of source colours including yellows and olives', () => {
  for (const hex of ['#ffd400', '#808000', '#e11d48', '#22c55e', '#0ea5e9', '#7c3aed', '#9a7b00', '#111827', '#f5f5f5', '#fbbf24']) {
    assert.deepEqual(v4Violations(tintV4(hex)), [], hex);
  }
});

await check('T9.7 the legacy-v1 profile writes 192 px pure white glyph PNGs with the v4 fields', async () => {
  const names = Object.keys(legacy.export.files).filter((n) => n.endsWith('.glyph.png'));
  assert.ok(names.length >= 30);
  for (const n of names) {
    const { image } = await decodeImage(legacy.export.files[n], 'png');
    assert.equal(image.width, 192, n);
    assert.equal(image.height, 192, n);
    for (let p = 0; p < image.width * image.height; p++) {
      if (image.data[p * 4 + 3] === 0) continue;
      assert.ok(image.data[p * 4] === 255 && image.data[p * 4 + 1] === 255 && image.data[p * 4 + 2] === 255, n + ' pixel ' + p);
    }
  }
  const m = legacy.export.manifest;
  assert.equal(m.version, 1);
  for (const e of Object.values(m.icons)) {
    assert.ok(e.ink > 0 && e.bbox.length === 4 && (e.layers === 1 || e.layers === 2));
    if (e.tint) assert.ok(['brand', 'authored'].includes(e.tintRole));
  }
});

const sheet = (discs) => {
  const img = makeImage(128, 128);
  for (const [cx, cy, radius, [r, g, b]] of discs) {
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 128; x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 > radius * radius) continue;
        const i = (y * 128 + x) * 4;
        img.data[i] = r;
        img.data[i + 1] = g;
        img.data[i + 2] = b;
        img.data[i + 3] = 255;
      }
    }
  }
  return img;
};

const two = await analyzeIcon(sheet([[44, 40, 22, [250, 200, 90]], [84, 88, 22, [70, 40, 30]]]), { target: 'v4' });
const one = await analyzeIcon(sheet([[44, 40, 22, [250, 200, 90]], [84, 88, 22, [250, 200, 90]]]), { target: 'v4' });

await check('T9.8 a mark with a darker secondary plane becomes a flat mid-alpha layer under the primary', () => {
  assert.equal(two.glyph.layers, 2);
  const levels = new Map();
  for (let p = 0; p < two.glyph.width * two.glyph.height; p++) {
    const a = two.glyph.data[p * 4 + 3];
    if (a > 0) levels.set(a, (levels.get(a) || 0) + 1);
  }
  const mid = [...levels].filter(([a]) => Math.abs(a - MID_ALPHA * 255) <= 10).reduce((s, [, n]) => s + n, 0);
  const full = levels.get(255) || 0;
  assert.ok(mid > 1500 && full > 2000, mid + ' ' + full);
  assert.equal(glyphStats(two.glyph).layers, 2);
});

await check('T9.9 a single-tone mark stays one layer', () => {
  assert.notEqual(one.glyph.layers, 2);
  assert.equal(glyphStats(one.glyph).layers, 1);
});

await check('T9.10 a two-tone mark traces to a layered symbol whose low layer uses the glyph accent', async () => {
  const t = await traceGlyphAuto(two.glyph, 'plate');
  assert.equal(t.accepted, true, t.reason);
  assert.equal(t.layers.length, 2);
  assert.ok(t.symbol.includes('fill-opacity=".5"') && t.symbol.includes('var(--lx-ga,currentColor)'));
  assert.ok(t.bytes <= LAYERED_MAX_BYTES, String(t.bytes));
  const paths = t.symbol.match(/<path /g);
  assert.equal(paths.length, 2);
  assert.ok(t.symbol.indexOf('fill-opacity') < t.symbol.lastIndexOf('<path '));
});

await check('T9.11 the sprite carries layered symbols for two-tone marks and the gate stays green', () => {
  const twoTone = Object.entries(v4.export.manifest.icons).filter(([, e]) => e.layers === 2 && e.glyph && e.glyph.symbol);
  assert.ok(twoTone.length >= 1);
  const sprite = new TextDecoder().decode(v4.export.files[Object.keys(v4.export.files).find((n) => n.startsWith('glyphs.'))]);
  for (const [key] of twoTone) {
    const m = new RegExp('<symbol id="g-' + key + '"[^>]*>(.*?)</symbol>').exec(sprite);
    assert.ok(m && (m[1].match(/<path /g) || []).length === 2, key);
  }
  assert.equal(v4.export.gate.ok, true, JSON.stringify(v4.export.gate.failures));
});

await check('T9.12 a v4 run is not seeded from a v3 reuse memo, and a v4 memo is reused by a v4 run', async () => {
  const again = await go({ target: 'v4', reuse: v3.reusable });
  assert.equal(again.reusedKeys.length, 0);
  const same = await go({ target: 'v4', reuse: v4.reusable });
  assert.ok(same.reusedKeys.length >= 30);
  assert.equal(new TextDecoder().decode(same.export.files['manifest.v2.json']), new TextDecoder().decode(v4.export.files['manifest.v2.json']));
});

await check('T9.13 the CLI writes v4 output and a rerun with --only none keeps layered symbols byte for byte', async () => {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'hs-v4-'));
  const cli = path.join(studioDir, 'cli', 'harvest.mjs');
  const args = ['--links', path.join(studioDir, 'test', 'links.json'), '--from', fixturesDir, '--out', out, '--target', 'v4', '--seed', '0a1b2c3d'];
  const a = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  assert.equal(a.status, 0, a.stderr);
  const first = {};
  for (const n of await fs.readdir(out)) if (/^glyphs\./.test(n) || n === 'manifest.v2.json') first[n] = await fs.readFile(path.join(out, n), 'utf8');
  const b = spawnSync(process.execPath, [cli, ...args, '--only', 'none'], { encoding: 'utf8' });
  assert.equal(b.status, 0, b.stderr);
  for (const [n, text] of Object.entries(first)) {
    const now = await fs.readFile(path.join(out, n), 'utf8');
    if (n === 'manifest.v2.json') assert.equal(JSON.parse(now).hash, JSON.parse(text).hash);
    else assert.equal(now, text, n);
  }
  const bad = spawnSync(process.execPath, [cli, ...args.slice(0, -2), '--target', 'v9'], { encoding: 'utf8' });
  assert.notEqual(bad.status, 0);
  await fs.rm(out, { recursive: true, force: true });
});

finish();
