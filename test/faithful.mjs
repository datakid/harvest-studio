import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { serve } from '../scripts/serve.mjs';
import { decodeImage, paletteOf, pickTint, hexToLab, hexToLch, isHex, v4Violations } from '../core/index.js';
import { check, finish, fixturesDir, chromiumPath } from './util.mjs';

const files = fs.readdirSync(fixturesDir).filter((f) => f.endsWith('.png')).slice(0, 20).map((f) => path.join(fixturesDir, f));

await check('F1 the palette of a mostly black icon keeps the black, with shares that add up', async () => {
  const bytes = new Uint8Array(fs.readFileSync(path.join(fixturesDir, 'paid-calculator--daleel.png')));
  const { image } = await decodeImage(bytes, 'png');
  const palette = paletteOf(image.data, image.width, image.height);
  assert.ok(palette.length >= 2 && palette.length <= 6, JSON.stringify(palette));
  assert.ok(palette.every((c) => isHex(c.hex)));
  const total = palette.reduce((m, c) => m + c.share, 0);
  assert.ok(total > 0.98 && total < 1.02, String(total));
  assert.ok(palette.some((c) => hexToLab(c.hex)[0] < 0.35), 'no dark colour in ' + JSON.stringify(palette));
  assert.deepEqual(palette.map((c) => c.share), [...palette.map((c) => c.share)].sort((a, b) => b - a));
});

await check('F2 picking one, two or three colours gives an exact solid, a gradient or a mix', () => {
  const solid = pickTint('flat', ['#101010']);
  assert.equal(solid.length, 3);
  assert.equal(solid[0], '#101010');
  const [bL] = hexToLch(solid[0]);
  const [lL, dL] = [hexToLch(solid[1])[0], hexToLch(solid[2])[0]];
  assert.ok(lL > bL && dL < bL);
  const gradient = pickTint('gradient', ['#ffcc00', '#101010']);
  assert.equal(gradient[1], '#ffcc00');
  assert.equal(gradient[2], '#101010');
  const lMid = hexToLab(gradient[0])[0];
  assert.ok(lMid > hexToLab('#101010')[0] && lMid < hexToLab('#ffcc00')[0]);
  const three = pickTint('gradient', ['#202020', '#e0e0e0', '#808080']);
  assert.deepEqual(three, ['#e0e0e0', '#202020', '#808080']);
  assert.deepEqual(pickTint('gradient', ['#808080', '#e0e0e0', '#202020']), ['#e0e0e0', '#808080', '#202020']);
  const mixed = pickTint('mix', ['#ff0000', '#0000ff']);
  const plain = hexToLab(mixed[0]);
  const [ra, rb] = [hexToLab('#ff0000'), hexToLab('#0000ff')];
  assert.ok(Math.hypot(plain[1], plain[2]) > Math.hypot((ra[1] + rb[1]) / 2, (ra[2] + rb[2]) / 2));
  assert.ok(pickTint('mix', ['#ff0000', '#00ffff']).every(isHex));
  assert.equal(pickTint('mix', ['#e0e0e0', '#202020'])[0].length, 7);
  assert.equal(pickTint('mix', ['#123456', 'nope'])[0], '#123456');
  assert.equal(pickTint('gradient', []), null);
  assert.equal(pickTint('flat', ['#a1', '#b2']), null);
  assert.ok(v4Violations(pickTint('flat', ['#101010'])).length > 0);
  assert.equal(v4Violations(pickTint('flat', ['#d15074'])).length, 0);
});

const server = await serve(4199, null);
const browser = await chromium.launch({ executablePath: chromiumPath(), args: ['--no-sandbox'] });
const requests = [];
const logs = [];
const open = async (lang = 'en', prefs = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
  const page = await ctx.newPage();
  page.on('request', (r) => requests.push(new URL(r.url()).pathname));
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && logs.push(m.type() + ': ' + m.text()));
  page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
  await page.addInitScript(([l, p]) => localStorage.setItem('hs:prefs', JSON.stringify({ lang: l, ...p })), [lang, prefs]);
  await page.goto('http://localhost:4199/');
  await page.setInputFiles('#pick-files', files);
  await page.waitForSelector('.chip');
  await page.click('#go');
  await page.waitForFunction(() => window.__studio && window.__studio.state.stage === 'work', null, { timeout: 120000 });
  await page.waitForTimeout(800);
  return page;
};
const rec = (page, key) => page.evaluate((k) => { const r = window.__studio.state.records.get(k); return { tint: r.tint, pick: r.pick || null, locked: !!r.locked }; }, key);
const expand = async (page) => {
  if (!(await page.evaluate(() => document.getElementById('palette').open))) await page.click('#palette summary');
  await page.waitForSelector('.pick-swatch');
};
const cell = (page, key) => page.locator('.cell[data-key="' + key + '"]');
const tileVar = (page, key, name) => page.evaluate(([k, n]) => getComputedStyle(document.querySelector('.cell[data-key="' + k + '"] .tile-art')).getPropertyValue(n).trim(), [key, name]);

