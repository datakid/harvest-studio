#!/usr/bin/env node
import './node-runtime.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNodePool } from './node-pool.mjs';
import { runHarvest, adjustMapOf, buildTargets, buildFihristTargets, isFihrist, extrasToTargets, mergeTargets, urlIdentity, errText, RASTER_EXT, readHead, netlifyProtection, headersReader } from '../core/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const studioDir = path.resolve(here, '..');
const repoRoot = process.cwd();
const knownDir = path.join(studioDir, 'config', 'known-icons');

const parseArgs = (argv) => {
  const out = { from: null, set: 'launcher', profile: 'launcher', out: path.join(repoRoot, 'icons'), links: path.join(repoRoot, 'links.json'), seed: null, faFallback: false, only: null, workers: null, target: 'v3' };
  const take = (i, name) => {
    if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(name + ' needs a value');
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--from') out.from = path.resolve(take(i++, a));
    else if (a === '--set') out.set = take(i++, a);
    else if (a === '--profile') out.profile = take(i++, a);
    else if (a === '--out') out.out = path.resolve(take(i++, a));
    else if (a === '--links') out.links = path.resolve(take(i++, a));
    else if (a === '--seed') out.seed = take(i++, a);
    else if (a === '--target') out.target = take(i++, a);
    else if (a === '--fa-fallback') out.faFallback = true;
    else if (a === '--workers') out.workers = Number(take(i++, a));
    else if (a === '--only') {
      const v = take(i++, a);
      out.only = v === 'none' ? [] : v.split(',').map((k) => k.trim()).filter(Boolean);
      if (v !== 'none' && !out.only.length) out.onlyEmpty = true;
    }
    else throw new Error('unknown flag ' + a);
  }
  if (!['launcher', 'fihrist'].includes(out.set)) throw new Error('--set must be launcher or fihrist');
  if (!['launcher', 'legacy-v1'].includes(out.profile)) throw new Error('--profile must be launcher or legacy-v1');
  if (!['v3', 'v4'].includes(out.target)) throw new Error('--target must be v3 or v4');
  if (out.seed !== null && !/^[0-9a-f]{8}$/.test(out.seed)) throw new Error('--seed must be 8 hex characters');
  return out;
};

const readJson = async (file, fallback) => {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw e;
  }
};

