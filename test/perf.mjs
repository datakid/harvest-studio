import { chromiumPath } from './util.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import zlib from 'node:zlib';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { chromium } from 'playwright-core';
import { serve } from '../scripts/serve.mjs';
import { check, finish, fixturesDir, studioDir, NOW } from './util.mjs';
import { createHandler } from '../api/fetch.js';
import { createLimiter, runHarvest, sha256 } from '../core/index.js';

const baseline = JSON.parse(fs.readFileSync(path.join(studioDir, 'docs', 'baseline.json'), 'utf8'));
const names = fs.readdirSync(fixturesDir).filter((f) => f.endsWith('.png')).map((f) => f.replace(/\.png$/, '')).sort();
const png = (name) => fs.readFileSync(path.join(fixturesDir, name + '.png'));
const HOSTS = 6;
const siteOf = (i) => ({ host: 'h' + ((i % HOSTS) + 1) + '.example.com', page: '/p' + i + '/' });
const pageUrl = (i) => 'https://' + siteOf(i).host + siteOf(i).page;
const html = (i) => Buffer.from('<html><head><link rel="icon" type="image/png" sizes="192x192" href="' + siteOf(i).page + 'icon.png"></head></html>');

const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];

await check('T6.1 the fixture CLI run stays inside the runner budget and the baseline ratio is reported', () => {
  const times = [];
  for (let i = 0; i < 3; i++) {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-perf-'));
    const start = performance.now();
    const r = spawnSync(process.execPath, [path.join(studioDir, 'cli', 'harvest.mjs'), '--from', path.join(studioDir, 'test', 'fixtures'), '--links', path.join(studioDir, 'test', 'links.json'), '--out', out], { encoding: 'utf8' });
    times.push(Math.round(performance.now() - start));
    fs.rmSync(out, { recursive: true, force: true });
    assert.equal(r.status, 0, r.stderr);
  }
  const m = median(times);
  const ratio = m / baseline.fixtureHarvest.cliMedianMs;
  console.log('     cli runs ' + times.join(', ') + ' ms, median ' + m + ' ms, ' + ratio.toFixed(2) + 'x the Phase 1 baseline of ' + baseline.fixtureHarvest.cliMedianMs + ' ms');
  assert.ok(m <= 20000, String(m));
  assert.ok(ratio <= baseline.v02Guard.maxRatio, ratio.toFixed(2));
});

await check('T6.7 the opt-in CLI worker pool writes the same files as the in-process run', () => {
  const run = (extra) => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-pool-'));
    const r = spawnSync(process.execPath, [path.join(studioDir, 'cli', 'harvest.mjs'), '--from', path.join(studioDir, 'test', 'fixtures'), '--links', path.join(studioDir, 'test', 'links.json'), '--out', out, ...extra], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const stamp = /"(generatedAt|checkedAt)": ?"[^"]*"/g;
    const files = Object.fromEntries(fs.readdirSync(out).sort().map((f) => [f, f.endsWith('.json') ? fs.readFileSync(path.join(out, f), 'utf8').replace(stamp, '"$1":0') : fs.readFileSync(path.join(out, f)).toString('base64')]));
    fs.rmSync(out, { recursive: true, force: true });
    return files;
  };
  assert.deepEqual(run(['--workers', '2']), run([]));
});

const lookup = (i) => ({ page: pageUrl(i), icon: 'https://' + siteOf(i).host + siteOf(i).page + 'icon.png', name: names[i % names.length] });

const stubIo = (delayFor) => {
  const open = new Map();
  const peak = new Map();
  return {
    peak,
    io: {
      fetchBytes: async (url) => {
        const u = new URL(url);
        const n = (open.get(u.host) || 0) + 1;
        open.set(u.host, n);
        peak.set(u.host, Math.max(peak.get(u.host) || 0, n));
        try {
          await new Promise((r) => setTimeout(r, delayFor(url)));
          const hit = Array.from({ length: names.length }, (_, i) => i).find((i) => url === lookup(i).page || url === lookup(i).icon);
          if (hit === undefined) return { ok: false, status: 404, url, bytes: new Uint8Array(), mitigated: null, protection: null };
          const isIcon = url.endsWith('icon.png');
          return { ok: true, status: 200, url, bytes: new Uint8Array(isIcon ? png(lookup(hit).name) : html(hit)), mitigated: null, protection: null };
        } finally {
          open.set(u.host, open.get(u.host) - 1);
        }
      }
    }
  };
};

