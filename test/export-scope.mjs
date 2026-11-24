import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { unzipSync } from '../node_modules/fflate/esm/browser.js';
import { decodeImage } from '../core/index.js';
import { serve } from '../scripts/serve.mjs';
import { check, finish, fixturesDir, chromiumPath } from './util.mjs';

const files = fs.readdirSync(fixturesDir).filter((f) => f.endsWith('.png')).slice(0, 12).map((f) => path.join(fixturesDir, f));
const keysOf = (list) => list.map((f) => path.basename(f, '.png'));
const probe = keysOf(files).sort((a, b) => b.length - a.length)[0];
const server = await serve(4233, null);
const browser = await chromium.launch({ executablePath: chromiumPath(), args: ['--no-sandbox'] });
const logs = [];
const open = async (lang = 'en') => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && logs.push(m.type() + ': ' + m.text()));
  page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
  await page.addInitScript((l) => localStorage.setItem('hs:prefs', JSON.stringify({ lang: l })), lang);
  await page.goto('http://localhost:4233/');
  await page.setInputFiles('#pick-files', files);
  await page.waitForSelector('.chip');
  await page.click('#go');
  await page.waitForFunction(() => window.__studio && window.__studio.state.stage === 'work', null, { timeout: 120000 });
  await page.waitForTimeout(800);
  return page;
};
const selectFirst = async (page, n) => {
  await page.locator('.cell').first().click();
  if (n > 1) await page.locator('.cell').nth(n - 1).click({ modifiers: ['Shift'] });
  await page.waitForFunction((n) => document.querySelectorAll('.cell[aria-selected="true"]').length === n, n);
  return page.locator('.cell[aria-selected="true"]').evaluateAll((cells) => cells.map((c) => c.getAttribute('data-key')).sort());
};
const allKeys = (page) => page.evaluate(() => [...window.__studio.state.records.keys()].sort());
const download = async (page, selector) => {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(selector)]);
  const zip = unzipSync(new Uint8Array(fs.readFileSync(await dl.path())));
  return { name: dl.suggestedFilename(), zip };
};
const manifestKeys = (zip) => Object.keys(JSON.parse(new TextDecoder().decode(zip['icons/manifest.v2.json'])).icons).sort();
const scopeValue = (page, id) => page.locator('#' + id + ' [aria-checked="true"]').getAttribute('data-value');

await check('E1 the selection bar exports only the selected icons as a launcher set', async () => {
  const page = await open();
  const keys = await selectFirst(page, 3);
  assert.equal(keys.length, 3);
  await page.click('#sel-export');
  await page.waitForSelector('#export-sheet .gate', { timeout: 120000 });
  assert.equal(await scopeValue(page, 'exp-launcher-scope'), 'selection');
  assert.equal(await page.locator('#exp-partial').count(), 1);
  const { name, zip } = await download(page, '#download-launcher');
  assert.equal(name, 'launcher-icons-selection.zip');
  assert.deepEqual(manifestKeys(zip), keys);
  const report = JSON.parse(new TextDecoder().decode(zip['icons/harvest-report.json']));
  assert.deepEqual(report.items.map((i) => i.key).sort(), keys);
  assert.equal(report.summary.total, 3);
  const sites = Object.keys(zip).filter((n) => /^icons\/reports\/(?!_index)[^/]+\.json$/.test(n));
  assert.equal(sites.length, 3);
  const index = JSON.parse(new TextDecoder().decode(zip['icons/reports/_index.json']));
  assert.equal(index.total, 3);
  await page.context().close();
});

await check('E2 the launcher set stays complete by default, even with tiles selected', async () => {
  const page = await open();
  const all = await allKeys(page);
  await selectFirst(page, 3);
  await page.click('#export-btn');
  await page.waitForSelector('#export-sheet .gate', { timeout: 120000 });
  assert.equal(await scopeValue(page, 'exp-launcher-scope'), 'all');
  assert.equal(await page.locator('#exp-partial').count(), 0);
  const { name, zip } = await download(page, '#download-launcher');
  assert.equal(name, 'launcher-icons.zip');
  assert.deepEqual(manifestKeys(zip), all);
  await page.context().close();
});

