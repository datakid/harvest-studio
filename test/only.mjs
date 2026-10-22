import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { check, finish, studioDir } from './util.mjs';
import { runHarvest, buildTargets } from '../core/index.js';
import { bmpFrame, buildIco } from './ico-fixtures.mjs';

const links = JSON.parse(await fs.readFile(path.join(studioDir, 'test', 'links.json'), 'utf8'));
const NOW = '2026-01-01T00:00:00.000Z';
const A = 'https://strong-snickerdoodle-02a92f.netlify.app/';
const B = 'https://slippery-form-2-2.vercel.app/';
const page = '<!DOCTYPE html><html><head><link rel="icon" href="favicon.ico"></head><body></body></html>';
const colour = (rgb) => {
  const img = { width: 48, height: 48, data: new Uint8ClampedArray(48 * 48 * 4) };
  for (let y = 0; y < 48; y++) {
    for (let x = 0; x < 48; x++) {
      const inside = x >= 8 && x < 40 && y >= 8 && y < 40;
      const shade = inside ? 1 - (x + y) / 160 : 0;
      img.data.set(inside ? [rgb[0] * shade, rgb[1] * shade, rgb[2] * shade, 255] : [255, 255, 255, 255], (y * 48 + x) * 4);
    }
  }
  return buildIco([bmpFrame(img, { bpp: 24, mask: false })]);
};
const blue = colour([30, 120, 230]);
const green = colour([40, 170, 90]);
const red = colour([210, 50, 50]);
const targets = buildTargets(links).filter((t) => ['protocols', 'ledger-form--tally'].includes(t.key));

const makeIo = (sites, files, calls) => ({
  fetchBytes: async (url) => {
    calls.push(url);
    const hit = sites[url];
    if (!hit) return { ok: false, status: 404, url, bytes: new Uint8Array(), mitigated: null };
    return { ok: true, status: 200, url, bytes: typeof hit === 'string' ? new TextEncoder().encode(hit) : hit, mitigated: null };
  },
  readLocal: async () => null,
  readOverride: async () => null,
  readOutput: async (name) => (files && files[name]) || null
});
const run = (sites, files, options = {}) => {
  const calls = [];
  return runHarvest({ targets, overrides: {} }, { profile: 'launcher', mode: 'follow', now: NOW, ...options }, makeIo(sites, files, calls)).then((r) => ({ ...r, calls }));
};
const manifestOf = (r) => JSON.parse(new TextDecoder().decode(r.export.files['manifest.v2.json']));

const sites = { [A]: page, [A + 'favicon.ico']: blue, [B]: page, [B + 'favicon.ico']: green };
const full = await run(sites, null);

await check('--only leaves the other keys untouched and does not fetch them', async () => {
  const again = await run(sites, full.export.files, { only: ['protocols'] });
  assert.ok(!again.calls.some((u) => u.startsWith(B)));
  assert.ok(again.calls.some((u) => u.startsWith(A)));
  assert.equal(again.report.summary.skipped, 1);
  assert.equal(again.report.summary.notfound, 0);
  const item = again.report.items.find((i) => i.key === 'ledger-form--tally');
  assert.equal(item.status, 'found');
  assert.equal(item.harvest, 'skipped');
});

await check('--only with nothing changed keeps the manifest hash', async () => {
  const again = await run(sites, full.export.files, { only: ['protocols'] });
  assert.equal(manifestOf(again).hash, manifestOf(full).hash);
});

await check('--only replaces only the chosen key when its favicon changed', async () => {
  const changed = { ...sites, [A + 'favicon.ico']: red };
  const again = await run(changed, full.export.files, { only: ['protocols'] });
  const before = manifestOf(full).icons;
  const after = manifestOf(again).icons;
  assert.notEqual(after.protocols.hash, before.protocols.hash);
  assert.equal(after['ledger-form--tally'].hash, before['ledger-form--tally'].hash);
  assert.deepEqual(after['ledger-form--tally'].tint, before['ledger-form--tally'].tint);
});

await check('--only without a previous manifest leaves the other keys out', async () => {
  const lone = await run(sites, null, { only: ['protocols'] });
  assert.deepEqual(Object.keys(manifestOf(lone).icons), ['protocols']);
  assert.equal(lone.report.summary.notfound, 0);
});

await check('the CLI validates --only keys and runs with a valid one', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hs-only-'));
  await fs.writeFile(path.join(dir, 'links.json'), JSON.stringify({ categories: [{ id: 'core', label: 'Core', apps: [{ id: 'protocols', title: 'Protocols', url: A }] }] }));
  const cli = path.join(studioDir, 'cli', 'harvest.mjs');
  const exec = (...args) => spawnSync(process.execPath, [cli, '--out', path.join(dir, 'icons'), ...args], { cwd: dir, encoding: 'utf8' });
  const bad = exec('--only', 'nope');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /unknown keys: nope/);
  const missing = exec('--only');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /--only needs a value/);
});

finish();