const targetsOf = () => names.map((n, i) => ({ key: n, appId: n.split('--')[0], variantId: null, url: pageUrl(i) }));
const instant = { readOverride: async () => { throw new Error('none'); }, readOutput: async () => null };

await check('T6.3 the core limiter never opens more than two requests per host', async () => {
  const stub = stubIo(() => 15);
  await runHarvest({ targets: targetsOf(), overrides: {} }, { profile: 'launcher', now: NOW, preview: true, mode: 'keep' }, { ...instant, ...stub.io });
  assert.ok(stub.peak.size >= HOSTS);
  for (const [host, n] of stub.peak) assert.ok(n <= 2, host + ' ' + n);
  const l = createLimiter({ total: 3, perHost: 1 });
  let live = 0;
  let max = 0;
  await Promise.all(Array.from({ length: 12 }, (_, i) => l.run('https://a' + (i % 2) + '.example.com/', async () => { max = Math.max(max, ++live); await new Promise((r) => setTimeout(r, 5)); live--; })));
  assert.ok(l.stats.peakHost <= 1 && l.stats.peak <= 3 && max <= 2);
});

await check('T6.4 the same harvest twice gives the same manifest whatever order requests finish in', async () => {
  const hashes = [];
  for (const seedShift of [3, 11, 29]) {
    const stub = stubIo((url) => 5 + ((url.length * seedShift) % 40));
    const res = await runHarvest({ targets: targetsOf(), overrides: {} }, { profile: 'launcher', now: NOW, mode: 'separate', seed: 'a1b2c3d4' }, { ...instant, ...stub.io });
    hashes.push(await sha256(res.export.files['manifest.v2.json']));
  }
  assert.equal(new Set(hashes).size, 1, hashes.join(' '));
});

await check('T6.4 reusing a previous analysis by pixel hash gives byte-identical output', async () => {
  const stub = stubIo(() => 1);
  const first = await runHarvest({ targets: targetsOf(), overrides: {} }, { profile: 'launcher', now: NOW, mode: 'separate', seed: 'a1b2c3d4' }, { ...instant, ...stub.io });
  const second = await runHarvest({ targets: targetsOf(), overrides: {} }, { profile: 'launcher', now: NOW, mode: 'separate', seed: 'a1b2c3d4', reuse: first.reusable }, { ...instant, ...stub.io });
  assert.ok(second.reusedKeys.length >= 30, String(second.reusedKeys.length));
  assert.equal(await sha256(second.export.files['manifest.v2.json']), await sha256(first.export.files['manifest.v2.json']));
  for (const name of Object.keys(first.export.files)) assert.deepEqual(second.export.files[name], first.export.files[name], name);
});

const state = { open: new Map(), peak: new Map(), full: 0, conditional: 0, notModified: 0, requests: 0 };
const resetState = () => {
  state.peak = new Map();
  state.full = 0;
  state.conditional = 0;
  state.notModified = 0;
  state.requests = 0;
};
const etagOf = (href) => '"' + sha256Sync(href) + '"';
const sha256Sync = (s) => {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h.toString(16);
};
const proxy = createHandler({
  resolve: async () => [{ address: '93.184.216.34', family: 4 }],
  request: async ({ url, headers }) => {
    const n = (state.open.get(url.host) || 0) + 1;
    state.open.set(url.host, n);
    state.peak.set(url.host, Math.max(state.peak.get(url.host) || 0, n));
    state.requests++;
    await new Promise((r) => setTimeout(r, 300));
    state.open.set(url.host, state.open.get(url.host) - 1);
    const i = Array.from({ length: names.length }, (_, k) => k).find((k) => url.href === lookup(k).page || url.href === lookup(k).icon);
    if (i === undefined) return { status: 404, headers: { 'content-type': 'text/html' }, body: Readable.from([Buffer.from('missing')]), destroy() {} };
    const etag = etagOf(url.href);
    if (headers['if-none-match']) {
      state.conditional++;
      if (headers['if-none-match'] === etag) {
        state.notModified++;
        return { status: 304, headers: { etag }, body: Readable.from([]), destroy() {} };
      }
    }
    state.full++;
    const icon = url.href.endsWith('icon.png');
    return { status: 200, headers: { 'content-type': icon ? 'image/png' : 'text/html', etag }, body: Readable.from([icon ? png(lookup(i).name) : html(i)]), destroy() {} };
  },
  env: { STUDIO_TOKEN: 'perf-token' }
});
const server = await serve(4205, proxy);
const exe = chromiumPath();
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' });
const errors = [];