await check('E3 switching the scope rebuilds the launcher set each time', async () => {
  const page = await open();
  const all = await allKeys(page);
  const keys = await selectFirst(page, 2);
  await page.click('#export-btn');
  await page.waitForSelector('#export-sheet .gate', { timeout: 120000 });
  await page.click('#exp-launcher-scope [data-value="selection"]');
  await page.waitForSelector('#exp-partial', { timeout: 120000 });
  assert.deepEqual(manifestKeys((await download(page, '#download-launcher')).zip), keys);
  await page.click('#exp-launcher-scope [data-value="all"]');
  await page.waitForSelector('#export-sheet .gate');
  await page.waitForFunction(() => !document.querySelector('#exp-partial'));
  assert.deepEqual(manifestKeys((await download(page, '#download-launcher')).zip), all);
  await page.click('#exp-launcher-scope [data-value="selection"]');
  await page.waitForSelector('#exp-partial', { timeout: 120000 });
  assert.deepEqual(manifestKeys((await download(page, '#download-launcher')).zip), keys);
  await page.context().close();
});

await check('E4 a single selected tile can be exported on its own', async () => {
  const page = await open();
  const keys = await selectFirst(page, 1);
  assert.equal(keys.length, 1);
  await page.click('#export-btn');
  await page.waitForSelector('#export-sheet .gate', { timeout: 120000 });
  await page.click('#exp-launcher-scope [data-value="selection"]');
  await page.waitForSelector('#exp-partial', { timeout: 120000 });
  assert.deepEqual(manifestKeys((await download(page, '#download-launcher')).zip), keys);
  await page.context().close();
});

await check('E5 the visible tiles can be exported as a launcher set', async () => {
  const page = await open();
  await page.fill('#search', probe);
  await page.waitForTimeout(400);
  const shown = await page.locator('.cell').evaluateAll((cells) => cells.filter((c) => c.offsetParent !== null).map((c) => c.getAttribute('data-key')).sort());
  assert.ok(shown.length >= 1 && shown.length < files.length, String(shown.length));
  await page.click('#export-btn');
  await page.waitForSelector('#export-sheet .gate', { timeout: 120000 });
  await page.click('#exp-launcher-scope [data-value="visible"]');
  await page.waitForSelector('#exp-partial', { timeout: 120000 });
  const { name, zip } = await download(page, '#download-launcher');
  assert.equal(name, 'launcher-icons-visible.zip');
  assert.deepEqual(manifestKeys(zip), shown);
  await page.context().close();
});

await check('E6 per-app packs and custom sizes follow the selection as well', async () => {
  const page = await open();
  const keys = await selectFirst(page, 2);
  const others = (await allKeys(page)).filter((k) => !keys.includes(k));
  await page.click('#sel-export');
  await page.waitForSelector('#export-sheet .gate', { timeout: 120000 });
  await page.getByRole('radio', { name: 'Per-app packs' }).click();
  assert.equal(await scopeValue(page, 'exp-scope'), 'selection');
  const packs = (await download(page, '#download-packs')).zip;
  const dirs = [...new Set(Object.keys(packs).map((n) => n.split('/')[0]))].sort();
  assert.deepEqual(dirs, keys);
  await page.getByRole('radio', { name: 'Custom' }).click();
  assert.equal(await scopeValue(page, 'exp-scope'), 'selection');
  const custom = Object.keys((await download(page, '#download-custom')).zip);
  for (const k of keys) assert.ok(custom.some((n) => n.includes(k)), k);
  for (const k of others) assert.ok(!custom.some((n) => n.includes(k)), k);
  await page.context().close();
});

