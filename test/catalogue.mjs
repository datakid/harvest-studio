import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { check, finish, studioDir } from './util.mjs';
import { runHarvest, buildTargets } from '../core/index.js';
import { bookImage, bmpFrame, buildIco } from './ico-fixtures.mjs';

const links = JSON.parse(await fs.readFile(path.join(studioDir, 'test', 'links.json'), 'utf8'));
const NOW = '2026-01-01T00:00:00.000Z';
const PROTOCOLS = 'https://strong-snickerdoodle-02a92f.netlify.app/';
const head = '<!DOCTYPE html><!-- Netlify --><html><head><link rel="icon" type="image/x-icon" href="favicon.ico"></head><body></body></html>';
const blackBook = buildIco([bmpFrame(bookImage(48), { bpp: 32, alpha: 'zero' })]);

const siteIo = (pages, extra = {}) => ({
  fetchBytes: async (url) => {
    const hit = pages[url];
    if (!hit) return { ok: false, status: 404, url, bytes: new Uint8Array(), mitigated: null };
    return { ok: true, status: 200, url, bytes: typeof hit === 'string' ? new TextEncoder().encode(hit) : hit, mitigated: null };
  },
  readLocal: async () => null,
  readOverride: async () => null,
  readOutput: async () => null,
  ...extra
});

const only = (...keys) => buildTargets(links).filter((t) => keys.includes(t.key));
const protocolsIo = (extra) => siteIo({ [PROTOCOLS]: head, [PROTOCOLS + 'favicon.ico']: blackBook }, extra);

await check('catalogue targets carry gradient, closed flag and FontAwesome name', () => {
  const [p] = only('protocols');
  assert.deepEqual(p.catalogueTint, ['#cf8350', '#fdba74', '#7c2d12']);
  assert.equal(p.faIcon, 'fa-folder-open');
  const [tally] = only('ledger-form--tally');
  assert.equal(tally.closed, true);
  assert.equal(only('parser')[0].closed, undefined);
});

await check('a monochrome favicon takes the catalogue gradient and says so in the report', async () => {
  const r = await runHarvest({ targets: only('protocols'), overrides: {} }, { profile: 'launcher', mode: 'follow', now: NOW }, protocolsIo());
  const item = r.report.items[0];
  assert.equal(item.status, 'found');
  assert.equal(item.source.type, 'ico');
  assert.equal(item.tintSource, 'catalogue');
  assert.equal(r.records[0].sourceTint[0], '#cf8350');
  assert.equal(r.records[0].tint[0].length, 7);
  assert.ok(r.report.gate.ok);
});

await check('a favicon with its own colour keeps it and is not marked as catalogue', async () => {
  const colour = { width: 48, height: 48, data: new Uint8ClampedArray(48 * 48 * 4) };
  for (let p = 0; p < 48 * 48; p++) colour.data.set([30, 120, 230, 255], p * 4);
  const ico = buildIco([bmpFrame(colour, { bpp: 24, mask: false })]);
  const r = await runHarvest({ targets: only('protocols'), overrides: {} }, { profile: 'launcher', mode: 'follow', now: NOW }, siteIo({ [PROTOCOLS]: head, [PROTOCOLS + 'favicon.ico']: ico }));
  assert.equal(r.report.items[0].tintSource, undefined);
});

await check('a locked tint from the previous manifest beats the catalogue gradient', async () => {
  const first = await runHarvest({ targets: only('protocols'), overrides: {} }, { profile: 'launcher', mode: 'follow', now: NOW }, protocolsIo());
  const files = { ...first.export.files };
  const manifest = JSON.parse(new TextDecoder().decode(files['manifest.v2.json']));
  manifest.icons.protocols.locked = true;
  manifest.icons.protocols.tint = ['#2b6fd6', '#a8c6f5', '#14346b'];
  files['manifest.v2.json'] = new TextEncoder().encode(JSON.stringify(manifest));
  const again = await runHarvest({ targets: only('protocols'), overrides: {} }, { profile: 'launcher', mode: 'follow', now: NOW }, protocolsIo({ readOutput: async (name) => files[name] || null }));
  assert.equal(again.records[0].locked, true);
  assert.equal(again.records[0].tint[0], '#2b6fd6');
});

