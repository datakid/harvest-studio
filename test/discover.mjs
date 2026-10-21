import assert from 'node:assert/strict';
import { check, finish } from './util.mjs';
import { runHarvest, candidateGroups, readLinks, readMetas, encodePng } from '../core/index.js';

const NOW = '2026-01-01T00:00:00.000Z';
const SITE = 'https://example.test/';
const target = [{ key: 'demo', appId: 'demo', variantId: null, url: SITE }];

const art = (width, height) => {
  const img = { width, height, data: new Uint8ClampedArray(width * height * 4) };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inside = x > width / 5 && x < (width * 4) / 5 && y > height / 5 && y < (height * 4) / 5;
      const shade = inside ? 255 - Math.round(((x + y) / (width + height)) * 160) : 255;
      img.data.set(inside ? [30, shade / 2, shade, 255] : [255, 255, 255, 255], (y * width + x) * 4);
    }
  }
  return img;
};
const png = async (w, h) => encodePng(art(w, h), { optimise: false });
const squarePng = await png(64, 64);
const widePng = await png(240, 126);

const io = (pages, calls = []) => ({
  fetchBytes: async (url) => {
    calls.push(url);
    const hit = pages[url];
    if (!hit) return { ok: false, status: 404, url, bytes: new Uint8Array(), mitigated: null };
    return { ok: true, status: 200, url, bytes: typeof hit === 'string' ? new TextEncoder().encode(hit) : hit, mitigated: null };
  },
  readLocal: async () => null,
  readOverride: async () => null,
  readOutput: async () => null
});
const harvest = async (pages) => {
  const calls = [];
  const r = await runHarvest({ targets: target, overrides: {} }, { profile: 'launcher', mode: 'follow', now: NOW }, io(pages, calls));
  return { item: r.report.items[0], calls };
};
const page = (head) => '<!DOCTYPE html><html><head>' + head + '</head><body></body></html>';
const types = async (html, base = SITE) => {
  const links = readLinks(html);
  const out = [];
  for (const g of candidateGroups(links, base, [], { fetchBytes: async () => ({ ok: false, status: 404, bytes: new Uint8Array() }) }, readMetas(html))) {
    for (const c of await g()) out.push(c.type);
  }
  return out;
};

await check('readMetas reads name and property, first wins, and ignores scripts and comments', () => {
  const m = readMetas('<!-- <meta name="x" content="no"> --><script>var a = \'<meta name="y" content="no">\';</script><meta property="og:image" content="/a.png"><meta name="og:image" content="/b.png"><meta name="msapplication-TileImage" content="/t.png">');
  assert.deepEqual(m, { 'og:image': '/a.png', 'msapplication-tileimage': '/t.png' });
});

await check('the existing groups keep their order and the new ones come after them', async () => {
  const html = page('<link rel="apple-touch-icon" href="/a.png"><link rel="icon" type="image/svg+xml" href="/i.svg"><link rel="icon" type="image/png" href="/i.png"><link rel="icon" type="image/x-icon" href="/i.ico"><link rel="mask-icon" href="/m.svg"><meta name="msapplication-TileImage" content="/t.png"><meta property="og:image" content="/o.png">');
  assert.deepEqual(await types(html), ['apple-touch-icon', 'svg', 'png', 'ico', 'favicon.ico', 'mask-icon', 'tile-image', 'og-image']);
});

await check('well-known paths are probed only when the page declares no icon link', async () => {
  const bare = await types(page('<title>x</title>'));
  assert.deepEqual(bare, ['favicon.ico', 'well-known', 'well-known', 'well-known', 'well-known', 'well-known', 'well-known', 'well-known']);
  const declared = await types(page('<link rel="icon" href="/i.png">'));
  assert.ok(!declared.includes('well-known'));
});

await check('a site with only /apple-touch-icon.png is found through the well-known probe', async () => {
  const { item, calls } = await harvest({ [SITE]: page('<title>x</title>'), [SITE + 'apple-touch-icon.png']: squarePng });
  assert.equal(item.status, 'found');
  assert.deepEqual(item.source, { type: 'well-known', href: SITE + 'apple-touch-icon.png' });
  assert.ok(calls.indexOf(SITE + 'favicon.ico') < calls.indexOf(SITE + 'apple-touch-icon.png'));
});

