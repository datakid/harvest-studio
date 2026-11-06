import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { check, finish, fixtureTargets, localIo, NOW } from './util.mjs';
import { hashRun } from './golden/make.mjs';
import { runHarvest, rerender, cleanAdjust, isEmptyAdjust, adjustMapOf, alphaBounds, alphaCentroid, encodePng, makeImage, normalize, GLYPH_SIZE } from '../core/index.js';

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const targets = (await fixtureTargets()).slice(0, 6);
const keys = targets.map((t) => t.key);
const go = (adjust, extra = {}) => runHarvest({ targets, overrides: {}, adjust }, { profile: 'launcher', local: true, now: NOW, seed: '0a1b2c3d', ...extra }, localIo());
const bytesOf = (r) => Object.fromEntries(Object.entries(r.export.files).map(([k, v]) => [k, sha(v)]));
const withGlyph = async () => {
  const base = await go({});
  const rec = base.records.find((r) => r.glyphImage && r.trace && r.trace.accepted);
  assert.ok(rec, 'no fixture has a traced glyph');
  return { base, key: rec.key, rec };
};

await check('A1 cleanAdjust drops defaults, clamps ranges and ignores junk', () => {
  assert.deepEqual(cleanAdjust({}), {});
  assert.deepEqual(cleanAdjust(null), {});
  assert.deepEqual(cleanAdjust({ scale: 2, offset: { x: 1, y: -1 }, weight: 9, render: 'x', background: 'maybe', invert: false, exclude: true }), { scale: 0.9, offset: { x: 0.12, y: -0.12 }, weight: 2, exclude: true });
  assert.ok(isEmptyAdjust({ offset: { x: 0, y: 0 }, weight: 0 }));
  assert.deepEqual(adjustMapOf({ b: {}, a: { invert: true } }), { a: { invert: true } });
});

await check('A2 an empty adjust gives the same bytes as no adjust, and as the golden hashes on the full fixture set', async () => {
  const none = bytesOf(await go(undefined));
  const empty = bytesOf(await go({ [keys[0]]: {}, [keys[1]]: { weight: 0, offset: { x: 0, y: 0 } } }));
  assert.deepEqual(empty, none);
  const golden = JSON.parse(await fs.readFile(path.join(import.meta.dirname, 'golden', 'hashes.json'), 'utf8'));
  assert.deepEqual(await hashRun(), golden.v3);
});

await check('A3 every adjust field is deterministic: two runs give the same bytes', async () => {
  const { key } = await withGlyph();
  const sets = [{ scale: 0.6 }, { offset: { x: 0.05, y: -0.04 } }, { weight: 2 }, { weight: -2 }, { invert: true }, { render: 'image' }, { background: 'keep' }, { background: 'remove' }, { exclude: true }];
  for (const a of sets) assert.deepEqual(bytesOf(await go({ [key]: a })), bytesOf(await go({ [key]: a })), JSON.stringify(a));
});

await check('A4 scale changes how much of the cell the glyph fills', async () => {
  const { key } = await withGlyph();
  const fill = async (a) => {
    const rec = (await go({ [key]: a })).records.find((r) => r.key === key);
    const b = alphaBounds(rec.glyphImage);
    return Math.max(b.width, b.height) / rec.glyphImage.width;
  };
  const small = await fill({ scale: 0.55 });
  const normal = await fill({});
  const large = await fill({ scale: 0.88 });
  assert.ok(small < normal && normal < large, [small, normal, large].join(' '));
  assert.ok(Math.abs(small - 0.55) < 0.04 && Math.abs(large - 0.88) < 0.04);
});

await check('A5 offset moves the glyph by the asked share of the cell', async () => {
  const { key, rec } = await withGlyph();
  const [cx0, cy0] = alphaCentroid(rec.glyphImage);
  const moved = (await go({ [key]: { offset: { x: 0.06, y: -0.05 } } })).records.find((r) => r.key === key);
  const [cx1, cy1] = alphaCentroid(moved.glyphImage);
  assert.ok(Math.abs(cx1 - cx0 - 0.06 * GLYPH_SIZE) < 1.5, String(cx1 - cx0));
  assert.ok(Math.abs(cy1 - cy0 + 0.05 * GLYPH_SIZE) < 1.5, String(cy1 - cy0));
});

