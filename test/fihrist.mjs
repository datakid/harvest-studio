import { chromiumPath } from './util.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { serve } from '../scripts/serve.mjs';
import { check, finish } from './util.mjs';
import * as core from '../core/index.js';

const read = (f) => JSON.parse(fs.readFileSync(new URL('../config/' + f, import.meta.url), 'utf8'));
const fihrist = read('fihrist.json');
const launcher = read('catalogue.json');
const extras = core.extrasToTargets(read('extras.json'));
const fihristTargets = core.scanJson(fihrist, {}, 'en').targets;
const launcherTargets = core.mergeTargets(core.scanJson(launcher, {}, 'en').targets, extras);
const both = [...launcherTargets, ...fihristTargets];

await check('a Fihrist file is recognised and turned into one target per site', () => {
  const scan = core.scanJson(fihrist, {}, 'en');
  assert.equal(scan.kind, 'fihrist');
  assert.equal(scan.count, 50);
  assert.ok(scan.targets.every((t) => /^https?:/.test(t.url) && t.key && t.name));
  assert.equal(new Set(scan.targets.map((t) => t.key)).size, 50);
  assert.ok(scan.targets.find((t) => t.key === 'ledger-form--main'));
  assert.ok(scan.targets.some((t) => t.closed));
});

await check('names follow the chosen language', () => {
  const en = core.scanJson(fihrist, {}, 'en').targets;
  const ar = core.scanJson(fihrist, {}, 'ar').targets;
  assert.notDeepEqual(en.map((t) => t.name), ar.map((t) => t.name));
  assert.deepEqual(en.map((t) => t.key), ar.map((t) => t.key));
});

await check('address identity ignores scheme, www, case and trailing slash', () => {
  assert.equal(core.urlIdentity('https://WWW.Example.com/a/'), core.urlIdentity('http://example.com/a'));
  assert.notEqual(core.urlIdentity('https://example.com/a'), core.urlIdentity('https://example.com/b'));
  assert.notEqual(core.urlIdentity('https://example.com/?x=1'), core.urlIdentity('https://example.com/?x=2'));
  assert.equal(core.urlIdentity('not a url'), null);
});

await check('the launcher set and the Fihrist set share sites and they are found', () => {
  assert.equal(launcherTargets.length, 34);
  assert.equal(both.length, 84);
  const groups = core.findDuplicates(both);
  assert.equal(groups.length, 33);
  assert.ok(groups.every((g) => g.entries.length === 2));
  assert.equal(core.findDuplicates(launcherTargets).length, 0);
  assert.equal(core.findDuplicates(fihristTargets).length, 0);
});

await check('harvesting each site once keeps the first entry of every group and nothing else', () => {
  const once = core.dropDuplicates(both);
  assert.equal(once.length, 51);
  assert.deepEqual(once.slice(0, 34), launcherTargets);
  assert.equal(core.findDuplicates(once).length, 0);
  assert.deepEqual(core.dropDuplicates(launcherTargets), launcherTargets);
});

await check('entries without an address are never treated as duplicates', () => {
  const list = [{ key: 'a' }, { key: 'b' }, { key: 'c', url: 'https://x.example/' }];
  assert.equal(core.findDuplicates(list).length, 0);
  assert.equal(core.dropDuplicates(list).length, 3);
});

await check('a bundled icon is found by address when the key differs', async () => {
  const keys = fs.readdirSync(new URL('../config/known-icons/', import.meta.url)).map((f) => f.replace(/\.[^.]+$/, ''));
  const byUrl = fs.readFileSync(new URL('../dist/known/urls.json', import.meta.url), 'utf8');
  const map = JSON.parse(byUrl);
  const files = fs.readdirSync(new URL('../config/known-icons/', import.meta.url));
  assert.ok(Object.values(map).every((f) => files.includes(f)));
  const covered = fihristTargets.filter((t) => !keys.includes(t.key) && map[core.urlIdentity(t.url)]);
  assert.ok(covered.length >= 5, 'urls covered: ' + covered.length);
});

const server = await serve(4183, async (req, res) => {
  res.statusCode = 503;
  res.end('no proxy in this test');
});
const exe = chromiumPath();
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const logs = [];
const open = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && logs.push(m.text()));
  page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
  await page.goto('http://localhost:4183/');
  await page.waitForSelector('#harvest-both');
  return page;
};
const settle = (page, n) => page.waitForFunction((n) => window.__studio.state.items.size === n && [...window.__studio.state.items.values()].every((i) => i.status !== 'pending' && i.status !== 'fetching'), n, { timeout: 120000 });

