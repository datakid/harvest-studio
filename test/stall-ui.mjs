import { chromiumPath } from './util.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
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
const SLOW = 'survival-mirror';
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
};
const syntheticIcon = (key) => {
  const size = 96;
  let h = 7;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const rgb = [(h >>> 3) & 255, (h >>> 11) & 255, (h >>> 19) & 255];
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const inside = (x - 48) ** 2 + (y - 48) ** 2 < 40 ** 2;
      const bar = Math.abs(x - 48) < 6 + (h % 20) || Math.abs(y - 48) < 6 + ((h >>> 5) % 20);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      const c = inside ? (bar ? [255 - rgb[0], 255 - rgb[1], 255 - rgb[2]] : rgb) : [0, 0, 0];
      raw[o] = c[0];
      raw[o + 1] = c[1];
      raw[o + 2] = c[2];
      raw[o + 3] = inside ? 255 : 0;
    }
  }
  const head = Buffer.alloc(13);
  head.writeUInt32BE(size, 0);
  head.writeUInt32BE(size, 4);
  head.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
};
const iconOf = (key) => {
  const f = path.join(fixturesDir, key + '.png');
  return fs.existsSync(f) ? fs.readFileSync(f) : syntheticIcon(key);
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
const exe = chromiumPath();
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
await page.waitForFunction(() => window.__studio && window.__studio.state.stage === 'work', null, { timeout: 120000 });
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

await check('the hung site costs one timeout and one retry, not several in a row', () => {
  assert.ok(elapsed < 22000, 'took ' + elapsed + ' ms');
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