await check('E7 the Arabic interface carries the new labels and the partial note', async () => {
  const page = await open('ar');
  await selectFirst(page, 2);
  const label = await page.locator('#sel-export').innerText();
  assert.equal(label.trim(), 'صدّر');
  await page.click('#sel-export');
  await page.waitForSelector('#export-sheet .gate', { timeout: 120000 });
  assert.match(await page.locator('#exp-partial').innerText(), /مجموعة كاملة بذاتها/);
  await page.context().close();
});

const inked = (image) => {
  let n = 0;
  for (let i = 3; i < image.data.length; i += 4) if (image.data[i] > 0) n++;
  return n;
};
const text = (bytes) => new TextDecoder().decode(bytes);

await check('E9 SVG export writes the traced mark of each selected app that has one, and the files render', async () => {
  const page = await open();
  const keys = await selectFirst(page, 6);
  const traced = await page.evaluate((list) => list.filter((k) => { const r = window.__studio.state.records.get(k); return r.trace && r.trace.accepted; }).sort(), keys);
  assert.ok(traced.length >= 2, 'traced ' + traced.length);
  await page.click('#sel-export');
  await page.waitForSelector('#export-sheet .gate', { timeout: 120000 });
  await page.getByRole('radio', { name: 'Custom' }).click();
  await page.waitForSelector('#cu-svg-note');
  assert.match(await page.locator('#cu-svg-note').innerText(), new RegExp('\\b' + traced.length + ' of 6\\b'));
  await page.getByRole('checkbox', { name: 'PNG' }).uncheck();
  await page.getByRole('checkbox', { name: 'WEBP' }).uncheck();
  await page.getByRole('checkbox', { name: 'SVG' }).check();
  const { zip } = await download(page, '#download-custom');
  const names = Object.keys(zip);
  assert.deepEqual(names.filter((n) => n.endsWith('.svg')).sort(), traced.map((k) => k + '.svg'));
  assert.ok(!names.some((n) => /\.(png|webp|avif|jxl|ico)$/.test(n)));
  const manifest = JSON.parse(text(zip['manifest.json']));
  for (const k of keys) assert.deepEqual(manifest.icons[k].files, traced.includes(k) ? [k + '.svg'] : []);
  for (const k of traced) {
    const svg = text(zip[k + '.svg']);
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 24 24" fill="[^"]+">/);
    assert.ok(svg.includes('<path') && svg.trim().endsWith('</svg>'));
    const { image } = await decodeImage(zip[k + '.svg'], 'svg');
    assert.ok(inked(image) > 0, k);
  }
  await page.context().close();
});

await check('E10 SVG sits next to raster formats and sizes in one Custom export', async () => {
  const page = await open();
  const keys = await selectFirst(page, 3);
  const traced = await page.evaluate((list) => list.filter((k) => { const r = window.__studio.state.records.get(k); return r.trace && r.trace.accepted; }).sort(), keys);
  await page.click('#sel-export');
  await page.waitForSelector('#export-sheet .gate', { timeout: 120000 });
  await page.getByRole('radio', { name: 'Custom' }).click();
  await page.getByRole('checkbox', { name: 'SVG' }).check();
  const { zip } = await download(page, '#download-custom');
  const names = Object.keys(zip);
  for (const k of keys) assert.ok(names.includes(k + '-192.png') && names.includes(k + '-192.webp'), k);
  assert.deepEqual(names.filter((n) => n.endsWith('.svg')).sort(), traced.map((k) => k + '.svg'));
  await page.context().close();
});

