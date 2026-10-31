import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { chromium } from 'playwright-core';
import { serve } from '../scripts/serve.mjs';
import { check, finish, fixturesDir, studioDir } from './util.mjs';
import { createHandler } from '../api/fetch.js';
import { buildTargets } from '../core/index.js';

const catalogue = JSON.parse(fs.readFileSync(path.join(studioDir, 'config', 'catalogue.json'), 'utf8'));
const extras = JSON.parse(fs.readFileSync(path.join(studioDir, 'config', 'extras.json'), 'utf8'));
const keyByHost = new Map(buildTargets(catalogue).map((t) => [new URL(t.url).host, t.key]));
for (const [key, v] of Object.entries(extras)) keyByHost.set(new URL(typeof v === 'string' ? v : v.url).host, key);
const expected = buildTargets(catalogue).length + Object.keys(extras).length;

const HANG = 'protocols';
const BAD = 'solver';
const SLOW = 'to-do';
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const iconOf = (key) => {
  const f = path.join(fixturesDir, key + '.png');
  return fs.readFileSync(fs.existsSync(f) ? f : path.join(studioDir, 'public', 'icon-192.png'));
};
const reply = (type, body) => ({ status: 200, headers: { 'content-type': type }, body: Readable.from([Buffer.from(body)]), destroy() {} });

const proxy = createHandler({
  resolve: async () => [{ address: '93.184.216.34', family: 4 }],
  request: async ({ url }) => {
    const key = keyByHost.get(url.host);
    if (!key) return { ...reply('text/html', 'missing'), status: 404 };
    if (key === HANG) {
      await delay(5000);
      throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
    }
    if (key === BAD) throw new Error('refused');
    if (key === SLOW) await delay(2500);
    await delay(30 + ((key.length * 17) % 200));
    if (url.pathname === '/') return reply('text/html', '<html><head><link rel="icon" type="image/png" sizes="192x192" href="/icon.png"></head></html>');
    if (url.pathname === '/icon.png') return reply('image/png', iconOf(key));
    return { ...reply('text/html', 'missing'), status: 404 };
  },
  env: { STUDIO_TOKEN: 'tok' }
});

const port = 4195;
const server = await serve(port, proxy);
const exe = fs.readdirSync('/opt/pw-browsers').filter((d) => d.startsWith('chromium-')).flatMap((d) => ['chrome-linux64', 'chrome-linux'].map((s) => '/opt/pw-browsers/' + d + '/' + s + '/chrome')).find((p) => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
await ctx.addInitScript((p) => {
  try {
    localStorage.setItem('hs:prefs', JSON.stringify({ proxyUrl: p }));
    sessionStorage.setItem('hs:token', 'tok');
  } catch {}
  window.__m = { gaps: [], last: 0 };
  const tick = (t) => {
    if (window.__m.last) window.__m.gaps.push(t - window.__m.last);
    window.__m.last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}, 'http://localhost:' + port + '/api/fetch');
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));
const cdp = await ctx.newCDPSession(page);
await page.goto('http://localhost:' + port + '/');
await page.waitForSelector('#harvest-catalogue');
await page.waitForTimeout(500);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
await page.evaluate(() => { window.__m.gaps.length = 0; });

const started = Date.now();
await page.click('#harvest-catalogue');
const texts = new Set();
const poll = setInterval(async () => {
  try {
    texts.add(await page.evaluate(() => (document.querySelector('.progress-text') || {}).textContent || ''));
  } catch {}
}, 400);
await page.waitForFunction(() => document.querySelectorAll('.gallery .cell .tile-art:not(.ghost)').length > 0, null, { timeout: 120000 });
clearInterval(poll);
const elapsed = Date.now() - started;
await page.waitForTimeout(800);
const result = await page.evaluate(() => ({
  gaps: window.__m.gaps,
  cells: document.querySelectorAll('.gallery .cell').length,
  items: Object.fromEntries([...window.__studio.state.items.values()].map((i) => [i.key, { status: i.status, source: i.source && i.source.type }]))
}));

await check('every site is harvested even though one hangs, one is refused and one is slow', () => {
  assert.equal(result.cells, expected);
  assert.ok(Object.values(result.items).every((i) => i.status === 'found'), JSON.stringify(Object.entries(result.items).filter(([, i]) => i.status !== 'found')));
  assert.equal(result.items[HANG].source, 'bundled');
  assert.equal(result.items[BAD].source, 'bundled');
  assert.equal(result.items[SLOW].source, 'png');
});

await check('the hung site costs one timeout, not several in a row', () => {
  assert.ok(elapsed < 14000, 'took ' + elapsed + ' ms');
});

await check('the progress text names the sites it is still waiting for', () => {
  const waiting = [...texts].filter((x) => /waiting for/.test(x));
  assert.ok(waiting.length > 0, [...texts].join(' | '));
  assert.ok(waiting.some((x) => /Protocols/.test(x)), waiting.join(' | '));
});

await check('the page keeps painting while it waits (4x slower CPU)', () => {
  const worst = Math.max(...result.gaps);
  const stalls = result.gaps.filter((g) => g > 1000).length;
  assert.ok(worst < 1200, 'worst frame gap ' + Math.round(worst) + ' ms');
  assert.equal(stalls, 0);
});

await check('no console errors during the run', () => assert.deepEqual(errors, []));

await browser.close();
server.close();
finish();
