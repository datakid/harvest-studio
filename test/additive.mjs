import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { unzipSync } from '../node_modules/fflate/esm/browser.js';
import { chromium } from 'playwright-core';
import { serve } from '../scripts/serve.mjs';
import { check, finish, fixturesDir } from './util.mjs';
import { createHandler } from '../api/fetch.js';

const shots = process.env.SHOTS || null;
const png = (name) => fs.readFileSync(path.join(fixturesDir, name + '.png'));
const names = fs.readdirSync(fixturesDir).filter((f) => f.endsWith('.png')).map((f) => f.replace(/\.png$/, '')).sort();
const first5 = names.slice(0, 5);
const next3 = names.slice(5, 8);
const file = (name) => ({ name: name + '.png', mimeType: 'image/png', buffer: png(name) });

const hosts = {
  'https://added.example.com/': ['dafter', 'text/html'],
  'https://one.example.com/': ['criteria-builder--meridian', 'text/html'],
  'https://two.example.com/': ['solver', 'text/html']
};
const site = {};
for (const [url, [fixture]] of Object.entries(hosts)) {
  site[url] = { type: 'text/html', body: Buffer.from('<html><head><link rel="icon" type="image/png" sizes="192x192" href="/icon.png"></head></html>') };
  site[url + 'icon.png'] = { type: 'image/png', body: png(fixture) };
}
const proxy = createHandler({
  resolve: async () => [{ address: '93.184.216.34', family: 4 }],
  request: async ({ url }) => {
    const hit = site[url.href];
    if (!hit) return { status: 404, headers: { 'content-type': 'text/html' }, body: Readable.from([Buffer.from('missing')]), destroy() {} };
    return { status: 200, headers: { 'content-type': hit.type }, body: Readable.from([hit.body]), destroy() {} };
  },
  env: { STUDIO_TOKEN: 'add-token' }
});
const server = await serve(4204, proxy);
const exe = fs.readdirSync('/opt/pw-browsers').filter((d) => d.startsWith('chromium-')).flatMap((d) => ['chrome-linux64', 'chrome-linux'].map((s) => '/opt/pw-browsers/' + d + '/' + s + '/chrome')).find((p) => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const errors = [];

const open = async (viewport = { width: 1440, height: 1000 }) => {
  const ctx = await browser.newContext({ viewport, colorScheme: 'light', acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    if (!localStorage.getItem('hs:prefs')) localStorage.setItem('hs:prefs', JSON.stringify({ proxyUrl: 'http://localhost:4204/api/fetch' }));
    sessionStorage.setItem('hs:token', 'add-token');
  });
  await page.goto('http://localhost:4204/');
  await page.waitForSelector('#pick-files', { state: 'attached' });
  return { page, ctx };
};
const harvestFiles = async (page, list) => {
  await page.setInputFiles('#pick-files', list.map(file));
  await page.waitForSelector('.chip');
  await page.click('#go');
  await page.waitForFunction(() => window.__studio && window.__studio.state.stage === 'work', null, { timeout: 120000 });
  await page.waitForFunction((n) => document.querySelectorAll('.gallery .cell .tile-art:not(.ghost)').length === n, list.length, { timeout: 120000 });
  await page.waitForTimeout(1600);
};
const settled = (page, n) => page.waitForFunction((count) => document.querySelectorAll('.gallery .cell .tile-art:not(.ghost)').length === count && document.body.dataset.adding === '0', n, { timeout: 120000 });
const recs = (page) => page.evaluate(() => [...window.__studio.state.records.values()].filter((r) => r.hasImage).map((r) => ({ key: r.key, tint: r.tint, hash: r.hash, locked: r.locked })).sort((a, b) => (a.key < b.key ? -1 : 1)));
const shot = async (page, name) => shots && (await page.screenshot({ path: path.join(shots, name + '.png') }));

const { page, ctx } = await open();
await harvestFiles(page, first5);
const before = await recs(page);

await check('T5.1 adding three files from the work view gives eight tiles and leaves the first five untouched', async () => {
  assert.equal(before.length, 5);
  await page.setInputFiles('#add-pick-files', next3.map(file));
  await settled(page, 8);
  const after = await recs(page);
  assert.equal(after.length, 8);
  for (const b of before) assert.deepEqual(after.find((a) => a.key === b.key), b);
  await shot(page, 'add-desktop');
});

await check('T5.2 a pasted address adds one ghost tile within 300 ms and the old tiles are not re-rendered', async () => {
  const ids = await page.$$eval('.cell', (els) => Object.fromEntries(els.map((e) => [e.dataset.key, e.dataset.renderId])));
  await page.evaluate(() => {
    window.__seen = null;
    new MutationObserver((list) => {
      for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1 && n.querySelector && n.querySelector('.cell') && !window.__seen) window.__seen = { at: performance.now(), ghost: !!n.querySelector('.tile-art.ghost') };
    }).observe(document.querySelector('.gallery'), { childList: true });
    window.__clickAt = 0;
  });
  await page.fill('#add-urls', 'https://added.example.com/');
  await page.evaluate(() => { window.__clickAt = performance.now(); });
  await page.click('#add-go');
  await page.waitForFunction(() => window.__seen, null, { timeout: 2000 });
  const seen = await page.evaluate(() => ({ ...window.__seen, lag: window.__seen.at - window.__clickAt }));
  assert.equal(seen.ghost, true);
  assert.ok(seen.lag < 300, 'ghost took ' + seen.lag + ' ms');
  await settled(page, 9);
  const now = await page.$$eval('.cell', (els) => Object.fromEntries(els.map((e) => [e.dataset.key, e.dataset.renderId])));
  for (const [k, v] of Object.entries(ids)) assert.equal(now[k], v, k + ' was re-rendered');
});

