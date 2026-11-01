import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { chromium } from 'playwright-core';
import { serve } from '../scripts/serve.mjs';
import { check, finish, fixturesDir } from './util.mjs';
import { createHandler } from '../api/fetch.js';

const publicResolve = async () => [{ address: '93.184.216.34', family: 4 }];
const reply = (body, status = 200, type = 'text/html') => ({ status, headers: { 'content-type': type }, body: Readable.from([Buffer.from(body)]), destroy() {} });

const PIN_HOST = 'pin-demo.netlify.app';
const STALE_HOST = 'strong-snickerdoodle-02a92f.netlify.app';
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M12 52 L32 12" stroke="#6c58d4" stroke-width="9" stroke-linecap="round" fill="none"/><path d="M30 52 L52 12" stroke="#b9aee6" stroke-width="9" stroke-linecap="round" fill="none"/></svg>';
const jpeg = fs.readFileSync(path.join(fixturesDir, 'pages', 'dark-touch.jpg'));
const png = fs.readFileSync(path.join(fixturesDir, 'dafter.png'));
const live = { stale: true };

const site = (href) => {
  if (href === 'https://' + PIN_HOST + '/') return { type: 'text/html', body: '<html><head><link rel="apple-touch-icon" href="/touch.jpg"><link rel="icon" type="image/svg+xml" href="/favicon.svg"><link rel="alternate icon" type="image/png" href="/alt.png"></head></html>' };
  if (href === 'https://' + PIN_HOST + '/touch.jpg') return { type: 'image/jpeg', body: jpeg };
  if (href === 'https://' + PIN_HOST + '/favicon.svg') return { type: 'image/svg+xml', body: svg };
  if (href === 'https://' + STALE_HOST + '/' && !live.stale) return { type: 'text/html', body: '<html><head><link rel="icon" type="image/png" sizes="192x192" href="/icon.png"></head></html>' };
  if (href === 'https://' + STALE_HOST + '/icon.png' && !live.stale) return { type: 'image/png', body: png };
  return null;
};

const proxy = createHandler({
  resolve: publicResolve,
  request: async ({ url }) => {
    const hit = site(url.href);
    return hit ? reply(hit.body, 200, hit.type) : reply('missing', 404);
  },
  env: {},
  known: { hosts: [PIN_HOST, STALE_HOST], cdn: [] }
});
const server = await serve(4202, proxy);
const exe = fs.readdirSync('/opt/pw-browsers').filter((d) => d.startsWith('chromium-')).flatMap((d) => ['chrome-linux64', 'chrome-linux'].map((s) => '/opt/pw-browsers/' + d + '/' + s + '/chrome')).find((p) => fs.existsSync(p));
const chrome = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const ctx = await chrome.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:4202' });
const errors = [];
const tab = await ctx.newPage();
tab.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
tab.on('pageerror', (e) => errors.push(e.message));
await tab.goto('http://localhost:4202/');
await tab.waitForSelector('#urls');

const harvest = async (url) => {
  await tab.locator('#urls').fill(url);
  await tab.click('#go');
  await tab.waitForSelector('.gallery .cell[data-key]', { timeout: 120000 });
  await tab.locator('.gallery .cell[data-key]').first().click();
};

await check('a bundled icon shows the stale badge and Retry live replaces it once the site answers', async () => {
  await harvest('https://' + STALE_HOST + '/');
  await tab.waitForSelector('[data-flag="stale-source"]');
  assert.equal(await tab.locator('[data-flag="stale-source"]').innerText(), 'Stale: using shipped copy');
  live.stale = false;
  await tab.locator('[data-act="retry-live"]').click();
  await tab.waitForFunction(() => !document.querySelector('[data-flag="stale-source"]'), null, { timeout: 120000 });
  assert.equal(await tab.locator('[data-act="retry-live"]').count(), 0);
});

await check('the attempts list offers Use this one, pins the source and offers the pin JSON', async () => {
  await tab.reload();
  await tab.waitForSelector('#urls');
  await harvest('https://' + PIN_HOST + '/');
  await tab.locator('details.attempts summary').click();
  const touch = tab.locator('details.attempts li', { hasText: 'apple-touch-icon' });
  await touch.locator('[data-act="pin"]').click();
  await tab.waitForSelector('li.pinned', { timeout: 120000 });
  const href = await tab.locator('li.pinned .href').innerText();
  assert.equal(href, 'https://' + PIN_HOST + '/touch.jpg');
  const source = await tab.locator('.facts dd').last().innerText();
  assert.match(source, /pinned/);
  await tab.locator('[data-act="copy-pin"]').click();
  const copied = JSON.parse(await tab.evaluate(() => navigator.clipboard.readText()));
  assert.deepEqual(Object.values(copied), [{ href: 'https://' + PIN_HOST + '/touch.jpg' }]);
});

await check('the item panel shows the contrast adjustment and the low-res flag', async () => {
  await tab.evaluate(() => {
    const { state } = window.__studio;
    const key = [...state.records.keys()][0];
    const rec = state.records.get(key);
    rec.contrast = 'nudged';
    rec.sourceTint = ['#aaccee', '#ffffff', '#000000'];
    rec.tint = ['#336699', '#ffffff', '#000000'];
    const item = state.items.get(key);
    state.items.set(key, { ...item, flags: ['low-res'] });
  });
  await tab.locator('.gallery .cell[data-key]').first().click();
  await tab.locator('.gallery .cell[data-key]').first().click();
  await tab.waitForSelector('[data-note="contrast"]');
  assert.equal(await tab.locator('[data-note="contrast"]').innerText(), 'Adjusted for contrast: #aaccee → #336699');
  assert.equal(await tab.locator('[data-flag="low-res"]').innerText(), 'Low resolution source');
});

await check('no console errors in the browser run', () => assert.deepEqual(errors.filter((e) => !/401|404|Failed to load resource/.test(e)), []));

await chrome.close();
server.close();
finish();