await check('three one-click choices are offered with their counts', async () => {
  const page = await open();
  assert.match(await page.locator('#harvest-catalogue').innerText(), /34/);
  assert.match(await page.locator('#harvest-fihrist').innerText(), /50/);
  assert.match(await page.locator('#harvest-both').innerText(), /84/);
  await page.context().close();
});

await check('the Fihrist set alone starts at once because it has no repeats', async () => {
  const page = await open();
  await page.click('#harvest-fihrist');
  await settle(page, 50);
  assert.equal(await page.locator('#dup-dialog').count(), 0);
  await page.context().close();
});

await check('both sets together ask what to do, listing the repeated sites', async () => {
  const page = await open();
  await page.click('#harvest-both');
  await page.waitForSelector('#dup-dialog[open]');
  assert.equal(await page.locator('#dup-once').count(), 1);
  assert.match(await page.locator('#dup-once').innerText(), /51/);
  assert.match(await page.locator('#dup-keep').innerText(), /84/);
  assert.ok((await page.locator('#dup-dialog .dups li').count()) >= 2);
  assert.match(await page.locator('#dup-title').innerText(), /33/);
  await page.context().close();
});

await check('"each site once" harvests 51 icons', async () => {
  const page = await open();
  await page.click('#harvest-both');
  await page.click('#dup-once');
  await settle(page, 51);
  assert.equal(await page.locator('#dup-dialog').count(), 0);
  await page.context().close();
});

await check('"keep all entries" harvests all 84 with distinct names', async () => {
  const page = await open();
  await page.click('#harvest-both');
  await page.click('#dup-keep');
  await settle(page, 84);
  const keys = await page.evaluate(() => [...window.__studio.state.items.keys()]);
  assert.equal(new Set(keys).size, 84);
  await page.context().close();
});

await check('cancel and Escape go back to the start without harvesting', async () => {
  const page = await open();
  await page.click('#harvest-both');
  await page.click('#dup-cancel');
  await page.waitForSelector('#dup-dialog', { state: 'detached' });
  assert.equal(await page.evaluate(() => window.__studio.state.items.size), 0);
  assert.equal(await page.evaluate(() => window.__studio.state.stage), 'intake');
  await page.click('#harvest-both');
  await page.waitForSelector('#dup-dialog[open]');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#dup-dialog', { state: 'detached' });
  assert.equal(await page.evaluate(() => window.__studio.state.items.size), 0);
  assert.equal(await page.evaluate(() => window.__studio.state.stage), 'intake');
  await page.context().close();
});

await check('the dialog reads in Arabic and in a phone width without overflow', async () => {
  const page = await open();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => localStorage.setItem('hs:prefs', JSON.stringify({ lang: 'ar' })));
  await page.reload();
  await page.waitForSelector('#harvest-both');
  await page.click('#harvest-both');
  await page.waitForSelector('#dup-dialog[open]');
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'ar');
  assert.match(await page.locator('#dup-title').innerText(), /[\u0600-\u06ff]/);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  const box = await page.locator('#dup-dialog').boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 391);
  await page.context().close();
});

await check('the same address pasted twice also asks, and a unique list does not', async () => {
  const page = await open();
  await page.fill('#urls', 'https://one.example/\nhttps://www.one.example\nhttps://two.example/');
  await page.press('#urls', 'Enter');
  await page.waitForSelector('#dup-dialog[open]');
  assert.match(await page.locator('#dup-once').innerText(), /2/);
  await page.click('#dup-cancel');
  await page.waitForSelector('#dup-dialog', { state: 'detached' });
  await page.fill('#urls', 'https://one.example/\nhttps://two.example/');
  await page.press('#urls', 'Enter');
  await page.waitForTimeout(400);
  assert.equal(await page.locator('#dup-dialog').count(), 0);
  await page.context().close();
});

if (process.env.SHOTS) {
  const page = await open();
  await page.screenshot({ path: process.env.SHOTS + '/sets.png' });
  await page.click('#harvest-both');
  await page.waitForSelector('#dup-dialog[open]');
  await page.screenshot({ path: process.env.SHOTS + '/duplicates.png' });
  await page.context().close();
}

await check('no console errors', () => assert.deepEqual(logs, []));
await browser.close();
server.close();
finish();