await check('T5.3 a json with two new entries and one already present asks and Skip leaves only the two new tiles added', async () => {
  const n = (await recs(page)).length;
  const json = { categories: [{ id: 'extra', label: { en: 'Extra' }, icon: 'fa-star', accent: '#7c9bff', apps: [
    { id: 'jone', title: { en: 'Jone' }, icon: 'fa-star', url: 'https://one.example.com/' },
    { id: 'jtwo', title: { en: 'Jtwo' }, icon: 'fa-star', url: 'https://two.example.com/' },
    { id: first5[0], title: { en: 'Present' }, icon: 'fa-star', url: 'https://' + first5[0] + '.example.com/' }
  ] }] };
  await page.setInputFiles('#add-pick-json', [{ name: 'more.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(json)) }]);
  await page.waitForSelector('#collide-dialog[open]');
  for (const id of ['#collide-update', '#collide-both', '#collide-skip']) assert.equal(await page.locator(id).count(), 1);
  await page.click('#collide-skip');
  await settled(page, n + 2);
  assert.equal((await recs(page)).length, n + 2);
});

await check('T5.4 remove a tile, press Undo, and it comes back with the same tint and lock', async () => {
  await page.locator('.cell[data-key="' + first5[1] + '"]').click();
  await page.getByRole('button', { name: 'Keep this colour' }).click();
  const was = (await recs(page)).find((r) => r.key === first5[1]);
  assert.equal(was.locked, true);
  const count = (await recs(page)).length;
  await page.locator('[data-act="remove"]').click();
  await page.waitForFunction((n) => document.querySelectorAll('.cell').length === n - 1, count);
  await page.locator('[data-act="toast-action"]').click();
  await page.waitForFunction((n) => document.querySelectorAll('.cell').length === n, count);
  const now = (await recs(page)).find((r) => r.key === first5[1]);
  assert.deepEqual(now, was);
});

await check('T5.5 a locked tint stays put when a tile of the same colour is added in separate mode, and the new tile moves', async () => {
  await page.getByRole('radio', { name: 'Separate' }).click();
  const lockedBefore = (await recs(page)).find((r) => r.key === first5[1]);
  await page.setInputFiles('#add-pick-files', [{ name: 'twin.png', mimeType: 'image/png', buffer: png(first5[1]) }]);
  const n = (await recs(page)).length + 1;
  await settled(page, n);
  const all = await recs(page);
  assert.deepEqual(all.find((r) => r.key === first5[1]).tint, lockedBefore.tint);
  const twin = all.find((r) => r.key === 'twin');
  assert.ok(twin, 'twin tile exists');
  assert.notDeepEqual(twin.tint, lockedBefore.tint);
});

await check('T5.6 reload and open the project from Recent work: same keys, tints, locks and pins', async () => {
  await page.evaluate(() => { window.__studio.state.pins = { [[...window.__studio.state.records.keys()][0]]: { href: 'https://pinned.example.com/icon.svg' } }; });
  await page.locator('.cell').first().click();
  await page.getByRole('button', { name: 'Keep this colour' }).click();
  await page.waitForFunction(() => window.__studio.state.unsaved === false && window.__studio.saved > 0, null, { timeout: 15000 });
  const was = await recs(page);
  const pins = await page.evaluate(() => window.__studio.state.pins);
  await page.reload();
  await page.waitForSelector('.recent');
  await page.locator('.recent').first().click();
  await page.waitForSelector('.gallery .cell');
  await page.waitForFunction((n) => document.querySelectorAll('.gallery .cell .tile-art:not(.ghost)').length === n, was.length, { timeout: 60000 });
  const now = await recs(page);
  assert.deepEqual(now.map((r) => [r.key, r.tint, r.locked]), was.map((r) => [r.key, r.tint, r.locked]));
  assert.deepEqual(await page.evaluate(() => window.__studio.state.pins), pins);
});

await check('T5.7 dropping a file on the work view shows the overlay, adds the file and hides the overlay', async () => {
  const n = (await recs(page)).length;
  const b64 = png(names[9]).toString('base64');
  const make = (type) => page.evaluate(({ type, b64, name }) => {
    const dt = new DataTransfer();
    if (type !== 'dragleave') dt.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], name + '.png', { type: 'image/png' }));
    window.__dt = window.__dt || dt;
    const target = document.querySelector('.gallery');
    target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: window.__dt }));
  }, { type, b64, name: names[9] });
  await make('dragenter');
  await page.waitForSelector('#drop-overlay');
  await shot(page, 'add-drop-overlay');
  await make('drop');
  await page.waitForSelector('#drop-overlay', { state: 'detached' });
  await settled(page, n + 1);
  assert.equal((await recs(page)).length, n + 1);
});

