import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fixtureTargets, localIo, NOW, studioDir } from '../util.mjs';
import { scanJson } from '../../core/sources.js';
import { runHarvest, buildTargets, buildFihristTargets, extrasToTargets, mergeTargets } from '../../core/index.js';

const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const readJson = async (...parts) => JSON.parse(await fs.readFile(path.join(studioDir, ...parts), 'utf8'));

export const hashRun = async (target) => {
  const targets = await fixtureTargets();
  const r = await runHarvest({ targets, overrides: {} }, { profile: 'launcher', local: true, now: NOW, seed: '0a1b2c3d', ...(target ? { target } : {}) }, localIo());
  const files = {};
  for (const name of Object.keys(r.export.files).sort()) files[name] = sha(r.export.files[name]);
  return { manifestHash: r.export.manifest.hash, files };
};

export const linkSets = async () => {
  const catalogue = await readJson('config', 'catalogue.json');
  const fihrist = await readJson('config', 'fihrist.json');
  const extras = extrasToTargets(await readJson('config', 'extras.json'));
  const links = await readJson('test', 'links.json');
  const pick = (list) => Object.fromEntries(list.map((t) => [t.key, t.url]).sort(([a], [b]) => (a < b ? -1 : 1)));
  return {
    catalogue: pick(buildTargets(catalogue)),
    testLinks: pick(buildTargets(links)),
    fihristEn: pick(buildFihristTargets(fihrist, 'en')),
    fihristAr: pick(buildFihristTargets(fihrist, 'ar')),
    merged: pick(mergeTargets(buildTargets(catalogue), extras)),
    scanCatalogue: pick(scanJson(catalogue, {}, 'en').targets),
    scanTestLinks: pick(scanJson(links, {}, 'en').targets),
    scanFihristEn: pick(scanJson(fihrist, {}, 'en').targets),
    scanFihristAr: pick(scanJson(fihrist, {}, 'ar').targets)
  };
};

const UI_SUITES = ['ui', 'features', 'fihrist', 'additive', 'netlify', 'perf', 'stall-ui', 'pin-ui', 'polish-ui', 'v4-ui'];

export const hookInventory = async () => {
  const ids = new Set();
  const acts = new Set();
  const studio = new Set();
  for (const f of UI_SUITES) {
    const text = await fs.readFile(path.join(studioDir, 'test', f + '.mjs'), 'utf8');
    for (const m of text.matchAll(/#([A-Za-z][\w-]*)/g)) ids.add(m[1]);
    for (const m of text.matchAll(/data-act=\\?["']?([\w-]+)/g)) acts.add(m[1]);
    for (const m of text.matchAll(/__studio\.([A-Za-z]+)/g)) studio.add(m[1]);
  }
  const srcDir = path.join(studioDir, 'src');
  const source = (await Promise.all((await fs.readdir(srcDir)).filter((n) => /\.(js|html)$/.test(n)).map((n) => fs.readFile(path.join(srcDir, n), 'utf8')))).join('\n');
  return { ids: [...ids].filter((i) => !/^[0-9a-f]{3,6}$/i.test(i) && source.includes(i)).sort(), acts: [...acts].sort(), studio: [...studio].sort() };
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const hashes = { v3: await hashRun(), v4: await hashRun('v4') };
  await fs.writeFile(path.join(studioDir, 'test', 'golden', 'hashes.json'), JSON.stringify(hashes, null, 2) + '\n');
  await fs.writeFile(path.join(studioDir, 'test', 'golden', 'hooks.json'), JSON.stringify(await hookInventory(), null, 2) + '\n');
  await fs.writeFile(path.join(studioDir, 'test', 'golden', 'links.json'), JSON.stringify(await linkSets(), null, 2) + '\n');
  console.log('v3', hashes.v3.manifestHash, Object.keys(hashes.v3.files).length, 'files; v4', hashes.v4.manifestHash);
}
