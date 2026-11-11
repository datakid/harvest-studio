import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { serve } from '../scripts/serve.mjs';
import { check, finish, fixturesDir, chromiumPath } from './util.mjs';

const files = fs.readdirSync(fixturesDir).filter((f) => f.endsWith('.png')).slice(0, 12).map((f) => path.join(fixturesDir, f));
const server = await serve(4197, null);
const browser = await chromium.launch({ executablePath: chromiumPath(), args: ['--no-sandbox'] });
const logs = [];
const open = async (viewport, scheme = 'light', lang = 'en', extra = {}) => {
  const ctx = await browser.newContext({ viewport, colorScheme: scheme, ...extra });
  const page = await ctx.newPage();
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && logs.push(m.type() + ': ' + m.text()));
  page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
  await page.addInitScript((l) => localStorage.setItem('hs:prefs', JSON.stringify({ lang: l })), lang);
  await page.goto('http://localhost:4197/');
  await page.setInputFiles('#pick-files', files);
  await page.waitForSelector('.chip');
  await page.click('#go');
  await page.waitForFunction(() => window.__studio && window.__studio.state.stage === 'work', null, { timeout: 120000 });
  await page.waitForTimeout(800);
  return page;
};
const selected = (page) => page.locator('.cell[aria-selected="true"]').count();
const recs = (page) => page.evaluate(() => [...window.__studio.state.records.values()].map((r) => ({ key: r.key, locked: !!r.locked, scale: r.adjust && r.adjust.scale !== undefined ? r.adjust.scale : null })));

const page = await open({ width: 1440, height: 900 });

await check('W1 click, shift-range, ctrl-toggle, select all and Escape drive the selection', async () => {
  await page.locator('.cell').nth(1).click();
  assert.equal(await selected(page), 1);
  await page.locator('.cell').nth(4).click({ modifiers: ['Shift'] });
  assert.equal(await selected(page), 4);
  await page.locator('.cell').nth(2).click({ modifiers: ['Control'] });
  assert.equal(await selected(page), 3);
  await page.keyboard.press('Escape');
  assert.equal(await selected(page), 0);
  await page.locator('.cell').first().click();
  await page.keyboard.press('Control+a');
  assert.equal(await selected(page), await page.locator('.cell').count());
  await page.keyboard.press('Escape');
});

await check('W2 a batch size change is one undo step for every selected tile', async () => {
  await page.locator('.cell').nth(0).click();
  await page.locator('.cell').nth(2).click({ modifiers: ['Shift'] });
  const before = await page.evaluate(() => window.__studio.state.records.size);
  await page.keyboard.press(']');
  await page.waitForTimeout(300);
  const after = (await recs(page)).filter((r) => r.scale !== null);
  assert.equal(after.length, 3);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  assert.equal((await recs(page)).filter((r) => r.scale !== null).length, 0);
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(300);
  assert.equal((await recs(page)).filter((r) => r.scale !== null).length, 3);
  assert.equal(await page.evaluate(() => window.__studio.state.records.size), before);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Escape');
});

await check('W3 removing several tiles is one undo step', async () => {
  const total = await page.locator('.cell').count();
  await page.locator('.cell').nth(0).click();
  await page.locator('.cell').nth(1).click({ modifiers: ['Shift'] });
  await page.keyboard.press('Delete');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.cell').count(), total - 2);
  await page.locator('[data-act="toast-action"]').click();
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.cell').count(), total);
});

await check('W4 the slash key focuses search, which filters the canvas, and the question mark lists shortcuts', async () => {
  await page.keyboard.press('Escape');
  await page.keyboard.press('/');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'search');
  const total = await page.locator('.cell').count();
  await page.keyboard.type('zzzz-no-match');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.cell').count(), 0);
  await page.fill('#search', '');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.cell').count(), total);
  await page.locator('body').click({ position: { x: 700, y: 400 } });
  await page.keyboard.press('?');
  await page.waitForSelector('#shortcuts-sheet[open] kbd');
  await page.keyboard.press('Escape');
});