const page = await open();
const KEY = 'paid-calculator--daleel';

await check('F3 the palette code is only fetched once an icon is selected, and its section opens by default', async () => {
  assert.ok(!requests.includes('/palette.js'), requests.join(' '));
  assert.ok(!requests.includes('/ar.js'), 'the Arabic words are not needed in English');
  await cell(page, KEY).click();
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => document.getElementById('palette').open), true);
  await page.waitForSelector('.pick-swatch');
  assert.ok(requests.includes('/palette.js'));
});

await check('F4 the palette lists the real colours of the icon, black included, most common first', async () => {
  const swatches = await page.$$eval('.pick-swatch', (els) => els.map((e) => e.dataset.hex));
  assert.ok(swatches.length >= 2);
  const dark = swatches.filter((h) => hexToLab(h)[0] < 0.35);
  assert.ok(dark.length >= 1, swatches.join(' '));
  assert.equal(swatches[0], dark[0]);
});

await check('F5 faithful mode shows the real favicon in every tile and comes back after a reload', async () => {
  const before = await page.$$eval('.cell .tile-art .glyph', (els) => els.length);
  assert.ok(before > 0);
  await page.click('#faithful-btn');
  await page.waitForTimeout(300);
  assert.equal(await page.getAttribute('#faithful-btn', 'aria-pressed'), 'true');
  const tiles = await page.$$eval('.cell .tile-art', (els) => els.map((e) => ({ real: e.classList.contains('faithful'), img: e.querySelector('img') ? e.querySelector('img').src.startsWith('blob:') : false, glyph: !!e.querySelector('.glyph') })));
  assert.ok(tiles.length >= 20);
  assert.ok(tiles.every((t) => t.real && t.img && !t.glyph), JSON.stringify(tiles.filter((t) => !t.real || !t.img)));
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('hs:prefs')).faithful), true);
  await page.click('#faithful-btn');
  await page.waitForTimeout(300);
  assert.equal(await page.$$eval('.cell .tile-art.faithful', (els) => els.length), 0);
  assert.equal(await page.$$eval('.cell .tile-art .glyph', (els) => els.length), before);
});

await check('F6 choosing the black swatch makes an exact, kept tile colour, and undo takes it back', async () => {
  await cell(page, KEY).click();
  await expand(page);
  const was = await rec(page, KEY);
  const black = await page.$$eval('.pick-swatch', (els) => els[0].dataset.hex);
  await page.locator('.pick-swatch').first().click();
  await page.click('#pick-apply');
  await page.waitForTimeout(400);
  const now = await rec(page, KEY);
  assert.equal(now.tint[0], pickTint('flat', [black])[0]);
  assert.deepEqual(now.tint, pickTint('flat', [black]));
  assert.equal(now.pick, 'flat');
  assert.equal(now.locked, true);
  assert.equal(await tileVar(page, KEY, '--tile'), black);
  await page.keyboard.press('Escape');
  await cell(page, KEY).click();
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(400);
  assert.deepEqual(await rec(page, KEY), was);
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(300);
  assert.deepEqual((await rec(page, KEY)).tint, now.tint);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
});