const main = async () => {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    return 1;
  }
  let catalog;
  try {
    catalog = JSON.parse(await fs.readFile(args.links, 'utf8'));
    if (args.set === 'fihrist' ? !isFihrist(catalog) : !catalog || !Array.isArray(catalog.categories)) throw new Error(args.set === 'fihrist' ? 'not a Fihrist file' : 'missing categories');
  } catch (e) {
    console.error('links file is invalid: ' + errText(e));
    return 1;
  }
  const overridesPath = path.join(studioDir, 'config', 'icon-overrides.json');
  const extrasPath = path.join(studioDir, 'config', 'extras.json');
  const setTargets = args.set === 'fihrist' ? buildFihristTargets(catalog, 'en') : buildTargets(catalog);
  const overrides = { ...(await readJson(overridesPath, {})), ...(await readJson(path.join(repoRoot, 'config', 'icon-overrides.json'), {})) };
  const pins = { ...(await readJson(path.join(studioDir, 'config', 'source-pins.json'), {})), ...(await readJson(path.join(repoRoot, 'config', 'source-pins.json'), {})) };
  const adjust = adjustMapOf({ ...(await readJson(path.join(studioDir, 'config', 'icon-adjust.json'), {})), ...(await readJson(path.join(repoRoot, 'config', 'icon-adjust.json'), {})) });
  const extras = args.set === 'fihrist' ? [] : extrasToTargets(await readJson(extrasPath, {}));
  const targets = mergeTargets(setTargets, extras);
  const shippedCatalogue = await readJson(path.join(studioDir, 'config', 'catalogue.json'), { categories: [] });
  const shippedKeys = new Map(mergeTargets(buildTargets(shippedCatalogue), extrasToTargets(await readJson(extrasPath, {}))).map((t) => [urlIdentity(t.url), t.key]));
  if (args.only) {
    const known = new Set(targets.map((t) => t.key));
    const unknown = args.only.filter((k) => !known.has(k));
    if (args.onlyEmpty || unknown.length) {
      console.error(unknown.length ? '--only has unknown keys: ' + unknown.join(', ') : '--only needs at least one key');
      return 1;
    }
  }

  await fs.mkdir(args.out, { recursive: true });
  const io = {
    fetchBytes: async (url, options = {}) => {
      let res;
      try {
        res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0 LinkExpressIconBot' } });
      } catch (err) {
        if (err && err.name === 'TimeoutError') {
          const e = new Error('timed out after 15 seconds');
          e.timeout = true;
          throw e;
        }
        throw err;
      }
      const bytes = options.head && res.body ? await readHead(res.body) : new Uint8Array(await res.arrayBuffer());
      return { ok: res.ok, status: res.status, url: res.url || url, bytes, mitigated: res.headers.get('x-vercel-mitigated'), protection: netlifyProtection(res.status, headersReader(res.headers)) };
    },
    readLocal: async (key) => {
      for (const ext of RASTER_EXT) {
        try {
          return { bytes: new Uint8Array(await fs.readFile(path.join(args.from, key + '.' + ext))), file: key + '.' + ext };
        } catch (e) {
          if (e.code !== 'ENOENT') throw e;
        }
      }
      return null;
    },
    readKnown: async (key, url) => {
      const byUrl = url ? shippedKeys.get(urlIdentity(url)) : null;
      for (const name of byUrl && byUrl !== key ? [key, byUrl] : [key]) {
        for (const ext of RASTER_EXT) {
          try {
            return { bytes: new Uint8Array(await fs.readFile(path.join(knownDir, name + '.' + ext))), file: 'known-icons/' + name + '.' + ext };
          } catch (e) {
            if (e.code !== 'ENOENT') throw e;
          }
        }
      }
      return null;
    },
    readOverride: async (rel) => {
      const file = path.resolve(repoRoot, rel);
      if (!file.startsWith(repoRoot + path.sep)) throw new Error('override path leaves the repo');
      return new Uint8Array(await fs.readFile(file));
    },
    readOutput: async (name) => {
      try {
        return new Uint8Array(await fs.readFile(path.join(args.out, name)));
      } catch (e) {
        if (e.code === 'ENOENT') return null;
        throw e;
      }
    }
  };

  const pool = args.workers ? createNodePool(args.workers) : null;
  let result;
  try {
    result = await runHarvest(
      { targets, overrides, pins, adjust, launcherIds: setTargets.map((t) => t.key) },
      { profile: args.profile, local: !!args.from, seed: args.seed, target: args.target, faFallback: args.faFallback, only: args.only, compute: pool || undefined },
      io
    );
  } finally {
    if (pool) await pool.close();
  }
  const exp = result.export;

  if (!exp.gate.ok) {
    await fs.writeFile(path.join(args.out, 'harvest-report.json'), exp.files['harvest-report.json']);
    console.error('budget gate blocked the export:');
    for (const f of exp.gate.failures) console.error('  ' + f.message);
    return 1;
  }

  if (args.profile === 'launcher') {
    for (const name of await fs.readdir(args.out)) {
      if (exp.replaces.test(name) && !(name in exp.files)) await fs.rm(path.join(args.out, name));
    }
  } else if (!args.from) {
    for (const name of await fs.readdir(args.out)) {
      if (!name.endsWith('.png')) continue;
      const key = name.replace(/\.glyph\.png$/, '').replace(/\.png$/, '');
      if (!result.validKeys.has(key) && !(name in exp.files)) await fs.rm(path.join(args.out, name));
    }
  }
  for (const [name, bytes] of Object.entries(exp.files)) await fs.writeFile(path.join(args.out, name), bytes);

  for (const item of result.report.items) {
    const how = item.source ? item.source.type + ' ' + item.source.href : '-';
    console.log(item.status.padEnd(9) + item.key.padEnd(30) + how + (item.why ? '  ' + item.why.join(',') : '') + (item.error ? '  ' + item.error : ''));
  }
  if (args.only) {
    const lost = result.report.items.filter((i) => !args.only.includes(i.key) && i.status === 'notfound').map((i) => i.key);
    if (lost.length) console.error('warning: ' + lost.length + ' other keys have no entry in the existing manifest and are left out');
  }
  for (const k of result.report.unused) console.warn('unused entry: ' + k + ' has a mark but no launcher id');
  for (const k of result.report.missing) console.warn('missing mark: launcher id ' + k + ' has no manifest entry');
  console.log('');
  console.log(JSON.stringify(result.report.summary));
  if (args.profile === 'launcher') console.log(JSON.stringify(result.report.atlas));
  return 0;
};

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(errText(e));
    process.exit(1);
  }
);