await check('W5 K keeps the colour of the selected tiles and toggles it back', async () => {
  await page.locator('.cell').nth(3).click();
  const key = await page.evaluate(() => [...window.__studio.state.sel][0]);
  const locked = () => page.evaluate((k) => !!window.__studio.state.records.get(k).locked, key);
  await page.keyboard.press('k');
  await page.waitForTimeout(300);
  assert.equal(await locked(), true);
  await page.keyboard.press('k');
  await page.waitForTimeout(300);
  assert.equal(await locked(), false);
});

await check('W6 inspector tabs move with the arrow keys and carry the right state', async () => {
  await page.locator('.cell').nth(3).click();
  await page.focus('#tabbtn-look');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.getAttribute('#tabbtn-source', 'aria-selected'), 'true');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.getAttribute('#tabbtn-app', 'aria-selected'), 'true');
  assert.equal(await page.locator('#tab-app').getAttribute('role'), 'tabpanel');
  await page.click('#tabbtn-look');
});

await check('W7 every control in the work view has an accessible name', async () => {
  const bad = await page.$$eval('button, input, select, [role="radio"], [role="option"]', (els) =>
    els
      .filter((e) => e.offsetParent && e.type !== 'hidden')
      .filter((e) => {
        const label = e.getAttribute('aria-label') || (e.labels && e.labels[0] && e.labels[0].textContent) || e.textContent || e.getAttribute('placeholder') || e.getAttribute('title');
        const named = e.getAttribute('aria-labelledby') && document.getElementById(e.getAttribute('aria-labelledby'));
        return !(label && label.trim()) && !named;
      })
      .map((e) => e.outerHTML.slice(0, 100))
  );
  assert.deepEqual(bad, []);
});