await check('F7 two swatches as a gradient show both colours in the tile, and as a mix give one blended colour', async () => {
  await cell(page, KEY).click();
  await expand(page);
  const hexes = await page.$$eval('.pick-swatch', (els) => els.map((e) => e.dataset.hex));
  assert.ok(hexes.length >= 2);
  assert.equal(await page.locator('#pick-kind [aria-checked="true"]').getAttribute('data-value'), 'flat');
  await page.click('#pick-kind [data-value="gradient"]');
  assert.equal(await page.locator('.pick-swatch[aria-pressed="true"]').count(), 2);
  await page.click('#pick-apply');
  await page.waitForTimeout(400);
  const g = await rec(page, KEY);
  assert.deepEqual(g.tint, pickTint('gradient', hexes.slice(0, 2)));
  assert.equal(g.pick, 'gradient');
  assert.equal(await tileVar(page, KEY, '--tile-hi'), g.tint[1]);
  assert.equal(await tileVar(page, KEY, '--tile-lo'), g.tint[2]);
  await cell(page, KEY).click();
  await expand(page);
  await page.click('#pick-kind [data-value="mix"]');
  assert.equal(await page.locator('.pick-swatch[aria-pressed="true"]').count(), 2);
  await page.click('#pick-apply');
  await page.waitForTimeout(400);
  const m = await rec(page, KEY);
  assert.deepEqual(m.tint, pickTint('mix', hexes.slice(0, 2)));
  assert.equal(m.pick, 'flat');
  assert.equal(await tileVar(page, KEY, '--tile-hi'), m.tint[0]);
});

await check('F8 a picked colour outside the launcher range is flagged only when the v4 target is on', async () => {
  await cell(page, KEY).click();
  await expand(page);
  await page.locator('.pick-swatch').first().click();
  assert.equal(await page.locator('#pick-note').count(), 0);
  await page.evaluate(() => { window.__studio.state.target = 'v4'; });
  await page.locator('.pick-swatch').first().click();
  await page.locator('.pick-swatch').first().click();
  assert.equal(await page.locator('#pick-note').count(), 1);
  await page.evaluate(() => { window.__studio.state.target = 'v3'; });
});

await check('F8b any colour can join a gradient, and the palette opens by default', async () => {
  await cell(page, KEY).click();
  assert.equal(await page.evaluate(() => document.getElementById('palette').open), true);
  await page.waitForSelector('.pick-swatch');
  await page.click('#pick-kind [data-value="gradient"]');
  await page.locator('.pick-swatch[aria-pressed="true"]').first().click();
  await page.locator('#pick-custom').evaluate((e) => { e.value = '#ff8800'; e.dispatchEvent(new Event('change', { bubbles: true })); });
  assert.equal(await page.locator('.pick-swatch[data-hex="#ff8800"][aria-pressed="true"]').count(), 1);
  await page.click('#pick-apply');
  await page.waitForTimeout(400);
  const r = await rec(page, KEY);
  assert.equal(r.pick, 'gradient');
  assert.ok(r.tint.includes('#ff8800'));
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
});

await check('F8c suggested gradients fill the picks in order, flip reverses them, and a preview tile shows the result', async () => {
  await cell(page, KEY).click();
  await page.waitForSelector('.pick-swatch');
  await page.click('#pick-kind [data-value="gradient"]');
  assert.ok((await page.locator('.pick-idea').count()) >= 1);
  await page.locator('.pick-idea').first().click();
  const order = () => page.$$eval('.pick-swatch[aria-pressed="true"]', (els) => els.map((e) => [Number(e.querySelector('b').textContent), e.dataset.hex]).sort((a, b) => a[0] - b[0]).map((x) => x[1]));
  const first = await order();
  assert.ok(first.length >= 2);
  await page.click('#pick-flip');
  assert.deepEqual(await order(), [...first].reverse());
  const plate = await page.locator('.pick-result .tile-art').evaluate((e) => [e.className, getComputedStyle(e).backgroundImage]);
  assert.ok(plate[0].includes('vivid'));
  assert.ok(plate[1].includes('linear-gradient'));
  await page.click('#pick-kind [data-value="flat"]');
  assert.equal(await page.locator('#pick-flip').count(), 0);
  assert.equal(await page.locator('.pick-idea').count(), 0);
});

await check('F9 releasing the kept colour drops the picked gradient', async () => {
  await cell(page, KEY).click();
  await page.waitForSelector('#keep-colour');
  await page.locator('label[for="keep-colour"]').click();
  await page.waitForTimeout(500);
  const r = await rec(page, KEY);
  assert.equal(r.locked, false);
  assert.equal(r.pick, null);
  assert.equal(await page.$eval('.cell[data-key="' + KEY + '"] .tile-art', (e) => e.classList.contains('vivid')), true);
});