await check('closed apps are harvested as usual and flagged in the report', async () => {
  const r = await runHarvest({ targets: only('ledger-form--tally'), overrides: {} }, { profile: 'launcher', mode: 'follow', now: NOW }, siteIo({ 'https://slippery-form-2-2.vercel.app/': head, 'https://slippery-form-2-2.vercel.app/favicon.ico': blackBook }));
  assert.equal(r.report.items[0].closed, true);
  assert.equal(r.report.items[0].status, 'found');
});

const absent = (extra) => siteIo({}, extra);
const faRun = (options, io) => runHarvest({ targets: only('protocols'), overrides: {} }, { profile: 'launcher', mode: 'follow', now: NOW, ...options }, io || absent());

await check('with the fallback on, a missing favicon becomes a FontAwesome override', async () => {
  const r = await faRun({ faFallback: true });
  const item = r.report.items[0];
  assert.equal(item.status, 'override');
  assert.equal(item.harvest, 'notfound');
  assert.equal(item.fa, 'fa-folder-open');
  assert.deepEqual(item.source, { type: 'fa-fallback', href: 'fa-folder-open' });
  const manifest = JSON.parse(new TextDecoder().decode(r.export.files['manifest.v2.json']));
  assert.equal(manifest.icons.protocols.status, 'override');
  assert.equal(manifest.icons.protocols.favicon, null);
});

await check('with the fallback off, a missing favicon stays missing', async () => {
  const r = await faRun({});
  assert.equal(r.report.items[0].status, 'notfound');
  assert.equal(r.report.items[0].fa, undefined);
});

await check('the fallback never covers a blocked page', async () => {
  const blocked = siteIo({}, { fetchBytes: async (url) => ({ ok: false, status: 403, url, bytes: new Uint8Array(), mitigated: null }) });
  const r = await faRun({ faFallback: true }, blocked);
  assert.equal(r.report.items[0].status, 'blocked');
  assert.equal(r.report.items[0].harvest, 'blocked');
  assert.equal(r.report.items[0].fa, undefined);
});

await check('a Netlify password prompt answering 401 is reported as blocked, with its favicon link ignored', async () => {
  const prompt = '<!DOCTYPE html><html><head><title>Password protected</title><link rel="icon" href="/netlify.ico"></head><body></body></html>';
  const netlify = siteIo({}, {
    fetchBytes: async (url) => ({ ok: false, status: 401, url, bytes: new TextEncoder().encode(prompt), mitigated: null })
  });
  const r = await faRun({ faFallback: true }, netlify);
  assert.equal(r.report.items[0].status, 'blocked');
  assert.equal(r.report.items[0].fa, undefined);
});

await check('the fallback does not replace an entry kept from the previous manifest', async () => {
  const first = await runHarvest({ targets: only('protocols'), overrides: {} }, { profile: 'launcher', mode: 'follow', now: NOW }, protocolsIo());
  const files = first.export.files;
  const again = await faRun({ faFallback: true }, absent({ readOutput: async (name) => files[name] || null }));
  assert.equal(again.report.items[0].status, 'stale');
  assert.equal(again.report.items[0].fa, undefined);
});

await check('the CLI accepts --fa-fallback and leaves it off by default', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hs-fa-'));
  const catalogue = { categories: [{ id: 'core', label: 'Core', apps: [{ id: 'protocols', title: 'Protocols', url: PROTOCOLS, icon: 'fa-folder-open', gradient: ['#cf8350', '#fdba74', '#7c2d12'] }] }] };
  await fs.writeFile(path.join(dir, 'links.json'), JSON.stringify(catalogue));
  await fs.mkdir(path.join(dir, 'empty'));
  const cli = path.join(studioDir, 'cli', 'harvest.mjs');
  const run = (flag, out) => spawnSync(process.execPath, [cli, '--from', path.join(dir, 'empty'), '--out', path.join(dir, out), ...flag], { cwd: dir, encoding: 'utf8' });
  const off = run([], 'off');
  const on = run(['--fa-fallback'], 'on');
  assert.equal(off.status, 0);
  assert.equal(on.status, 0);
  const manifestOf = async (out) => JSON.parse(await fs.readFile(path.join(dir, out, 'manifest.v2.json'), 'utf8'));
  assert.equal(Object.keys((await manifestOf('off')).icons).length, 0);
  assert.equal((await manifestOf('on')).icons.protocols.status, 'override');
});

finish();