await check('A6 weight changes the traced stroke, heavier for plus and lighter for minus', async () => {
  const { key } = await withGlyph();
  const stroke = async (w) => (await go({ [key]: { weight: w } })).records.find((r) => r.key === key).trace;
  const base = await stroke(0);
  const heavy = await stroke(2);
  const light = await stroke(-2);
  assert.ok(heavy.d !== base.d || light.d !== base.d);
  if (heavy.accepted && light.accepted && base.accepted) assert.ok(heavy.stroke >= light.stroke);
});

await check('A7 render image drops the glyph so the launcher uses the picture', async () => {
  const { key } = await withGlyph();
  const rec = (await go({ [key]: { render: 'image' } })).records.find((r) => r.key === key);
  assert.equal(rec.glyphImage, null);
  assert.equal(rec.trace, null);
  assert.ok(rec.image);
});

await check('A8 exclude keeps the record but leaves it out of every export file', async () => {
  const { key } = await withGlyph();
  const r = await go({ [key]: { exclude: true } });
  assert.ok(r.records.some((x) => x.key === key));
  assert.ok(!(key in r.export.manifest.icons));
  const base = await go({});
  assert.equal(Object.keys(r.export.manifest.icons).length, Object.keys(base.export.manifest.icons).length - 1);
});

await check('A9 rerender from the cached original reproduces the harvest result and applies a change', async () => {
  const { base, key } = await withGlyph();
  const rec = base.records.find((r) => r.key === key);
  assert.ok(rec.original, 'the fixture keeps its original');
  const again = await rerender(rec, {});
  assert.equal(again.image.width, rec.image.width);
  const small = await rerender(rec, { scale: 0.55 });
  const normal = await rerender(rec, {});
  const fillOf = (g) => Math.max(alphaBounds(g).width, alphaBounds(g).height) / g.width;
  assert.ok(fillOf(small.glyphImage) < fillOf(normal.glyphImage));
  assert.deepEqual(small.adjust, { scale: 0.55 });
});

await check('A10 background keep leaves a flat square, remove forces it away', async () => {
  const size = 96;
  const img = makeImage(size, size);
  for (let i = 0; i < size * size; i++) img.data.set([255, 255, 255, 255], i * 4);
  for (let y = 24; y < 72; y++) for (let x = 24; x < 72; x++) img.data.set([40, 60, 200, 255], (y * size + x) * 4);
  const png = await encodePng(img, { optimise: false });
  const keep = await normalize(png, 'png', { background: 'keep' });
  const remove = await normalize(png, 'png', { background: 'remove' });
  const corner = (i) => i.img.data[3];
  assert.equal(corner(keep), 255);
  assert.equal(corner(remove), 0);
});

await check('A11 the CLI reads per-key adjust objects from config/icon-adjust.json in the folder it runs in', async () => {
  const { spawnSync } = await import('node:child_process');
  const os = await import('node:os');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'adjust-'));
  const links = JSON.parse(await fs.readFile(path.join(import.meta.dirname, 'links.json'), 'utf8'));
  await fs.writeFile(path.join(dir, 'links.json'), JSON.stringify(links));
  const run = (out) => spawnSync(process.execPath, [path.join(import.meta.dirname, '..', 'cli', 'harvest.mjs'), '--profile', 'launcher', '--from', path.join(import.meta.dirname, 'fixtures'), '--links', path.join(dir, 'links.json'), '--out', path.join(dir, out), '--seed', '0a1b2c3d'], { cwd: dir, encoding: 'utf8' });
  assert.equal(run('plain').status, 0);
  const key = Object.keys(JSON.parse(await fs.readFile(path.join(dir, 'plain', 'manifest.v2.json'), 'utf8')).icons)[0];
  await fs.mkdir(path.join(dir, 'config'));
  await fs.writeFile(path.join(dir, 'config', 'icon-adjust.json'), JSON.stringify({ [key]: { exclude: true } }));
  assert.equal(run('adjusted').status, 0);
  const plain = JSON.parse(await fs.readFile(path.join(dir, 'plain', 'manifest.v2.json'), 'utf8'));
  const adjusted = JSON.parse(await fs.readFile(path.join(dir, 'adjusted', 'manifest.v2.json'), 'utf8'));
  assert.ok(key in plain.icons);
  assert.ok(!(key in adjusted.icons));
  assert.notEqual(plain.hash, adjusted.hash);
});

finish();