await check('F10 typing in the search keeps the side rail and the tiles that stay, instead of rebuilding them', async () => {
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    document.querySelectorAll('.cell').forEach((c) => (c._kept = true));
    document.querySelectorAll('.cell .tile-art').forEach((c) => (c._kept = true));
    document.getElementById('rail')._kept = true;
    document.querySelectorAll('#rail section, #rail .rail-head').forEach((c) => (c._kept = true));
    window.__added = [];
    new MutationObserver((l) => { for (const r of l) for (const n of r.addedNodes) if (n.nodeType === 1) window.__added.push(n.localName + '.' + (n.className || '')); }).observe(document.body, { childList: true, subtree: true });
  });
  await page.focus('#search');
  await page.keyboard.type('pa', { delay: 90 });
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'search');
  assert.equal(await page.inputValue('#search'), 'pa');
  const added = await page.evaluate(() => window.__added);
  assert.ok(!added.some((n) => /rail|tile-art|img|glyph/.test(n)), added.join(' '));
  assert.ok(await page.evaluate(() => [...document.querySelectorAll('#rail section, #rail .rail-head')].every((c) => c._kept)));
  assert.ok(await page.evaluate(() => [...document.querySelectorAll('.cell')].every((c) => c._kept)));
  assert.ok(await page.evaluate(() => [...document.querySelectorAll('.cell .tile-art')].every((c) => c._kept)));
  await page.fill('#search', '');
  await page.waitForTimeout(300);
  assert.ok(await page.evaluate(() => [...document.querySelectorAll('.cell .tile-art')].every((c) => c._kept)));
});

await check('F11 changing colours, mode and faithful in place never swaps the tile elements or their images', async () => {
  await page.evaluate(() => {
    document.querySelectorAll('.cell .tile-art').forEach((c) => (c._kept = true));
    window.__imgs = [...document.querySelectorAll('.cell .tile-art img')].length;
  });
  await page.click('.seg:has-text("Muted") button[data-value="muted"]');
  await page.waitForTimeout(250);
  await page.click('.seg:has-text("Vivid") button[data-value="vivid"]');
  await page.waitForTimeout(250);
  await page.click('#faithful-btn');
  await page.waitForTimeout(250);
  await page.click('#faithful-btn');
  await page.waitForTimeout(250);
  await page.locator('.cell').first().click();
  await page.keyboard.press('Escape');
  assert.ok(await page.evaluate(() => [...document.querySelectorAll('.cell .tile-art')].every((c) => c._kept)));
});

await check('F12 a picked gradient survives a reload and reopening the project', async () => {
  await cell(page, KEY).click();
  await expand(page);
  await page.click('#pick-kind [data-value="gradient"]');
  await page.locator('.pick-swatch').nth(1).click();
  await page.locator('.pick-swatch').nth(2).click();
  await page.click('#pick-apply');
  await page.waitForFunction(() => window.__studio.state.unsaved === false && window.__studio.saved > 0, null, { timeout: 15000 });
  const was = await rec(page, KEY);
  assert.equal(was.pick, 'gradient');
  await page.reload();
  await page.waitForSelector('.recent');
  await page.locator('.recent').first().click();
  await page.waitForFunction((n) => document.querySelectorAll('.gallery .cell .tile-art:not(.ghost)').length === n, files.length, { timeout: 60000 });
  assert.deepEqual(await rec(page, KEY), was);
  assert.equal(await tileVar(page, KEY, '--tile-lo'), was.tint[2]);
});

const ar = await open('ar');
await check('F13 Arabic loads its words on demand, and reads right to left with the new controls', async () => {
  assert.ok(requests.includes('/ar.js'));
  assert.equal(await ar.evaluate(() => document.documentElement.dir), 'rtl');
  assert.equal((await ar.textContent('#faithful-btn')).trim(), 'الأصلية');
  await cell(ar, KEY).click();
  await expand(ar);
  assert.ok((await ar.textContent('#palette .hint-text')).includes('اختر'));
});

await check('F14 no errors or warnings were logged', () => {
  assert.deepEqual(logs, []);
});

await browser.close();
server.close && server.close();
finish();
