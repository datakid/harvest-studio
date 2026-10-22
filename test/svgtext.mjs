import assert from 'node:assert/strict';
import { check, finish } from './util.mjs';
import { decodeImage, runHarvest, sniff } from '../core/index.js';

const NOW = '2026-01-01T00:00:00.000Z';
const SITE = 'https://example.test/';
const target = [{ key: 'demo', appId: 'demo', variantId: null, url: SITE }];
const svgOf = (body) => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#1f6feb"/>' + body + '</svg>';
const text = (s, extra = '') => svgOf('<text x="32" y="46" font-size="40" text-anchor="middle" fill="#ffffff" font-family="Arial" ' + extra + '>' + s + '</text>');
const whiteInside = (image) => {
  let n = 0;
  const k = image.width / 64;
  for (let y = Math.round(12 * k); y < Math.round(52 * k); y++) for (let x = Math.round(12 * k); x < Math.round(52 * k); x++) if (image.data[(y * image.width + x) * 4] > 200) n++;
  return n;
};
const raster = async (svg) => (await decodeImage(new TextEncoder().encode(svg), 'svg')).image;

await check('latin text in an svg is drawn with the bundled font', async () => {
  const bare = await raster(svgOf(''));
  const drawn = await raster(text('Ab'));
  assert.equal(drawn.width, drawn.height);
  assert.ok(whiteInside(drawn) > whiteInside(bare) + 200, String(whiteInside(drawn)));
  assert.equal(whiteInside(bare), 0);
});

await check('arabic text in an svg is drawn', async () => {
  const drawn = await raster(text('بر', 'direction="rtl"'));
  assert.ok(whiteInside(drawn) > 200, String(whiteInside(drawn)));
});

await check('a font family the machine does not have falls back to the bundled one', async () => {
  const a = await raster(text('Q'));
  const b = await raster(svgOf('<text x="32" y="46" font-size="40" text-anchor="middle" fill="#ffffff" font-family="Nonexistent Sans">Q</text>'));
  assert.deepEqual([...a.data], [...b.data]);
});

const harvest = async (svg) => {
  const pages = { [SITE]: '<html><head><link rel="icon" type="image/svg+xml" href="/i.svg"></head></html>', [SITE + 'i.svg']: svg };
  const io = {
    fetchBytes: async (url) => (pages[url] ? { ok: true, status: 200, url, bytes: new TextEncoder().encode(pages[url]), mitigated: null } : { ok: false, status: 404, url, bytes: new Uint8Array(), mitigated: null }),
    readLocal: async () => null,
    readOverride: async () => null,
    readOutput: async () => null
  };
  return (await runHarvest({ targets: target, overrides: {} }, { profile: 'launcher', now: NOW }, io)).report.items[0];
};

await check('a text favicon is harvested as found', async () => {
  const item = await harvest(text('Ab'));
  assert.equal(item.status, 'found');
  assert.equal(item.source.type, 'svg');
});

await check('an emoji-only svg is rejected with a reason that names the cause', async () => {
  const empty = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><text x="32" y="46" font-size="40" text-anchor="middle">🚀</text></svg>';
  const item = await harvest(empty);
  assert.equal(item.status, 'notfound');
  assert.equal(item.attempts[0].status, 'failed');
  assert.match(item.attempts[0].reason, /emoji/);
  assert.equal(sniff(new TextEncoder().encode(empty)), 'svg');
});

await check('an emoji written as a character reference is caught too', async () => {
  await assert.rejects(raster(svgOf('<text x="8" y="40" font-size="30">&#x1F680;</text>')), /bundled font/);
  await assert.rejects(raster(svgOf('<text x="8" y="40" font-size="30"><tspan>日本</tspan></text>')), /bundled font/);
});

finish();
