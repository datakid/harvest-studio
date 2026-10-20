import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
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

finish();