await check('T5.8 the export zip after the additions holds every tile and the manifest lists every key', async () => {
  const keys = (await recs(page)).map((r) => r.key);
  assert.match(await page.locator('#export-btn').innerText(), new RegExp('\\(' + keys.length + '\\)'));
  await page.locator('#export-btn').click();
  await page.waitForSelector('dialog .gate', { timeout: 120000 });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download .zip' }).click()]);
  const zip = unzipSync(new Uint8Array(fs.readFileSync(await dl.path())));
  const manifest = JSON.parse(Buffer.from(zip['icons/manifest.v2.json']).toString('utf8'));
  assert.deepEqual(Object.keys(manifest.icons).sort(), keys.slice().sort());
  await page.keyboard.press('Escape');
});

await check('T5.9 the add bar wraps on a phone without horizontal scroll', async () => {
  const { page: phone } = await open({ width: 390, height: 844 });
  await harvestFiles(phone, first5.slice(0, 2));
  assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  const small = await phone.$$eval('#add-bar .btn, #add-bar input[type="text"]', (els) => els.filter((e) => e.offsetParent && e.getBoundingClientRect().height < 40).length);
  assert.equal(small, 0);
  await shot(phone, 'add-mobile');
});

await check('T5.10 the Arabic interface mirrors the add bar and the dialogs', async () => {
  const { page: ar } = await open();
  await harvestFiles(ar, first5.slice(0, 2));
  await ar.getByRole('button', { name: 'العربية' }).click();
  assert.equal(await ar.evaluate(() => document.documentElement.dir), 'rtl');
  assert.ok(await ar.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  const rtl = await ar.evaluate(() => {
    const input = document.getElementById('add-urls').getBoundingClientRect();
    const go = document.getElementById('add-go').getBoundingClientRect();
    return go.left < input.left;
  });
  assert.equal(rtl, true);
  await ar.setInputFiles('#add-pick-files', [file(first5[0])]);
  await ar.waitForSelector('#collide-dialog[open]');
  await shot(ar, 'add-rtl-dialog');
  await ar.click('#collide-skip');
});

await check('T5.11 Start over asks while changes are unsaved, Cancel keeps the work, and the project stays in Recent work', async () => {
  const { page: p2 } = await open();
  await harvestFiles(p2, first5.slice(0, 2));
  await p2.waitForFunction(() => window.__studio.state.unsaved === false && window.__studio.saved > 0, null, { timeout: 15000 });
  await p2.setInputFiles('#add-pick-files', [file(names[6])]);
  await settled(p2, 3);
  await p2.getByRole('button', { name: /Start over/ }).click();
  await p2.waitForSelector('#startover-dialog[open]');
  await p2.click('#startover-cancel');
  assert.equal(await p2.locator('.gallery .cell').count(), 3);
  await p2.getByRole('button', { name: /Start over/ }).click();
  await p2.click('#startover-ok');
  await p2.waitForSelector('.recent');
  assert.match(await p2.locator('.recent').first().innerText(), /3 icons/);
});

await check('no console errors', () => assert.deepEqual(errors, []));

await browser.close();
server.close();
finish();
