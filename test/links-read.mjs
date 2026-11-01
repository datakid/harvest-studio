import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { check, finish, studioDir } from './util.mjs';
import { runHarvest, buildTargets, extrasToTargets, mergeTargets, RASTER_EXT } from '../core/index.js';

const NOW = '2026-01-01T00:00:00.000Z';
const readJson = async (...parts) => JSON.parse(await fs.readFile(path.join(studioDir, ...parts), 'utf8'));
const links = await readJson('test', 'links.json');
const catalogue = await readJson('config', 'catalogue.json');
const extras = extrasToTargets(await readJson('config', 'extras.json'));
const knownDir = path.join(studioDir, 'config', 'known-icons');

const readKnown = async (key) => {
  for (const ext of RASTER_EXT) {
    try {
      return { bytes: new Uint8Array(await fs.readFile(path.join(knownDir, key + '.' + ext))), file: 'known-icons/' + key + '.' + ext };
    } catch {}
  }
  return null;
};
const offline = {
  fetchBytes: async () => {
    throw Object.assign(new Error('needs the fetch proxy: this site does not allow direct browser access'), { fatal: true });
  },
  readLocal: async () => null,
  readOverride: async () => null,
  readOutput: async () => null,
  readKnown
};

const synthetic = {
  categories: [
    { id: 'palette', label: { en: 'Palette' }, apps: [{ id: 'alt', title: { en: 'Alt' }, url: 'https://alt.example/' }, { id: 'harvest', title: { en: 'Harvest' }, url: 'https://harvest.example/' }] },
    { id: 'anything-else', label: { en: 'Other' }, apps: [{ id: 'one', title: { en: 'One' }, url: 'https://one.example/' }] },
    { id: 'mine', label: { en: 'Mine' }, apps: [{ id: 'u-abc', title: { en: 'Mine' }, url: 'https://mine.example/' }, { id: 'saved', title: { en: 'Saved' }, url: 'https://saved.example/' }] }
  ]
};

await check('T3.3a a palette category is read like any other, so alt and harvest are targets', () => {
  assert.deepEqual(buildTargets(synthetic).map((t) => t.key), ['alt', 'harvest', 'one', 'saved']);
  const keys = buildTargets(links).map((t) => t.key);
  assert.ok(keys.includes('alt') && keys.includes('harvest'));
  assert.ok(buildTargets(catalogue).some((t) => t.key === 'harvest'));
});

await check('T3.3a no category id is special: only the u- prefix on an app id is skipped', () => {
  assert.ok(buildTargets(synthetic).some((t) => t.key === 'saved'));
  assert.ok(!buildTargets(synthetic).some((t) => t.key === 'u-abc'));
});

await check('T3.3b no target is keyed studio', async () => {
  const keys = mergeTargets(buildTargets(catalogue), extras).map((t) => t.key);
  assert.ok(!keys.includes('studio'));
  assert.ok(!(await readJson('config', 'extras.json')).studio);
  await assert.rejects(fs.access(path.join(knownDir, 'studio.png')));
});

const full = await runHarvest({ targets: mergeTargets(buildTargets(catalogue), extras), overrides: {}, launcherIds: buildTargets(catalogue).map((t) => t.key) }, { profile: 'launcher', mode: 'follow', now: NOW }, offline);

await check('T3.3c the report lists unused and missing, both empty for the current catalogue', () => {
  assert.deepEqual(full.report.unused, []);
  assert.deepEqual(full.report.missing, []);
});

await check('T3.3c a mark with no launcher id is unused and a launcher id with no mark is missing', async () => {
  const ids = buildTargets(catalogue).map((t) => t.key).filter((k) => k !== 'harvest').concat('not-in-targets');
  const r = await runHarvest({ targets: buildTargets(catalogue), overrides: {}, launcherIds: ids }, { profile: 'launcher', mode: 'follow', now: NOW, preview: true }, offline);
  assert.deepEqual(r.report.unused, ['harvest']);
  assert.deepEqual(r.report.missing, ['not-in-targets']);
});

await check('T3.3c without launcher ids the arrays are present and empty', async () => {
  const r = await runHarvest({ targets: buildTargets(catalogue).slice(0, 3), overrides: {} }, { profile: 'launcher', mode: 'follow', now: NOW, preview: true }, offline);
  assert.deepEqual([r.report.unused, r.report.missing], [[], []]);
});

finish();
