import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { serve } from '../scripts/serve.mjs';
import { check, finish } from './util.mjs';
import { createHandler } from '../api/fetch.js';

const shots = process.env.SHOTS || null;
const server = await serve(4203, createHandler({ resolve: async () => [{ address: '93.184.216.34', family: 4 }], request: async () => ({ status: 404, headers: {}, body: (await import('node:stream')).Readable.from([Buffer.from('')]), destroy() {} }), env: {} }));
const exe = fs.readdirSync('/opt/pw-browsers').filter((d) => d.startsWith('chromium-')).flatMap((d) => ['chrome-linux64', 'chrome-linux'].map((s) => '/opt/pw-browsers/' + d + '/' + s + '/chrome')).find((p) => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const errors = [];

const open = async (scheme) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: scheme });
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:4203/');
  await page.waitForSelector('#harvest-catalogue');
  await page.click('#harvest-catalogue');
  await page.waitForFunction(() => document.querySelectorAll('.gallery .cell').length === 34, null, { timeout: 120000 });
  await page.waitForSelector('.gallery .cell .tile-art:not(.ghost)', { timeout: 120000 });
  await page.waitForTimeout(2200);
  return page;
};
const shot = async (page, name, sel) => {
  if (!shots) return;
  const target = sel ? page.locator(sel) : page;
  await target.screenshot({ path: path.join(shots, name + '.png') });
};

const light = await open('light');

await check('the shipped catalogue opens in separate mode with 0 similar pairs in the toolbar', async () => {
  assert.equal(await light.getByRole('radio', { name: 'Separate' }).getAttribute('aria-checked'), 'true');
  assert.equal(await light.locator('#pairs').getAttribute('data-pairs'), '0');
  assert.equal(await light.locator('#pairs').innerText(), 'Similar pairs: 0');
});

await check('follow mode shows the old look-alikes in the counter and separate clears it again', async () => {
  await light.getByRole('radio', { name: 'Follow' }).click();
  await light.waitForTimeout(300);
  const follow = Number(await light.locator('#pairs').getAttribute('data-pairs'));
  assert.ok(follow > 0, 'follow pairs ' + follow);
  await shot(light, 'strip-before-light', '.gallery');
  await light.getByRole('radio', { name: 'Separate' }).click();
  await light.waitForTimeout(600);
  assert.equal(await light.locator('#pairs').getAttribute('data-pairs'), '0');
  await shot(light, 'strip-after-light', '.gallery');
});

await check('the polish dialog lists the checklist and four preview strips of 34 tiles', async () => {
  await light.click('#pairs');
  await light.waitForSelector('#polish-dialog[open]');
  const rows = await light.$$eval('#polish-dialog .checklist li', (els) => els.map((e) => ({ id: e.dataset.id, ok: e.classList.contains('ok') })));
  assert.deepEqual(rows.map((r) => r.id), ['safe', 'rounded', 'pairs', 'raster', 'contrast']);
  assert.ok(rows.find((r) => r.id === 'pairs').ok);
  assert.ok(rows.find((r) => r.id === 'safe').ok);
  assert.ok(rows.find((r) => r.id === 'rounded').ok);
  const strips = await light.$$eval('#polish-dialog .pstrip', (els) => els.map((e) => ({ tone: e.className.includes('dark') ? 'dark' : 'light', tiles: e.querySelectorAll('.tile-art').length, vivid: e.querySelectorAll('.tile-art.vivid').length })));
  assert.equal(strips.length, 4);
  for (const s of strips) assert.equal(s.tiles, 34);
  assert.deepEqual(strips.map((s) => s.vivid), [34, 34, 0, 0]);
  assert.deepEqual(strips.map((s) => s.tone), ['light', 'dark', 'light', 'dark']);
  await shot(light, 'strip-preview', '#polish-dialog');
  await light.keyboard.press('Escape');
  await light.waitForSelector('#polish-dialog', { state: 'detached' });
});

await check('the whole catalogue tile strip in the dark theme', async () => {
  const dark = await open('dark');
  assert.equal(await dark.locator('#pairs').getAttribute('data-pairs'), '0');
  await shot(dark, 'strip-after-dark', '.gallery');
});

await check('no console errors', () => assert.deepEqual(errors, []));

await browser.close();
server.close();
finish();
