import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { unzipSync } from '../node_modules/fflate/esm/browser.js';
import { chromium } from 'playwright-core';
import { serve } from '../scripts/serve.mjs';
import { check, finish, fixturesDir, here } from './util.mjs';
import * as core from '../core/index.js';

const files = fs.readdirSync(fixturesDir).filter((f) => f.endsWith('.png')).map((f) => path.join(fixturesDir, f));
const sampleDir = path.join(here, 'sample-output');
const manifest = JSON.parse(fs.readFileSync(path.join(sampleDir, 'manifest.v2.json'), 'utf8'));
const base = (f) => f.split('/').pop();
const bundle = [path.join(sampleDir, 'manifest.v2.json'), ...[manifest.atlas, manifest.glyphAtlas, manifest.glyphSprite].map((x) => path.join(sampleDir, base(x.file)))];

const server = await serve(4182);
const exe = fs.readdirSync('/opt/pw-browsers').filter((d) => d.startsWith('chromium-')).map((d) => '/opt/pw-browsers/' + d + '/chrome-linux/chrome').find((p) => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const logs = [];
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const watch = (page) => {
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && logs.push(m.type() + ': ' + m.text()));
  page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
};
const fresh = async () => {
  const page = await ctx.newPage();
  watch(page);
  await page.goto('http://localhost:4182/');
  return page;
};
const harvest = async (page) => {
  await page.setInputFiles('#pick-files', files);
  await page.waitForSelector('.chip');
  await page.click('#go');
  await page.waitForSelector('.gallery .cell .tile-art:not(.ghost)', { timeout: 120000 });
  await page.waitForTimeout(500);
};
const recs = (page) => page.evaluate(() => [...window.__studio.state.records.values()].filter((r) => r.hasImage).map((r) => ({ key: r.key, tint: r.tint, locked: r.locked })));
const hueGap = (a, b) => {
  const d = Math.abs(a - b) % (Math.PI * 2);
  return ((d > Math.PI ? Math.PI * 2 - d : d) * 180) / Math.PI;
};
const download = async (page) => {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download .zip' }).click()]);
  return unzipSync(new Uint8Array(fs.readFileSync(await dl.path())));
};

const page = await fresh();
await harvest(page);

await check('palette mode spreads every preset colour across the icons', async () => {
  await page.getByRole('radio', { name: 'Palette' }).click();
  await page.getByRole('button', { name: 'Ocean' }).click();
  const ocean = core.PRESETS.find((p) => p.id === 'ocean').colors;
  const hues = ocean.map((c) => core.hexToLch(c)[2]);
  const used = new Set();
  for (const r of await recs(page)) {
    const [, C, h] = core.hexToLch(r.tint[0]);
    const gaps = hues.map((x) => hueGap(x, h));
    const best = Math.min(...gaps);
    assert.ok(C < 0.02 || best <= 16, r.key + ' strays ' + best);
    used.add(gaps.indexOf(best));
  }
  assert.equal(used.size, ocean.length);
});