for (const scheme of ['light', 'dark']) {
  await check('W8 text tokens reach contrast AA in ' + scheme, async () => {
    const p = await open({ width: 1200, height: 800 }, scheme);
    const ratios = await p.evaluate(() => {
      const c = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
      c.canvas.width = c.canvas.height = 1;
      const probe = document.body.appendChild(document.createElement('i'));
      const resolve = (name) => {
        probe.style.color = 'var(' + name + ')';
        return getComputedStyle(probe).color;
      };
      const rgb = (v) => {
        c.clearRect(0, 0, 1, 1);
        c.fillStyle = '#000';
        c.fillStyle = v;
        c.fillRect(0, 0, 1, 1);
        return [...c.getImageData(0, 0, 1, 1).data].slice(0, 3);
      };
      const lum = ([r, g, b]) => {
        const f = (x) => ((x /= 255) <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const ratio = (a, b) => {
        const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((m, n) => n - m);
        return (x + 0.05) / (y + 0.05);
      };
      const v = resolve;
      return { ink: ratio(v('--ink'), v('--bg')), muted: ratio(v('--muted'), v('--bg')), mutedSurface: ratio(v('--muted'), v('--surface')), bad: ratio(v('--bad'), v('--bg')), onInk: ratio(v('--on-ink'), v('--ink')) };
    });
    assert.ok(ratios.ink >= 7, JSON.stringify(ratios));
    assert.ok(ratios.muted >= 4.5, JSON.stringify(ratios));
    assert.ok(ratios.mutedSurface >= 4.5, JSON.stringify(ratios));
    assert.ok(ratios.bad >= 4.5, JSON.stringify(ratios));
    assert.ok(ratios.onInk >= 4.5, JSON.stringify(ratios));
    await p.context().close();
  });
}

await check('W9 reduced motion turns transitions and entrance animation off', async () => {
  const p = await open({ width: 1200, height: 800 }, 'light', 'en', { reducedMotion: 'reduce' });
  const durations = await p.$$eval('.cell, .btn, .tile-art', (els) => els.slice(0, 30).map((e) => getComputedStyle(e).transitionDuration + '|' + getComputedStyle(e).animationDuration));
  const live = durations.filter((d) => d.split('|').some((x) => x.split(',').some((y) => parseFloat(y) > 0.011)));
  assert.deepEqual(live, []);
  await p.context().close();
});

await check('W10 Arabic mirrors the work layout and never scrolls sideways', async () => {
  const p = await open({ width: 1440, height: 900 }, 'light', 'ar');
  const geo = await p.evaluate(() => ({ dir: document.documentElement.dir, rail: document.querySelector('.rail').getBoundingClientRect().x, canvas: document.querySelector('.canvas').getBoundingClientRect().x, overflow: document.documentElement.scrollWidth - innerWidth }));
  assert.equal(geo.dir, 'rtl');
  assert.ok(geo.rail > geo.canvas, JSON.stringify(geo));
  assert.ok(geo.overflow <= 0, JSON.stringify(geo));
  await p.context().close();
});

await check('W11 on a phone the rail is a drawer and the inspector a bottom sheet that closes', async () => {
  const p = await open({ width: 390, height: 800 });
  assert.ok((await p.evaluate(() => document.querySelector('.rail').getBoundingClientRect().right)) <= 1);
  await p.click('.rail-open');
  await p.waitForTimeout(500);
  assert.ok((await p.evaluate(() => document.querySelector('.rail').getBoundingClientRect().left)) >= 0);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(500);
  await p.locator('.cell').first().click();
  await p.waitForTimeout(500);
  const box = await p.evaluate(() => document.getElementById('inspector').getBoundingClientRect());
  assert.ok(box.top > 100 && Math.abs(box.bottom - 800) < 2, JSON.stringify(box));
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
  await p.click('.insp-close');
  assert.equal(await p.locator('.cell[aria-selected="true"]').count(), 0);
  await p.context().close();
});

await check('W13 dropdowns, checkboxes, sliders and colour swatches use the app styling and no native datalist remains', async () => {
  await page.locator('.cell').nth(3).click();
  await page.locator('#fine-tune summary').click();
  await page.click('#export-btn');
  await page.locator('#exp-tabs button').last().click();
  const styled = await page.evaluate(() => {
    const ap = (sel) => [...document.querySelectorAll(sel)].map((e) => getComputedStyle(e).appearance);
    return { select: ap('select'), check: ap('input[type="checkbox"]:not([role="switch"])'), range: ap('input[type="range"]'), datalists: document.querySelectorAll('datalist').length };
  });
  assert.ok(styled.select.length > 0 && styled.select.every((a) => a !== 'auto'), JSON.stringify(styled));
  assert.ok(styled.check.length > 0 && styled.check.every((a) => a === 'none'), JSON.stringify(styled));
  assert.ok(styled.range.length > 0 && styled.range.every((a) => a === 'none'), JSON.stringify(styled));
  assert.equal(styled.datalists, 0);
  await page.keyboard.press('Escape');
});

await check('W14 search is fuzzy, reads aliases, addresses and colours, and ranks the best match first', async () => {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto('http://localhost:4197/');
  await p.click('#harvest-fihrist');
  await p.waitForFunction(() => window.__studio && window.__studio.state.stage === 'work', null, { timeout: 120000 });
  await p.waitForTimeout(1500);
  const keys = async (q) => {
    await p.fill('#search', q);
    await p.waitForTimeout(500);
    return p.evaluate(() => [...document.querySelectorAll('.cell')].map((c) => c.dataset.key));
  };
  assert.equal((await keys('ledgr'))[0].startsWith('ledger-form'), true);
  assert.ok((await keys('khargy')).some((k) => k.startsWith('ledger-form')));
  assert.equal((await keys('harv'))[0], 'harvest-studio');
  assert.ok((await keys('platen-2zj1')).includes('platen'));
  assert.ok((await keys('احمر')).length > 0);
  const red = await keys('red');
  assert.ok(red.length > 0 && red.length < 40);
  assert.equal((await keys('zzzzqx')).length, 0);
  assert.equal(await p.locator('.cell').count(), 0);
  assert.ok((await keys('')).length === 56);
  await p.close();
});

await check('W12 no console errors', () => assert.deepEqual(logs, []));

await browser.close();
server.close && server.close();
finish();
