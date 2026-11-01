import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { check, finish, fixturesDir, studioDir } from './util.mjs';
import { runHarvest, rasterSvg, forceLightScheme, hexToLab, deltaE, tintFromHex } from '../core/index.js';

const NOW = '2026-01-01T00:00:00.000Z';
const SITE = 'https://lx-search-test.example/';
const enc = (s) => new TextEncoder().encode(s);

const jpeg = new Uint8Array(await fs.readFile(path.join(fixturesDir, 'pages', 'dark-touch.jpg')));
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><style>.a{stroke:#6c58d4}.b{stroke:#b9aee6}@media (prefers-color-scheme: dark){.a{stroke:#101018}.b{stroke:#ffffff}}</style><path class="a" d="M12 52 L32 12" stroke-width="9" stroke-linecap="round" fill="none"/><path class="b" d="M30 52 L52 12" stroke-width="9" stroke-linecap="round" fill="none"/></svg>';
const lightSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><style>.a{fill:#101018}@media (prefers-color-scheme: light){.a{fill:#6c58d4}}@media (prefers-color-scheme: dark){.a{fill:#ffffff}}</style><rect class="a" x="8" y="8" width="48" height="48"/></svg>';
const page = '<!DOCTYPE html><html><head><link rel="apple-touch-icon" href="/touch.jpg"><link rel="icon" type="image/svg+xml" href="/favicon.svg"></head><body></body></html>';
const pageNoSvg = '<!DOCTYPE html><html><head><link rel="apple-touch-icon" href="/touch.jpg"></head><body></body></html>';

const make = (files, log = []) => ({
  fetchBytes: async (url) => {
    log.push(url);
    const hit = files[url];
    if (hit === undefined) return { ok: false, status: 404, url, bytes: new Uint8Array(), mitigated: null };
    return { ok: true, status: 200, url, bytes: typeof hit === 'string' ? enc(hit) : hit, mitigated: null };
  },
  readLocal: async () => null,
  readOverride: async () => null,
  readOutput: async () => null
});

const target = { key: 'drug-list--full', appId: 'drug-list', variantId: 'full', url: SITE };
const run = (files, extra = {}, log = []) => runHarvest({ targets: [target], overrides: {}, ...extra }, { profile: 'launcher', mode: 'follow', now: NOW }, make(files, log));
const files = { [SITE]: page, [SITE + 'touch.jpg']: jpeg, [SITE + 'favicon.svg']: svg };

const pixelAt = (img, x, y) => [...img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];

await check('T3.2a a jpeg touch icon loses to the svg icon and the decision is recorded', async () => {
  const r = await run(files);
  const item = r.report.items[0];
  assert.equal(item.source.type, 'svg');
  const used = item.attempts.find((a) => a.status === 'used');
  assert.equal(used.reason, 'preferred svg over jpeg touch icon');
  const touch = item.attempts.find((a) => a.type === 'apple-touch-icon');
  assert.equal(touch.status, 'rejected');
});

await check('T3.2b the tint is the svg violet, not the dull touch icon colour', async () => {
  const r = await run(files);
  const tint = r.report.items[0].tint[0];
  assert.ok(deltaE(hexToLab(tint), hexToLab(tintFromHex('#6c58d4')[0])) <= 0.03, tint);
  assert.ok(deltaE(hexToLab(tint), hexToLab(tintFromHex('#908abd')[0])) > 0.03, tint);
});

await check('T3.2a the touch icon is kept when the page declares no svg', async () => {
  const r = await run({ [SITE]: pageNoSvg, [SITE + 'touch.jpg']: jpeg });
  assert.equal(r.report.items[0].source.type, 'apple-touch-icon');
});

await check('T3.2a a plain png touch icon is kept even when an svg exists', async () => {
  const png = new Uint8Array(await fs.readFile(path.join(fixturesDir, 'draw.png')));
  const r = await run({ ...files, [SITE + 'touch.jpg']: png });
  assert.equal(r.report.items[0].source.type, 'apple-touch-icon');
});

await check('T3.2c dark-scheme rules are dropped and light-scheme rules are applied', async () => {
  const stripped = forceLightScheme(lightSvg);
  assert.ok(!/dark/.test(stripped));
  assert.ok(!/@media/.test(stripped));
  const img = await rasterSvg(lightSvg, { width: 64 });
  assert.deepEqual(pixelAt(img, 32, 32), [0x6c, 0x58, 0xd4, 255]);
  const strokes = await rasterSvg(svg, { width: 64 });
  const px = pixelAt(strokes, 22, 32);
  assert.ok(px[3] === 255 && px[2] > 150, String(px));
});

await check('T3.2c nested braces and several blocks are removed cleanly', () => {
  const css = '<style>.a{fill:red}@media (prefers-color-scheme: dark){.a{fill:blue}.b{fill:green}}.c{fill:black}@media (min-width:1px) and (prefers-color-scheme: dark){.c{fill:white}}</style>';
  assert.equal(forceLightScheme(css), '<style>.a{fill:red}.c{fill:black}</style>');
});

await check('T3.2d a pin overrides discovery and is recorded as pinned', async () => {
  const log = [];
  const pinned = { ...files, [SITE + 'other.svg']: svg };
  const r = await run(pinned, { pins: { 'drug-list--full': { href: SITE + 'other.svg' } } }, log);
  const item = r.report.items[0];
  assert.equal(item.source.type, 'pinned');
  assert.equal(item.source.href, SITE + 'other.svg');
  assert.deepEqual(log, [SITE + 'other.svg']);
  assert.equal(item.attempts[0].reason, 'pinned source');
});

await check('T3.2d a pin that cannot be read falls back to discovery and says so', async () => {
  const r = await run(files, { pins: { 'drug-list--full': { href: SITE + 'missing.svg' } } });
  const item = r.report.items[0];
  assert.equal(item.attempts[0].type, 'pinned');
  assert.equal(item.attempts[0].status, 'failed');
  assert.equal(item.source.type, 'svg');
});

await check('the shipped pin points Drug List Full at its svg', async () => {
  const pins = JSON.parse(await fs.readFile(path.join(studioDir, 'config', 'source-pins.json'), 'utf8'));
  assert.deepEqual(pins, { 'drug-list--full': { href: 'https://lx-search-kappa.vercel.app/favicon.svg' } });
  const catalogue = JSON.parse(await fs.readFile(path.join(studioDir, 'config', 'catalogue.json'), 'utf8'));
  const keys = catalogue.categories.flatMap((c) => c.apps.flatMap((a) => (a.variants || []).map((v) => a.id + '--' + v.id)));
  assert.ok(keys.includes('drug-list--full'));
});

finish();