await check('a page with a declared icon never triggers the well-known probe', async () => {
  const { calls } = await harvest({ [SITE]: page('<link rel="icon" href="/i.png">'), [SITE + 'i.png']: squarePng });
  assert.ok(!calls.includes(SITE + 'apple-touch-icon.png'));
});

await check('msapplication-TileImage is used when nothing earlier works', async () => {
  const { item } = await harvest({ [SITE]: page('<meta name="msapplication-TileImage" content="/tile.png">'), [SITE + 'tile.png']: squarePng });
  assert.equal(item.status, 'found');
  assert.equal(item.source.type, 'tile-image');
});

await check('a mask-icon SVG is used and reported as such', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M8 8h48v48H8z M20 20h24v24H20z" fill-rule="evenodd"/></svg>';
  const { item } = await harvest({ [SITE]: page('<link rel="mask-icon" href="/m.svg" color="#123456">'), [SITE + 'm.svg']: svg });
  assert.equal(item.status, 'found');
  assert.equal(item.source.type, 'mask-icon');
});

await check('og:image is accepted only when it is square within ten percent', async () => {
  const wide = await harvest({ [SITE]: page('<meta property="og:image" content="/og.png">'), [SITE + 'og.png']: widePng });
  assert.equal(wide.item.status, 'notfound');
  assert.match(wide.item.error, /not square/);
  const near = await png(64, 60);
  const ok = await harvest({ [SITE]: page('<meta property="og:image" content="/og.png">'), [SITE + 'og.png']: near });
  assert.equal(ok.item.status, 'found');
  assert.equal(ok.item.source.type, 'og-image');
});

await check('an image reachable through two groups is fetched once', async () => {
  const { calls } = await harvest({ [SITE]: page('<meta name="msapplication-TileImage" content="/same.png"><meta property="og:image" content="/same.png">') });
  assert.equal(calls.filter((u) => u === SITE + 'same.png').length, 1);
});

await check('the report lists every attempt in order with its status and reason', async () => {
  const html = page('<link rel="apple-touch-icon" href="/gone.png"><link rel="icon" href="/text.png"><link rel="icon" type="image/x-icon" href="/ok.png">');
  const { item } = await harvest({ [SITE]: html, [SITE + 'text.png']: 'not an image at all', [SITE + 'ok.png']: squarePng });
  assert.deepEqual(item.attempts.map((a) => [a.type, a.status]), [['apple-touch-icon', 'failed'], ['png', 'failed'], ['ico', 'used']]);
  assert.equal(item.attempts[0].reason, 'HTTP 404');
  assert.equal(item.attempts[1].reason, 'not an image');
  assert.equal(item.attempts[1].href, SITE + 'text.png');
  assert.equal(item.attempts[2].reason, null);
});

await check('a rejected icon and a failed manifest are both recorded', async () => {
  const flat = { width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4).fill(255) };
  const { item } = await harvest({ [SITE]: page('<link rel="icon" href="/flat.png"><link rel="manifest" href="/site.webmanifest">'), [SITE + 'flat.png']: await encodePng(flat, { optimise: false }) });
  assert.equal(item.status, 'notfound');
  const byType = Object.fromEntries(item.attempts.map((a) => [a.type, a]));
  assert.equal(byType.png.status, 'rejected');
  assert.equal(byType.png.reason, 'single flat colour');
  assert.equal(byType.manifest.status, 'failed');
  assert.equal(byType.manifest.reason, 'HTTP 404');
});

await check('a blocked page records one page attempt', async () => {
  const calls = [];
  const blocked = { ...io({}, calls), fetchBytes: async (url) => ({ ok: false, status: 403, url, bytes: new Uint8Array(), mitigated: null }) };
  const r = await runHarvest({ targets: target, overrides: {} }, { profile: 'launcher', now: NOW }, blocked);
  assert.deepEqual(r.report.items[0].attempts, [{ type: 'page', href: SITE, status: 'blocked', reason: 'HTTP 403 challenge or protection page' }]);
});

finish();
