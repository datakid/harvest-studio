import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { check, finish, studioDir } from './util.mjs';
import { runHarvest, buildTargets, RASTER_EXT } from '../core/index.js';
import { encodePng } from '../core/codecs.js';
import { makeImage, normalize, removeFlatBackground } from '../core/pixels.js';
import { hexToLch } from '../core/color.js';

const NOW = '2026-01-01T00:00:00.000Z';
const MARK = [0x6c, 0x58, 0xd4];

const paint = (size, background, mark, radius) => {
  const img = makeImage(size, size);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const p = (y * size + x) * 4;
      const inside = Math.hypot(x - c, y - c) <= radius;
      const rgb = inside ? mark : background;
      img.data[p] = rgb[0];
      img.data[p + 1] = rgb[1];
      img.data[p + 2] = rgb[2];
      img.data[p + 3] = 255;
    }
  }
  return img;
};

const corners = (img) => [0, img.width - 1, (img.height - 1) * img.width, img.width * img.height - 1].map((p) => img.data[p * 4 + 3]);
const share = (img) => {
  let n = 0;
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] > 127) n++;
  return n / (img.width * img.height);
};

const whiteSquare = await encodePng(paint(180, [255, 255, 255], MARK, 30));
const tealSquare = await encodePng(paint(180, [0x1f, 0x8a, 0x8a], [255, 255, 255], 30));
const whiteTile = await encodePng(paint(180, [255, 255, 255], MARK, 4));

await check('T3.1a a white square with a centred mark ends with transparent corners', async () => {
  const { img } = await normalize(whiteSquare, 'png');
  assert.deepEqual(corners(img), [0, 0, 0, 0]);
  assert.ok(share(img) > 0.3 && share(img) < 0.7, String(share(img)));
});

await check('T3.1a the mark is re-centred inside the safe area', async () => {
  const { img } = await normalize(whiteSquare, 'png');
  let minX = img.width;
  let maxX = -1;
  for (let i = 0; i < img.width * img.height; i++) {
    if (img.data[i * 4 + 3] < 128) continue;
    const x = i % img.width;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
  }
  assert.ok(Math.abs(minX - (img.width - 1 - maxX)) <= 1, minX + ' ' + maxX);
  assert.ok(maxX - minX + 1 <= Math.round(img.width * 0.82));
});

await check('T3.1a the tint is taken from the mark, not from white', async () => {
  const r = await runHarvest({ targets: [{ key: 'mark', appId: 'mark', variantId: null, url: null, bytes: whiteSquare, fileName: 'mark.png' }], overrides: {} }, { profile: 'launcher', mode: 'follow', now: NOW }, { readLocal: async () => null, readOverride: async () => null, readOutput: async () => null, fetchBytes: async () => ({ ok: false, status: 404, bytes: new Uint8Array() }) });
  const item = r.report.items[0];
  assert.equal(item.status, 'found');
  const [L, C, h] = hexToLch(item.tint[0]);
  const [, , want] = hexToLch('#6c58d4');
  assert.ok(C > 0.08, 'chroma ' + C);
  const diff = Math.abs(((h - want + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  assert.ok(diff < 0.25, 'hue ' + h + ' vs ' + want);
  assert.ok(L < 0.9);
});

await check('T3.1b an icon whose design is a full flat coloured square keeps its pixels', async () => {
  const { img } = await normalize(tealSquare, 'png');
  assert.deepEqual(corners(img), [255, 255, 255, 255]);
  assert.equal(img.data[0], 0x1f);
  assert.equal(img.data[1], 0x8a);
});

await check('T3.1b a white tile whose mark would leave under 6% opaque is kept whole', async () => {
  const source = paint(180, [255, 255, 255], MARK, 4);
  assert.equal(await removeFlatBackground(source), source);
  const { img } = await normalize(whiteTile, 'png');
  assert.deepEqual(corners(img), [255, 255, 255, 255]);
});

await check('T3.1b an already transparent icon is returned untouched', async () => {
  const source = paint(180, [255, 255, 255], MARK, 30);
  for (const p of [0, 179, 179 * 180, 180 * 180 - 1]) source.data[p * 4 + 3] = 0;
  assert.equal(await removeFlatBackground(source), source);
});

const knownDir = path.join(studioDir, 'config', 'known-icons');
const readKnown = async (key) => {
  for (const ext of RASTER_EXT) {
    try {
      return { bytes: new Uint8Array(await fs.readFile(path.join(knownDir, key + '.' + ext))), file: 'known-icons/' + key + '.' + ext };
    } catch {}
  }
  return null;
};
const catalogue = JSON.parse(await fs.readFile(path.join(studioDir, 'config', 'catalogue.json'), 'utf8'));
const protocols = buildTargets(catalogue).filter((t) => t.key === 'protocols');
const offline = {
  fetchBytes: async () => {
    throw Object.assign(new Error('needs the fetch proxy: this site does not allow direct browser access'), { fatal: true });
  },
  readLocal: async () => null,
  readOverride: async () => null,
  readOutput: async () => null,
  readKnown
};

await check('T3.1c a bundled source carries the stale-source flag in the report', async () => {
  const r = await runHarvest({ targets: protocols, overrides: {} }, { profile: 'launcher', mode: 'follow', now: NOW }, offline);
  const item = r.report.items[0];
  assert.equal(item.source.type, 'bundled');
  assert.deepEqual(item.flags, ['stale-source']);
});

await check('T3.1c a live source carries no flags', async () => {
  const r = await runHarvest({ targets: [{ key: 'mark', appId: 'mark', variantId: null, url: null, bytes: whiteSquare, fileName: 'mark.png' }], overrides: {} }, { profile: 'launcher', mode: 'follow', now: NOW }, { ...offline, readKnown: undefined });
  assert.equal(r.report.items[0].flags, undefined);
});

finish();