await check('palette edits: harmony, add, remove and the minimum of one colour', async () => {
  await page.locator('select[aria-label="Build from a colour"]').selectOption('triad');
  assert.equal(await page.locator('.pal-sw').count(), 3);
  await page.locator('.pal-sw button').first().click();
  assert.equal(await page.locator('.pal-sw').count(), 2);
  await page.locator('.pal-add input').evaluate((el) => {
    el.value = '#22aa55';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  assert.equal(await page.locator('.pal-sw').count(), 3);
  await page.evaluate(() => window.__studio.prefs.paletteColors.splice(1));
  await page.getByRole('button', { name: 'Sunset' }).click();
  assert.equal(await page.locator('.pal-sw').count(), 5);
});

await check('saved palettes persist across reloads and can be deleted', async () => {
  await page.getByPlaceholder('Palette name').fill('Mine');
  await page.getByRole('button', { name: 'Save palette' }).click();
  await page.getByRole('button', { name: 'Ocean' }).click();
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.pal-chip.saved').count(), 1);
  await page.locator('.pal-chip.saved > button').first().click();
  const sunset = core.PRESETS[0].colors;
  assert.deepEqual(await page.evaluate(() => window.__studio.prefs.paletteColors), sunset);
  const again = await fresh();
  const saved = await again.evaluate(() => JSON.parse(localStorage.getItem('hs:prefs')).palettes.map((p) => p.name));
  assert.deepEqual(saved, ['Mine']);
  await again.close();
  await page.getByRole('button', { name: 'Delete Mine' }).click();
  assert.equal(await page.locator('.pal-chip.saved').count(), 0);
});

await check('palette export is locked and passes the gate', async () => {
  await page.getByRole('button', { name: 'Export' }).click();
  await page.waitForSelector('.gate');
  assert.ok(await page.getByText('All checks pass').count() >= 0);
  const zip = await download(page);
  const m = JSON.parse(core.stableStringify ? new TextDecoder().decode(zip['icons/manifest.v2.json']) : '{}');
  const entries = Object.values(m.icons).filter((e) => e.tint);
  assert.ok(entries.length > 20);
  assert.ok(entries.every((e) => e.locked === true));
  await page.keyboard.press('Escape');
});

await check('an existing set opens from its manifest and atlas with colours intact', async () => {
  const p = await fresh();
  await p.setInputFiles('#pick-files', bundle);
  await p.waitForSelector('#manifest-panel');
  assert.match(await p.locator('#manifest-panel').innerText(), /33 icons/);
  assert.equal(await p.locator('#open-set').isEnabled(), true);
  await p.click('#open-set');
  await p.waitForSelector('.gallery .cell .tile-art:not(.ghost)', { timeout: 120000 });
  assert.equal(await p.locator('.gallery .cell').count(), Object.keys(manifest.icons).length);
  const got = Object.fromEntries((await recs(p)).map((r) => [r.key, r.tint]));
  for (const [key, e] of Object.entries(manifest.icons)) assert.deepEqual(got[key] || null, e.tint || null, key);
  const seed = await p.evaluate(() => window.__studio.state.seed);
  assert.equal(seed, '1f2e3d4c');
  await p.getByRole('button', { name: 'Export' }).click();
  await p.waitForSelector('.gate');
  const zip = await download(p);
  assert.ok(Object.keys(zip).some((n) => /manifest\.v2\.json$/.test(n)));
  await p.close();
});

await check('a manifest without its atlas asks for the file instead of failing', async () => {
  const p = await fresh();
  await p.setInputFiles('#pick-files', [bundle[0]]);
  await p.waitForSelector('#manifest-panel');
  assert.equal(await p.locator('#open-set').isDisabled(), true);
  assert.match(await p.locator('#manifest-panel').innerText(), new RegExp(base(manifest.atlas.file).replace(/\./g, '\\.')));
  await p.setInputFiles('#pick-files', [bundle[1]]);
  await p.waitForTimeout(200);
  assert.equal(await p.locator('#open-set').isEnabled(), true);
  await p.close();
});

await check('work autosaves as a project that reopens after a reload', async () => {
  const key = await page.evaluate(() => window.__studio.state.order[3]);
  await page.locator('.cell[data-key="' + key + '"]').click();
  await page.locator('.sel-head ~ .colour-row input[type=color]').evaluate((el) => {
    el.value = '#3a5bd0';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.fill('.proj-name', 'Launcher set');
  await page.waitForFunction(() => window.__studio.saved >= 1, null, { timeout: 15000 });
  await page.waitForTimeout(1200);
  const tintBefore = (await recs(page)).find((r) => r.key === key).tint;
  const reloaded = await fresh();
  await reloaded.waitForSelector('.recent');
  assert.match(await reloaded.locator('.recent').first().innerText(), /Launcher set/);
  assert.match(await reloaded.locator('.recent').first().innerText(), /33 icons/);
  await reloaded.locator('.recent').first().click();
  await reloaded.waitForSelector('.gallery .cell .tile-art:not(.ghost)', { timeout: 120000 });
  assert.equal(await reloaded.locator('.gallery .cell').count(), files.length);
  const now = (await recs(reloaded)).find((r) => r.key === key);
  assert.deepEqual(now.tint, tintBefore);
  assert.equal(now.locked, true);
  await reloaded.getByRole('button', { name: 'Export' }).click();
  await reloaded.waitForSelector('.gate');
  const zip = await download(reloaded);
  assert.ok(Object.keys(zip).some((n) => /atlas\..*\.webp$/.test(n)));
  await reloaded.keyboard.press('Escape');
  await reloaded.getByRole('button', { name: /Start over/ }).click();
  const before = await reloaded.locator('.recent').count();
  await reloaded.getByRole('button', { name: 'Delete Launcher set' }).click();
  await reloaded.waitForTimeout(300);
  assert.equal(await reloaded.locator('.recent').count(), before - 1);
  assert.equal(await reloaded.getByText('Launcher set').count(), 0);
  await reloaded.close();
});

await check('no console errors during any of it', async () => {
  assert.deepEqual(logs, []);
});

await browser.close();
server.close();
finish();
