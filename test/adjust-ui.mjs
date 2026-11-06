import { chromiumPath } from './util.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { unzipSync } from '../node_modules/fflate/esm/browser.js';
import { chromium } from 'playwright-core';
import { serve } from '../scripts/serve.mjs';
import { check, finish, fixturesDir } from './util.mjs';
import { Readable } from 'node:stream';
import { createHandler } from '../api/fetch.js';

const files = fs.readdirSync(fixturesDir).filter((f) => f.endsWith('.png')).map((f) => path.join(fixturesDir, f));
const proxy = createHandler({ resolve: async () => [{ address: '93.184.216.34', family: 4 }], request: async () => ({ status: 404, headers: {}, body: Readable.from([Buffer.from('')]), destroy() {} }), env: {} });
const server = await serve(4231, proxy);
const browser = await chromium.launch({ executablePath: chromiumPath(), args: ['--no-sandbox'] });
const logs = [];
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
page.on('console', (m) => m.type() === 'error' && logs.push(m.text()));
page.on('pageerror', (e) => logs.push(e.message));
await page.goto('http://localhost:4231/');
await page.setInputFiles('#pick-files', files);
await page.waitForSelector('.chip');
await page.click('#go');
await page.waitForFunction(() => window.__studio && window.__studio.state.stage === 'work', null, { timeout: 120000 });
await page.waitForTimeout(1200);

const key = await page.evaluate(() => [...window.__studio.state.records.values()].find((r) => r.trace && r.trace.accepted && r.hasImage).key);
const adjustOf = () => page.evaluate((k) => window.__studio.state.records.get(k).adjust, key);
const maskOf = () => page.evaluate((k) => window.__studio.state.records.get(k).mask, key);
const setRange = async (id, value) => {
  await page.evaluate(([i, v]) => {
    const el = document.getElementById(i);
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, [id, value]);
};
const waitAdjust = (fn, arg) => page.waitForFunction(fn, arg, { timeout: 20000 });

await page.click('.cell[data-key="' + key + '"]');
await page.waitForSelector('#adjust-panel');
const before = await maskOf();

await check('AU1 the inspector shows the adjust controls for the selected icon', async () => {
  for (const id of ['adj-scale', 'adj-offset-x', 'adj-offset-y', 'adj-weight', 'adj-invert', 'adj-exclude']) assert.equal(await page.locator('#' + id).count(), 1, id);
  assert.equal(await page.locator('#adj-twotone').count(), 0);
  assert.equal(await page.locator('#adj-reset').count(), 0);
  assert.equal(await adjustOf(), null);
});

await check('AU2 moving the size slider re-renders the glyph live and shows a reset', async () => {
  await setRange('adj-scale', 55);
  await waitAdjust((k) => { const a = window.__studio.state.records.get(k).adjust; return a && Math.abs(a.scale - 0.55) < 0.001; }, key);
  assert.notEqual(await maskOf(), before);
  await page.waitForSelector('#adj-reset');
  assert.equal(await page.locator('#adjust-panel .adj-dot').count() >= 1, true);
});

await check('AU3 undo and redo step the adjustment back and forth, from buttons and from the keyboard', async () => {
  assert.equal(await page.locator('#undo-btn').isDisabled(), false);
  await page.click('#undo-btn');
  await waitAdjust((k) => window.__studio.state.records.get(k).adjust === null, key);
  assert.equal(await page.locator('#redo-btn').isDisabled(), false);
  await page.click('#redo-btn');
  await waitAdjust((k) => { const a = window.__studio.state.records.get(k).adjust; return a && a.scale === 0.55; }, key);
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press('Control+z');
  await waitAdjust((k) => window.__studio.state.records.get(k).adjust === null, key);
  await page.keyboard.press('Control+Shift+z');
  await waitAdjust((k) => { const a = window.__studio.state.records.get(k).adjust; return a && a.scale === 0.55; }, key);
});

await check('AU4 a render choice and a background choice are stored and one reset clears everything', async () => {
  await page.getByRole('radio', { name: 'Image' }).click();
  await waitAdjust((k) => window.__studio.state.records.get(k).adjust.render === 'image', key);
  await page.getByRole('radio', { name: 'Keep' }).click();
  await waitAdjust((k) => window.__studio.state.records.get(k).adjust.background === 'keep', key);
  await page.click('#adj-reset');
  await waitAdjust((k) => window.__studio.state.records.get(k).adjust === null, key);
});

await check('AU5 leaving an icon out dims its tile and removes it from the launcher export', async () => {
  await page.locator('#adj-exclude').check();
  await waitAdjust((k) => window.__studio.state.records.get(k).adjust && window.__studio.state.records.get(k).adjust.exclude === true, key);
  assert.ok((await page.locator('.cell[data-key="' + key + '"]').getAttribute('class')).includes('excluded'));
  await page.getByRole('button', { name: /^Export/ }).click();
  await page.waitForSelector('dialog .gate', { timeout: 120000 });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download .zip' }).click()]);
  const zip = unzipSync(new Uint8Array(fs.readFileSync(await dl.path())));
  const manifest = JSON.parse(Buffer.from(zip['icons/manifest.v2.json']).toString('utf8'));
  assert.ok(!(key in manifest.icons));
  assert.ok(Object.keys(manifest.icons).length >= files.length - 1 - 3);
  await page.keyboard.press('Escape');
});

await check('AU6 adjustments are saved with the project and come back after a reload', async () => {
  await setRange('adj-scale', 60);
  await waitAdjust((k) => window.__studio.state.records.get(k).adjust.scale === 0.6, key);
  await page.waitForFunction(() => window.__studio.state.unsaved === false, null, { timeout: 20000 });
  await page.reload();
  await page.waitForSelector('.recent');
  await page.click('.recent');
  await page.waitForFunction(() => window.__studio && window.__studio.state.stage === 'work', null, { timeout: 60000 });
  const a = await adjustOf();
  assert.equal(a.scale, 0.6);
  assert.equal(a.exclude, true);
});

await check('AU7 no console errors', () => assert.deepEqual(logs.filter((l) => !/Failed to load resource/.test(l)), []));

await browser.close();
server.close();
finish();
