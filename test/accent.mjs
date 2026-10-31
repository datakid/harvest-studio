import assert from 'node:assert/strict';
import { check, finish } from './util.mjs';
import { runHarvest, encodePng, hexToLch } from '../core/index.js';

const NOW = '2026-01-01T00:00:00.000Z';
const SIZE = 192;

const darkWithAccent = () => {
  const img = { width: SIZE, height: SIZE, data: new Uint8ClampedArray(SIZE * SIZE * 4) };
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = Math.abs(x - 140);
      const dy = Math.abs(y - 50);
      const accent = dx + dy < 14;
      const glyph = x > 40 && x < 110 && y > 100 && y < 150;
      const px = accent ? [224, 72, 58] : glyph ? [239, 232, 216] : [27, 34, 32];
      img.data.set([...px, 255], (y * SIZE + x) * 4);
    }
  }
  return img;
};

const run = async (catalogueTint) => {
  const bytes = await encodePng(darkWithAccent(), { optimise: false });
  const io = { fetchBytes: async () => ({ ok: false, status: 404, bytes: new Uint8Array() }), readLocal: async () => null, readOverride: async () => null, readOutput: async () => null };
  const target = { key: 'fihrist', appId: 'fihrist', variantId: null, url: null, bytes, fileName: 'fihrist.png', ...(catalogueTint ? { catalogueTint } : {}) };
  const r = await runHarvest({ targets: [target], overrides: {} }, { profile: 'launcher', mode: 'follow', now: NOW, preview: true }, io);
  return { item: r.report.items[0], rec: r.records[0] };
};

await check('a dark icon with one small accent takes the accent as its colour', async () => {
  const { rec } = await run(null);
  assert.ok(rec.tint, 'tint is set');
  const [, c, h] = hexToLch(rec.tint[0]);
  const deg = ((h * 180) / Math.PI + 360) % 360;
  assert.ok(c > 0.08, 'tint is chromatic');
  assert.ok(deg < 40 || deg > 340, 'hue is red, got ' + deg);
  assert.equal(rec.tintSource, 'accent');
});

await check('a catalogue colour wins over a weak accent', async () => {
  const catalogueTint = ['#5e8df0', '#7dd3fc', '#075985'];
  const { rec } = await run(catalogueTint);
  assert.equal(rec.tintSource, 'catalogue');
  assert.deepEqual(rec.tint, catalogueTint);
});

finish();
