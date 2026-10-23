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

const shots = process.env.SHOTS || null;
const files = fs.readdirSync(fixturesDir).filter((f) => f.endsWith('.png')).map((f) => path.join(fixturesDir, f));
const site = {
  'https://demo.example.com/': { type: 'text/html', body: Buffer.from('<html><head><link rel="icon" type="image/png" sizes="192x192" href="/icon.png"></head></html>') },
  'https://text.example.com/': { type: 'text/html', body: Buffer.from('<html><head><link rel="icon" type="image/svg+xml" href="/t.svg"></head></html>') },
  'https://text.example.com/t.svg': { type: 'image/svg+xml', body: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#1f6feb"/><text x="32" y="46" font-size="40" text-anchor="middle" fill="#fff" font-family="Arial">Ab</text></svg>') },
  'https://demo.example.com/icon.png': { type: 'image/png', body: fs.readFileSync(path.join(fixturesDir, 'dafter.png')) }
};
const proxy = createHandler({
  resolve: async () => [{ address: '93.184.216.34', family: 4 }],
  request: async ({ url }) => {
    const hit = site[url.href];
    if (!hit) return { status: 404, headers: { 'content-type': 'text/html' }, body: Readable.from([Buffer.from('missing')]), destroy() {} };
    return { status: 200, headers: { 'content-type': hit.type }, body: Readable.from([hit.body]), destroy() {} };
  },
  env: { STUDIO_TOKEN: 'ui-token' }
});
const server = await serve(4181, proxy);
const exe = fs.readdirSync('/opt/pw-browsers').filter((d) => d.startsWith('chromium-')).map((d) => '/opt/pw-browsers/' + d + '/chrome-linux/chrome').find((p) => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const logs = [];
const open = async (viewport, scheme = 'light') => {
  const ctx = await browser.newContext({ viewport, colorScheme: scheme, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && logs.push(m.type() + ': ' + m.text()));
  page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
  await page.goto('http://localhost:4181/');
  return page;
};
const harvest = async (page) => {
  await page.setInputFiles('#pick-files', files);
  await page.waitForSelector('.chip');
  await page.click('#go');
  await page.waitForSelector('.gallery .cell .tile-art:not(.ghost)', { timeout: 120000 });
  await page.waitForTimeout(1500);
};
const shot = async (page, name) => shots && (await page.screenshot({ path: path.join(shots, name + '.png') }));

const page = await open({ width: 1440, height: 900 });
await check('intake renders with a single heading and no console errors', async () => {
  assert.equal(await page.locator('h1').count(), 1);
  assert.deepEqual(logs, []);
});
await harvest(page);
await page.waitForTimeout(1200);
await shot(page, 'work-light');

await check('harvest gives one tile per fixture', async () => {
  assert.equal(await page.locator('.gallery .cell').count(), files.length);
});

await check('no long animation frame while tiles bloom', async () => {
  const long = await page.evaluate(() => performance.getEntriesByType('long-animation-frame').filter((e) => e.blockingDuration > 50).length);
  assert.equal(long, 0);
});

await check('mode switch to one colour paints every tile with one hue family', async () => {
  await page.getByRole('radio', { name: 'One colour' }).click();
  await page.locator('.sw').nth(5).click();
  const colours = await page.$$eval('.gallery .tile-art', (els) => els.map((e) => getComputedStyle(e).getPropertyValue('--tile').trim()));
  assert.ok(colours.length === files.length);
  assert.ok(new Set(colours).size > 1, 'variation should keep tiles distinct');
});
await page.waitForTimeout(300);
await shot(page, 'mono-light');

await check('per-icon colour change locks the icon', async () => {
  await page.getByRole('radio', { name: 'Follow' }).click();
  await page.locator('.cell').first().click();
  await page.locator('.inspector .picker input').fill('#12b886');
  await page.locator('.inspector .picker input').dispatchEvent('change');
  assert.ok(await page.getByText('Colour kept').count());
  await page.getByRole('button', { name: 'Reset colour' }).click();
  assert.equal(await page.getByText('Colour kept').count(), 0);
});

await check('keyboard arrows move the selection', async () => {
  await page.locator('.cell').first().focus();
  await page.keyboard.press('ArrowRight');
  const selected = await page.locator('.cell[aria-selected="true"]').getAttribute('data-key');
  assert.ok(selected && selected !== (await page.locator('.cell').first().getAttribute('data-key')));
});

await check('launcher export passes the gate and zips the contract files', async () => {
  await page.getByRole('button', { name: 'Export' }).click();
  await page.waitForSelector('dialog .gate', { timeout: 120000 });
  await shot(page, 'export-launcher');
  assert.ok(await page.getByText('Within budget').count());
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download .zip' }).click()]);
  const bytes = fs.readFileSync(await dl.path());
  const names = Object.keys(unzipSync(new Uint8Array(bytes)));
  assert.ok(names.some((n) => /^icons\/atlas\.[0-9a-f]{8}\.webp$/.test(n)), names.join());
  assert.ok(names.some((n) => /^icons\/glyphs\.[0-9a-f]{8}\.svg$/.test(n)));
  assert.ok(names.includes('icons/manifest.v2.json'));
  assert.ok(names.includes('icons/harvest-report.json'));
  const report = JSON.parse(new TextDecoder().decode(unzipSync(new Uint8Array(bytes))['icons/harvest-report.json']));
  assert.equal(report.items.length, files.length);
  assert.match(report.note, /last harvest/);
  assert.ok(report.atlas.atlasBytes > 0);
  assert.equal(typeof report.gate.ok, 'boolean');
});

await check('browser worker export matches the Node run (manifest and atlas pixels)', async () => {
  await page.getByRole('radio', { name: 'Launcher set' }).click();
  await page.waitForSelector('dialog .gate');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download .zip' }).click()]);
  const zip = unzipSync(new Uint8Array(fs.readFileSync(await dl.path())));
  const targets = files.map((f) => {
    const key = path.basename(f, '.png');
    return { key, appId: key };
  });
  const node = await core.runHarvest({ targets, overrides: {} }, { local: true, now: NOW, seed: '1f2e3d4c' }, localIo());
  const strip = (m) => {
    const copy = JSON.parse(JSON.stringify(m));
    delete copy.generatedAt;
    for (const e of Object.values(copy.icons)) delete e.checkedAt;
    return copy;
  };
  const bm = JSON.parse(Buffer.from(zip['icons/manifest.v2.json']).toString('utf8'));
  const nm = node.export.manifest;
  assert.deepEqual(strip(bm).icons, strip(nm).icons);
  assert.equal(bm.hash, nm.hash);
  const atlasName = Object.keys(zip).find((n) => /atlas\.[0-9a-f]{8}\.webp$/.test(n) && !n.includes('glyph'));
  const nodeAtlasName = Object.keys(node.export.files).find((n) => /^atlas\./.test(n));
  const a = await core.decodeWebp(zip[atlasName]);
  const b = await core.decodeWebp(node.export.files[nodeAtlasName]);
  assert.equal(a.width, b.width);
  assert.ok(Buffer.compare(Buffer.from(a.data), Buffer.from(b.data)) === 0, 'atlas pixels differ');
  const glyphName = Object.keys(zip).find((n) => /glyphs\.[0-9a-f]{8}\.svg$/.test(n));
  const nodeGlyph = Object.keys(node.export.files).find((n) => /^glyphs\./.test(n));
  assert.equal(Buffer.from(zip[glyphName]).toString('utf8'), Buffer.from(node.export.files[nodeGlyph]).toString('utf8'));
});

await check('favicon pack zips every size and the head tags', async () => {
  await page.getByRole('radio', { name: 'Favicon pack' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download .zip' }).click()]);
  const names = Object.keys(unzipSync(new Uint8Array(fs.readFileSync(await dl.path()))));
  for (const n of ['favicon.ico', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'site.webmanifest', 'head.html']) assert.ok(names.includes(n), n);
  await shot(page, 'export-pack');
  await page.keyboard.press('Escape');
});

await check('dark theme and arabic layout render without overflow', async () => {
  await page.getByRole('radio', { name: 'Dark' }).click();
  await page.getByRole('button', { name: 'العربية' }).click();
  assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await shot(page, 'work-dark-ar');
});

await check('arabic mode: language is declared, names choose their own direction, and the css uses logical properties', async () => {
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'ar');
  const dirs = await page.$$eval('.cell .name', (els) => els.map((e) => [e.getAttribute('dir'), getComputedStyle(e).direction]));
  assert.ok(dirs.length > 0);
  for (const [attr, computed] of dirs) assert.deepEqual([attr, computed], ['auto', 'ltr']);
  const css = fs.readFileSync(path.join(fixturesDir, '..', '..', 'src', 'app.css'), 'utf8') + fs.readFileSync(path.join(fixturesDir, '..', '..', 'src', 'tokens.css'), 'utf8');
  const physical = css.split('\n').filter((l) => /(margin|padding|border)-(left|right)|(^|[\s;{])(left|right)\s*:|float\s*:|text-align\s*:\s*(left|right)/.test(l) && !/^pre\.code/.test(l));
  assert.deepEqual(physical, []);
});

const single = await open({ width: 1440, height: 900 });
await single.evaluate(() => {
  localStorage.setItem('hs:prefs', JSON.stringify({ proxyUrl: 'http://localhost:4181/api/fetch' }));
  sessionStorage.setItem('hs:token', 'ui-token');
});
await single.reload();
await check('a single site address is harvested through the proxy', async () => {
  await single.locator('#urls').fill('demo.example.com');
  await single.click('#go');
  await single.waitForSelector('.gallery .cell .tile-art:not(.ghost)', { timeout: 120000 });
  assert.equal(await single.locator('.gallery .cell').count(), 1);
  assert.ok(await single.getByText('Found').count());
  assert.ok(await single.getByText(/png http/).count());
  await single.locator('.gallery .cell').first().click();
  const tried = single.locator('.inspector details.attempts');
  assert.equal(await tried.count(), 1);
  await tried.locator('summary').click();
  const row = await tried.locator('li').first().innerText();
  assert.ok(/used/.test(row) && /png/.test(row) && /demo\.example\.com\/icon\.png/.test(row), row);
  await single.getByRole('button', { name: 'Export' }).click();
  await single.getByRole('radio', { name: 'Favicon pack' }).click();
  const [dl] = await Promise.all([single.waitForEvent('download'), single.getByRole('button', { name: 'Download .zip' }).click()]);
  const names = Object.keys(unzipSync(new Uint8Array(fs.readFileSync(await dl.path()))));
  assert.ok(names.includes('favicon.ico') && names.includes('icon-512.png'));
});
await check('a text favicon is drawn in the browser worker with the bundled font', async () => {
  await single.keyboard.press('Escape');
  await single.reload();
  await single.locator('#urls').fill('text.example.com');
  const font = single.waitForResponse((r) => /fonts\/readex-pro-text\.ttf$/.test(r.url()) && r.status() === 200, { timeout: 120000 });
  await single.route(/api\/fetch\?url=.*text\.example\.com%2F$/, async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await single.click('#go');
  await single.waitForSelector('[role="progressbar"]', { timeout: 20000 });
  assert.equal(await single.locator('[role="progressbar"]').getAttribute('aria-valuemin'), '0');
  assert.ok((await single.locator('[role="progressbar"]').getAttribute('aria-valuenow')) !== null);
  await font;
  await single.waitForSelector('.gallery .cell .tile-art:not(.ghost)', { timeout: 120000 });
  await single.locator('.gallery .cell').first().click();
  assert.ok(await single.getByText(/svg http/).count());
});
await check('a wrong proxy token explains itself', async () => {
  await single.keyboard.press('Escape');
  await single.evaluate(() => sessionStorage.setItem('hs:token', 'wrong'));
  await single.reload();
  await single.locator('#urls').fill('demo.example.com');
  await single.click('#go');
  await single.waitForSelector('.note.bad', { timeout: 120000 });
  const text = await single.locator('.note.bad').innerText();
  assert.ok(/access token/i.test(text), text);
});

await check('a json file shows what was found and lets the fields be changed', async () => {
  await single.reload();
  await single.setInputFiles('#pick-files', [path.join(fixturesDir, '..', 'links.json')]);
  await single.waitForSelector('.scan');
  assert.ok(await single.getByText(/Found 32 in launcher catalogue/).count());
  assert.ok(await single.getByRole('button', { name: 'Harvest 32 icons' }).count());
  await single.reload();
  await single.setInputFiles('#pick-files', [{ name: 'tools.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ tools: [{ name: 'A', homepage: 'https://a.test', logo: 'https://a.test/l.png' }, { name: 'B', homepage: 'https://b.test', logo: 'https://b.test/l.png' }] })) }]);
  await single.waitForSelector('.scan select');
  assert.ok(await single.getByText(/Found 2 in tools/).count());
  await single.locator('.scan select').nth(1).selectOption('');
  assert.ok(await single.getByText(/Found 2 in tools/).count());
});

await check('names given as language objects follow a language picker in the import panel', async () => {
  await single.reload();
  const data = { sites: [{ id: 'alpha', name: { en: 'Alpha', ar: 'ألفا' }, url: 'https://alpha.test' }, { id: 'beta', name: { en: 'Beta', ar: 'بيتا' }, url: 'https://beta.test' }] };
  await single.setInputFiles('#pick-files', [{ name: 'sites.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) }]);
  await single.waitForSelector('#label-lang-0');
  assert.ok(await single.locator('.scan li').first().innerText().then((x) => x.startsWith('Alpha')));
  await single.locator('#label-lang-0').selectOption('ar');
  assert.ok(await single.locator('.scan li').first().innerText().then((x) => x.startsWith('ألفا')));
  await single.locator('#label-lang-0').selectOption('');
  assert.ok(await single.locator('.scan li').first().innerText().then((x) => x.startsWith('Alpha')));
});

const noProxy = await open({ width: 1200, height: 800 });
await check('a site that cannot be reached without a proxy is named in a notice next to the images that worked', async () => {
  await noProxy.setInputFiles('#pick-files', files.slice(0, 2));
  await noProxy.waitForSelector('.chip');
  await noProxy.locator('#urls').fill('demo.example.com');
  await noProxy.click('#go');
  await noProxy.waitForSelector('.toast', { timeout: 120000 });
  assert.match(await noProxy.locator('.toast').first().innerText(), /1 sites were not reached because no fetch proxy is set/);
  assert.equal(await noProxy.locator('.gallery .cell').count(), 3);
});

await check('the shipped catalogue harvests in one click with no proxy, protocols included', async () => {
  const fresh = await open({ width: 1200, height: 800 });
  await fresh.waitForSelector('#harvest-catalogue');
  assert.match(await fresh.locator('#harvest-catalogue').innerText(), /32/);
  await fresh.click('#harvest-catalogue');
  await fresh.waitForSelector('.gallery .cell .tile-art:not(.ghost)', { timeout: 120000 });
  await fresh.waitForFunction(() => document.querySelectorAll('.gallery .cell').length === 32, null, { timeout: 120000 });
  const state = await fresh.evaluate(() => {
    const items = [...window.__studio.state.items.values()];
    const p = items.find((i) => i.key === 'protocols');
    return { total: items.length, found: items.filter((i) => i.status === 'found').length, protocols: p && p.status, source: p && p.source && p.source.type };
  });
  assert.deepEqual(state, { total: 32, found: 32, protocols: 'found', source: 'bundled' });
  assert.equal(await fresh.locator('.toast').count(), 0);
});

const phone = await open({ width: 390, height: 844 }, 'dark');
await harvest(phone);
await check('phone layout has no horizontal scroll and 44px targets', async () => {
  assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  const small = await phone.$$eval('.btn, .seg button', (els) => els.filter((e) => e.offsetParent && e.getBoundingClientRect().height < 36).length);
  assert.equal(small, 0);
  await shot(phone, 'work-phone');
});

await check('no console errors during the whole session', () => assert.deepEqual(logs, []));
await browser.close();
server.close();
finish();
