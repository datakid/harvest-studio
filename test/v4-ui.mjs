import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { unzipSync } from '../node_modules/fflate/esm/browser.js';
import { chromium } from 'playwright-core';
import { serve } from '../scripts/serve.mjs';
import { check, finish, fixturesDir, localIo, NOW } from './util.mjs';
import * as core from '../core/index.js';
import { Readable } from 'node:stream';
import { createHandler } from '../api/fetch.js';

const files = fs.readdirSync(fixturesDir).filter((f) => f.endsWith('.png')).map((f) => path.join(fixturesDir, f));
const proxy = createHandler({ resolve: async () => [{ address: '93.184.216.34', family: 4 }], request: async () => ({ status: 404, headers: {}, body: Readable.from([Buffer.from('')]), destroy() {} }), env: {} });
const server = await serve(4207, proxy);
const exe = fs.readdirSync('/opt/pw-browsers').filter((d) => d.startsWith('chromium-')).flatMap((d) => ['chrome-linux64', 'chrome-linux'].map((s) => '/opt/pw-browsers/' + d + '/' + s + '/chrome')).find((p) => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const logs = [];
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
page.on('console', (m) => m.type() === 'error' && logs.push(m.text()));
page.on('pageerror', (e) => logs.push(e.message));
await page.goto('http://localhost:4207/');

const download = async () => {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download .zip' }).click()]);
  return unzipSync(new Uint8Array(fs.readFileSync(await dl.path())));
};
const strip = (m) => {
  const copy = JSON.parse(JSON.stringify(m));
  delete copy.generatedAt;
  for (const e of Object.values(copy.icons)) delete e.checkedAt;
  return copy;
};
const targets = files.map((f) => {
  const key = path.basename(f, '.png');
  return { key, appId: key };
});

await check('T10.1 the intake screen offers the launcher format and defaults to the current v3', async () => {
  await page.waitForSelector('#target-pick');
  assert.equal(await page.getByRole('radio', { name: 'Current (v3)' }).getAttribute('aria-checked'), 'true');
  assert.equal(await page.getByRole('radio', { name: 'New look (v4)' }).getAttribute('aria-checked'), 'false');
  assert.deepEqual(logs, []);
});

await check('T10.2 choosing v4 is remembered and explained', async () => {
  await page.getByRole('radio', { name: 'New look (v4)' }).click();
  assert.equal(await page.getByRole('radio', { name: 'New look (v4)' }).getAttribute('aria-checked'), 'true');
  assert.match(await page.locator('#target-pick .hint-text').innerText(), /192 px/);
  assert.equal(await page.evaluate(() => window.__studio.prefs.target), 'v4');
});

await page.setInputFiles('#pick-files', files);
await page.waitForSelector('.chip');
await page.evaluate(() => { window.__studio.state.seed = '1f2e3d4c'; });
await page.click('#go');
await page.waitForFunction(() => window.__studio && window.__studio.state.stage === 'work', null, { timeout: 120000 });
await page.waitForTimeout(1500);

await check('T10.3 the harvested set is marked v4 and keeps 192 px two-layer marks for tiles', async () => {
  assert.equal(await page.evaluate(() => window.__studio.state.target), 'v4');
  const layered = await page.evaluate(() => [...window.__studio.state.records.values()].filter((r) => r.trace && r.trace.layers && r.trace.layers.length === 2).length);
  assert.ok(layered >= 1, String(layered));
  assert.ok(await page.locator('.cell').count() >= files.length);
});

await check('T10.4 the export dialog says v4 and the downloaded manifest matches the Node v4 run', async () => {
  await page.getByRole('button', { name: 'Export' }).click();
  await page.waitForSelector('dialog .gate', { timeout: 120000 });
  assert.match(await page.locator('#exp-format').innerText(), /v4/);
  assert.equal(await page.locator('#exp-mismatch').count(), 0);
  const zip = await download();
  const bm = JSON.parse(Buffer.from(zip['icons/manifest.v2.json']).toString('utf8'));
  for (const e of Object.values(bm.icons)) assert.ok(e.ink > 0 && e.bbox.length === 4 && (e.layers === 1 || e.layers === 2));
  const node = await core.runHarvest({ targets, overrides: {} }, { local: true, now: NOW, seed: '1f2e3d4c', target: 'v4' }, localIo());
  assert.deepEqual(strip(bm).icons, strip(node.export.manifest).icons);
  assert.equal(bm.hash, node.export.manifest.hash);
  const sprite = Object.keys(zip).find((n) => /glyphs\.[0-9a-f]{8}\.svg$/.test(n));
  const nodeSprite = Object.keys(node.export.files).find((n) => /^glyphs\./.test(n));
  assert.equal(Buffer.from(zip[sprite]).toString('utf8'), Buffer.from(node.export.files[nodeSprite]).toString('utf8'));
  assert.ok(Buffer.from(zip[sprite]).toString('utf8').includes('var(--lx-ga,currentColor)'));
  const report = JSON.parse(Buffer.from(zip['icons/harvest-report.json']).toString('utf8'));
  assert.equal(report.target, 'v4');
});

await check('T10.5 switching the choice after harvesting does not change the set and the export says so', async () => {
  await page.keyboard.press('Escape');
  await page.evaluate(() => { window.__studio.prefs.target = 'v3'; });
  await page.getByRole('button', { name: 'Export' }).click();
  await page.waitForSelector('#exp-mismatch');
  assert.match(await page.locator('#exp-mismatch').innerText(), /harvested as v4/);
  assert.equal(await page.evaluate(() => window.__studio.state.target), 'v4');
  await page.keyboard.press('Escape');
});

await check('T10.5b a hand-picked colour is brought inside the v4 rules and the v4 choice survives a reload', async () => {
  const key = await page.evaluate(() => window.__studio.state.order[3]);
  await page.locator('.cell[data-key="' + key + '"]').click();
  await page.locator('.sel-head ~ .colour-row input[type=color]').evaluate((el) => {
    el.value = '#ffd400';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.fill('.proj-name', 'V4 set');
  await page.waitForFunction(() => window.__studio.saved >= 1, null, { timeout: 15000 });
  await page.waitForTimeout(1200);
  const tint = await page.evaluate((k) => window.__studio.state.records.get(k).tint, key);
  assert.deepEqual(core.v4Violations(tint), []);
  const back = await ctx.newPage();
  back.on('pageerror', (e) => logs.push(e.message));
  await back.goto('http://localhost:4207/');
  await back.waitForSelector('.recent');
  await back.locator('.recent').first().click();
  await back.waitForFunction(() => window.__studio && window.__studio.state.stage === 'work', null, { timeout: 120000 });
  assert.equal(await back.evaluate(() => window.__studio.state.target), 'v4');
  assert.deepEqual(await back.evaluate((k) => window.__studio.state.records.get(k).tint, key), tint);
  await back.close();
});

await check('T10.6 a v3 harvest in a fresh page still exports the current format with no v4 fields', async () => {
  const fresh = await ctx.newPage();
  fresh.on('pageerror', (e) => logs.push(e.message));
  await fresh.goto('http://localhost:4207/');
  await fresh.evaluate(() => localStorage.clear());
  await fresh.reload();
  await fresh.setInputFiles('#pick-files', files);
  await fresh.waitForSelector('.chip');
  await fresh.evaluate(() => { window.__studio.prefs.target = 'v3'; window.__studio.state.seed = '1f2e3d4c'; });
  await fresh.click('#go');
  await fresh.waitForFunction(() => window.__studio && window.__studio.state.stage === 'work', null, { timeout: 120000 });
  await fresh.waitForTimeout(1500);
  await fresh.getByRole('button', { name: 'Export' }).click();
  await fresh.waitForSelector('dialog .gate', { timeout: 120000 });
  const [dl] = await Promise.all([fresh.waitForEvent('download'), fresh.getByRole('button', { name: 'Download .zip' }).click()]);
  const zip = unzipSync(new Uint8Array(fs.readFileSync(await dl.path())));
  const m = JSON.parse(Buffer.from(zip['icons/manifest.v2.json']).toString('utf8'));
  for (const e of Object.values(m.icons)) for (const k of ['ink', 'bbox', 'layers', 'tintRole']) assert.ok(!(k in e), k);
  assert.deepEqual(logs, []);
});

await browser.close();
server.close();
finish();