await check('E11 the launcher set carries a valid SVG glyph sprite for exactly the traced icons it holds', async () => {
  const page = await open();
  const keys = await selectFirst(page, 4);
  await page.click('#sel-export');
  await page.waitForSelector('#export-sheet .gate', { timeout: 120000 });
  const { zip } = await download(page, '#download-launcher');
  const manifest = JSON.parse(text(zip['icons/manifest.v2.json']));
  const spriteName = Object.keys(zip).find((n) => /^icons\/glyphs\.[0-9a-f]{8}\.svg$/.test(n));
  assert.ok(spriteName);
  assert.ok(manifest.glyphSprite.file.endsWith(spriteName.split('/').pop()));
  const sprite = text(zip[spriteName]);
  assert.ok(sprite.startsWith('<svg xmlns="http://www.w3.org/2000/svg">') && sprite.endsWith('</svg>'));
  const symbols = [...sprite.matchAll(/<symbol id="(g-[^"]+)"[^>]*>[\s\S]*?<\/symbol>/g)];
  const expected = Object.values(manifest.icons).filter((v) => v.glyph && v.glyph.symbol).map((v) => v.glyph.symbol).sort();
  assert.deepEqual(symbols.map((m) => m[1]).sort(), expected);
  assert.ok(expected.length >= 1 && expected.every((id) => keys.includes(id.slice(2))));
  for (const m of symbols) {
    const standalone = m[0].replace('<symbol', '<svg xmlns="http://www.w3.org/2000/svg"').replace('</symbol>', '</svg>');
    const { image } = await decodeImage(new TextEncoder().encode(standalone), 'svg');
    assert.ok(inked(image) > 0, m[1]);
  }
  await page.context().close();
});

await check('E13 tiles added by file or link are selected, so the new apps export on their own', async () => {
  const page = await open();
  const before = await allKeys(page);
  const extra = fs.readdirSync(fixturesDir).filter((f) => f.endsWith('.png')).map((f) => path.join(fixturesDir, f)).filter((f) => !files.includes(f)).slice(0, 2);
  assert.equal(extra.length, 2);
  await page.setInputFiles('#add-pick-files', extra);
  await page.waitForFunction((n) => window.__studio.state.records.size === n && window.__studio.state.adding === 0, before.length + 2, { timeout: 120000 });
  const added = (await allKeys(page)).filter((k) => !before.includes(k)).sort();
  assert.equal(added.length, 2);
  const sel = await page.evaluate(() => [...window.__studio.state.sel].sort());
  assert.deepEqual(sel, added);
  await page.click('#sel-export');
  await page.waitForSelector('#export-sheet .gate', { timeout: 120000 });
  assert.deepEqual(manifestKeys((await download(page, '#download-launcher')).zip), added);
  await page.context().close();
});

await check('E14 a partial launcher set opens again from its manifest and atlas with the same icons', async () => {
  const page = await open();
  const keys = await selectFirst(page, 3);
  await page.click('#sel-export');
  await page.waitForSelector('#export-sheet .gate', { timeout: 120000 });
  const { zip } = await download(page, '#download-launcher');
  await page.context().close();
  const bundle = Object.entries(zip)
    .filter(([n]) => /^icons\/(manifest\.v2\.json|atlas\.[0-9a-f]{8}\.webp|glyph-atlas\.[0-9a-f]{8}\.webp|glyphs\.[0-9a-f]{8}\.svg)$/.test(n))
    .map(([n, bytes]) => ({ name: n.split('/').pop(), mimeType: n.endsWith('.json') ? 'application/json' : n.endsWith('.svg') ? 'image/svg+xml' : 'image/webp', buffer: Buffer.from(bytes) }));
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
  await p.goto('http://localhost:4233/');
  await p.setInputFiles('#pick-files', bundle);
  await p.waitForSelector('#manifest-panel');
  assert.equal(await p.locator('#open-set').isEnabled(), true);
  await p.click('#open-set');
  await p.waitForFunction(() => window.__studio && window.__studio.state.stage === 'work', null, { timeout: 120000 });
  assert.deepEqual(await allKeys(p), keys);
  assert.equal(await p.locator('.gallery .cell').count(), 3);
  await ctx.close();
});

await check('E12 no console errors', () => assert.deepEqual(logs, []));

await browser.close();
server.close && server.close();
finish();