const openPage = async () => {
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    if (!localStorage.getItem('hs:prefs')) localStorage.setItem('hs:prefs', JSON.stringify({ proxyUrl: 'http://localhost:4205/api/fetch' }));
    sessionStorage.setItem('hs:token', 'perf-token');
    window.__long = [];
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__long.push(Math.round(e.duration));
      }).observe({ entryTypes: ['longtask'] });
    } catch {}
  });
  await page.goto('http://localhost:4205/');
  await page.waitForSelector('#urls');
  return page;
};

const harvestAll = async (page) => {
  await page.locator('#urls').fill(names.map((_, i) => pageUrl(i)).join('\n'));
  const start = Date.now();
  await page.click('#go');
  await page.waitForSelector('.gallery .cell .tile-art:not(.ghost)', { timeout: 60000 });
  const first = Date.now() - start;
  await page.waitForFunction(() => window.__studio && window.__studio.state.stage === 'work', null, { timeout: 120000 });
  const total = Date.now() - start;
  return { first, total };
};

await check('T6.6 first-load JS stays within 48 KB gzip, and the worker, wasm and unused font subsets wait until needed', async () => {
  const gz = (f) => zlib.gzipSync(fs.readFileSync(path.join(studioDir, 'dist', f)), { level: 9 }).length;
  const app = gz('app.js');
  console.log('     app.js ' + app + ' gzip bytes against ' + baseline.firstLoad.appJsGzipBytes + ' at baseline; worker.js ' + gz('worker.js') + ' against ' + baseline.firstLoad.workerJsGzipBytes);
  assert.ok(app <= 48 * 1024, String(app));
  const page = await ctx.newPage();
  const seen = [];
  page.on('request', (r) => seen.push(new URL(r.url()).pathname));
  await page.goto('http://localhost:4205/');
  await page.waitForSelector('#urls');
  await page.waitForTimeout(800);
  assert.ok(!seen.some((p) => /worker\.js|\.wasm$/.test(p)), seen.join(' '));
  assert.ok(!seen.some((p) => /latin-ext/.test(p)), seen.join(' '));
  await page.close();
});

const page1 = await openPage();
resetState();
const run1 = await harvestAll(page1);
const long1 = await page1.evaluate(() => window.__long);
const peak1 = new Map(state.peak);
const full1 = state.full;

await check('T6.2 with 300 ms of proxy latency the first tile shows within 2.5 s, all within 25 s, with no long task over 200 ms', () => {
  console.log('     first tile ' + run1.first + ' ms, all done ' + run1.total + ' ms, longest task ' + Math.max(0, ...long1) + ' ms, upstream requests ' + full1);
  assert.ok(run1.first <= 2500, String(run1.first));
  assert.ok(run1.total <= 25000, String(run1.total));
  assert.ok(Math.max(0, ...long1) <= 200, long1.join(','));
});

await check('T6.3 the proxy stub never sees more than two open requests for one host from the browser', () => {
  assert.ok(peak1.size >= HOSTS);
  for (const [host, n] of peak1) assert.ok(n <= 2, host + ' ' + n);
});

await page1.close();
const page2 = await openPage();
resetState();
const run2 = await harvestAll(page2);

await check('T6.5 a second browser harvest with a warm cache makes no full-body upstream fetches', () => {
  console.log('     second run: first tile ' + run2.first + ' ms, all done ' + run2.total + ' ms, upstream requests ' + state.requests + ', full ' + state.full + ', 304 ' + state.notModified);
  assert.equal(state.full, 0);
  assert.ok(run2.total < run1.total);
});

await check('T6.5 a re-harvest of one tile revalidates with If-None-Match and gets 304', async () => {
  resetState();
  await page2.locator('.gallery .cell').first().click();
  await page2.click('#tabbtn-source');
  await page2.locator('[data-act="reharvest"]').click();
  await page2.waitForTimeout(3000);
  assert.ok(state.conditional >= 1, 'conditional ' + state.conditional);
  assert.equal(state.full, 0);
  assert.ok(state.notModified >= 1);
});

await check('no console errors', () => assert.deepEqual(errors, []));

await browser.close();
server.close();
finish();
