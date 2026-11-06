import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { check, finish, studioDir } from './util.mjs';
import { runHarvest, buildTargets, RASTER_EXT } from '../core/index.js';

const NOW = '2026-01-01T00:00:00.000Z';
const links = JSON.parse(await fs.readFile(path.join(studioDir, 'config', 'catalogue.json'), 'utf8'));
const knownDir = path.join(studioDir, 'config', 'known-icons');
const targets = buildTargets(links);

const readKnown = async (key) => {
  for (const ext of RASTER_EXT) {
    try {
      return { bytes: new Uint8Array(await fs.readFile(path.join(knownDir, key + '.' + ext))), file: 'known-icons/' + key + '.' + ext };
    } catch {}
  }
  return null;
};

const offline = (extra = {}) => ({
  fetchBytes: async () => {
    throw Object.assign(new Error('needs the fetch proxy: this site does not allow direct browser access'), { fatal: true });
  },
  readLocal: async () => null,
  readOverride: async () => null,
  readOutput: async () => null,
  readKnown,
  ...extra
});
const run = (io, options = {}, list = targets) => runHarvest({ targets: list, overrides: {} }, { profile: 'launcher', mode: 'follow', now: NOW, ...options }, io);

await check('every catalogue app ships an icon and the catalogue matches the shipped one', async () => {
  assert.equal(targets.length, 32);
  for (const t of targets) assert.ok(await readKnown(t.key), t.key);
});

const offlineRun = await run(offline());

await check('with no network at all the whole catalogue is harvested from the shipped icons', () => {
  assert.equal(offlineRun.report.summary.found, 32);
  assert.equal(offlineRun.report.summary.notfound, 0);
  assert.ok(offlineRun.report.gate.ok);
  const protocols = offlineRun.report.items.find((i) => i.key === 'protocols');
  assert.equal(protocols.status, 'found');
  assert.equal(protocols.source.type, 'bundled');
  assert.equal(protocols.source.href, 'known-icons/protocols.ico');
  assert.equal(protocols.tintSource, 'catalogue');
});

await check('the attempts list says the shipped copy was used and why', () => {
  const protocols = offlineRun.report.items.find((i) => i.key === 'protocols');
  const last = protocols.attempts[protocols.attempts.length - 1];
  assert.deepEqual([last.type, last.status], ['bundled', 'used']);
  assert.match(last.reason, /live fetch failed/);
  assert.equal(protocols.attempts[0].type, 'page');
});

await check('a working live fetch always wins over the shipped icon', async () => {
  const live = new Uint8Array(await fs.readFile(path.join(knownDir, 'draw.png')));
  const io = offline({
    fetchBytes: async (url) => (url === 'https://example.test/' ? { ok: true, status: 200, url, bytes: new TextEncoder().encode('<html><head><link rel="icon" href="/i.png"></head></html>'), mitigated: null } : url === 'https://example.test/i.png' ? { ok: true, status: 200, url, bytes: live, mitigated: null } : { ok: false, status: 404, url, bytes: new Uint8Array(), mitigated: null })
  });
  const r = await run(io, {}, [{ key: 'draw', appId: 'draw', variantId: null, url: 'https://example.test/' }]);
  assert.equal(r.report.items[0].source.type, 'png');
});

await check('a blocked site falls back to the shipped icon and keeps the block in its attempts', async () => {
  const io = offline({ fetchBytes: async (url) => ({ ok: false, status: 403, url, bytes: new Uint8Array(), mitigated: null }) });
  const r = await run(io, {}, targets.filter((t) => t.key === 'protocols'));
  assert.equal(r.report.items[0].status, 'found');
  assert.deepEqual(r.report.items[0].attempts.map((a) => [a.type, a.status]), [['page', 'blocked'], ['bundled', 'used']]);
});

await check('an earlier manifest entry beats the shipped icon', async () => {
  const files = offlineRun.export.files;
  const again = await run(offline({ readOutput: async (name) => files[name] || null, readKnown: async () => null }), {}, targets.slice(0, 3));
  const second = await run(offline({ readOutput: async (name) => files[name] || null }), {}, targets.slice(0, 3));
  assert.deepEqual(again.report.items.map((i) => i.status), ['stale', 'stale', 'stale']);
  assert.deepEqual(second.report.items.map((i) => i.status), ['stale', 'stale', 'stale']);
  assert.ok(second.report.items.every((i) => !i.source || i.source.type !== 'bundled'));
});

await check('an unreadable shipped file is reported, not fatal', async () => {
  const io = offline({ readKnown: async () => ({ bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), file: 'known-icons/x.png' }) });
  const r = await run(io, {}, targets.slice(0, 1));
  assert.equal(r.report.items[0].status, 'notfound');
  assert.equal(r.report.items[0].attempts.at(-1).type, 'bundled');
  assert.equal(r.report.items[0].attempts.at(-1).status, 'failed');
});

await check('the CLI uses the shipped icons when the network is down', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hs-known-'));
  const one = { categories: [{ id: 'core', label: 'Core', apps: links.categories.flatMap((c) => c.apps).filter((a) => a.id === 'protocols') }] };
  await fs.writeFile(path.join(dir, 'links.json'), JSON.stringify(one));
  const r = spawnSync(process.execPath, [path.join(studioDir, 'cli', 'harvest.mjs'), '--out', path.join(dir, 'icons')], { cwd: dir, encoding: 'utf8', env: { ...process.env, HTTPS_PROXY: '', https_proxy: '' } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /found\s+protocols\s+bundled known-icons\/protocols\.ico/);
});

finish();
