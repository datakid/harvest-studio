import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { check, finish, fixturesDir } from './util.mjs';
import { runHarvest } from '../core/index.js';
import { bookImage, bmpFrame, buildIco } from './ico-fixtures.mjs';

const NOW = '2026-01-01T00:00:00.000Z';
const SITE = 'https://folio.example/';
const small = buildIco([bmpFrame(bookImage(48), { bpp: 32, alpha: 'real' })]);
const large = buildIco([bmpFrame(bookImage(64), { bpp: 32, alpha: 'real' }), bmpFrame(bookImage(48), { bpp: 32, alpha: 'real' })]);
const png = new Uint8Array(await fs.readFile(path.join(fixturesDir, 'roi--full.png')));
const page = '<!DOCTYPE html><html><head><link rel="icon" type="image/x-icon" href="/favicon.ico"></head><body></body></html>';

const make = (files, log = []) => ({
  fetchBytes: async (url) => {
    log.push(url);
    const hit = files[url];
    if (hit === undefined) return { ok: false, status: 404, url, bytes: new Uint8Array(), mitigated: null };
    return { ok: true, status: 200, url, bytes: typeof hit === 'string' ? new TextEncoder().encode(hit) : hit, mitigated: null };
  },
  readLocal: async () => null,
  readOverride: async () => null,
  readOutput: async () => null
});
const target = { key: 'ledger-form--folio', appId: 'ledger-form', variantId: 'folio', url: SITE };
const run = async (files, log) => (await runHarvest({ targets: [target], overrides: {} }, { profile: 'launcher', mode: 'follow', now: NOW, preview: true }, make(files, log))).report.items[0];

await check('T3.7 a 48 px ico that is the only source is kept and flagged low-res after the well-known paths fail', async () => {
  const log = [];
  const item = await run({ [SITE]: page, [SITE + 'favicon.ico']: small }, log);
  assert.equal(item.source.type, 'ico');
  assert.deepEqual(item.flags, ['low-res']);
  assert.ok(log.includes(SITE + 'apple-touch-icon.png'));
  assert.ok(log.includes(SITE + 'logo192.png'));
  assert.ok(item.attempts.some((a) => a.type === 'well-known' && a.status === 'failed'));
  assert.equal(item.attempts[item.attempts.length - 1].type, 'ico');
  assert.equal(item.attempts[item.attempts.length - 1].status, 'used');
});

await check('T3.7 a well-known path with a real icon beats the low-res ico', async () => {
  const item = await run({ [SITE]: page, [SITE + 'favicon.ico']: small, [SITE + 'apple-touch-icon.png']: png });
  assert.equal(item.source.type, 'well-known');
  assert.equal(item.flags, undefined);
  assert.equal(item.attempts.find((a) => a.status === 'used').reason, 'well-known path beats low-res ico');
});

await check('T3.7 an ico of 64 px or more is accepted at once with no probing and no flag', async () => {
  const log = [];
  const item = await run({ [SITE]: page, [SITE + 'favicon.ico']: large }, log);
  assert.equal(item.source.type, 'ico');
  assert.equal(item.flags, undefined);
  assert.ok(!log.includes(SITE + 'apple-touch-icon.png'));
});

await check('T3.7 a png icon is not treated as low-res', async () => {
  const pngPage = '<!DOCTYPE html><html><head><link rel="icon" type="image/png" href="/i.png"></head></html>';
  const log = [];
  const item = await run({ [SITE]: pngPage, [SITE + 'i.png']: png }, log);
  assert.equal(item.flags, undefined);
  assert.ok(!log.includes(SITE + 'apple-touch-icon.png'));
});

finish();
