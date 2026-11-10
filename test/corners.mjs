import assert from 'node:assert/strict';
import { check, finish, fixtureTargets, localIo, NOW } from './util.mjs';
import { runHarvest, decodeWebp, makeImage, roundCorners, CORNER_RATIO } from '../core/index.js';

const run = await runHarvest({ targets: await fixtureTargets(), overrides: {} }, { profile: 'launcher', mode: 'follow', now: NOW, local: true }, localIo());
const manifest = run.export.files['manifest.v2.json'];
const parsed = JSON.parse(new TextDecoder().decode(manifest));
const atlasFile = Object.keys(run.export.files).find((f) => /^atlas\./.test(f));
const atlas = await decodeWebp(run.export.files[atlasFile]);
const cell = parsed.atlas.cell;
const placed = Object.entries(parsed.icons).filter(([, v]) => v.favicon);

await check('T3.6 every cell in the atlas has transparent corners', () => {
  assert.equal(placed.length, 34);
  for (const [key, v] of placed) {
    for (const [ox, oy] of [[0, 0], [cell - 3, 0], [0, cell - 3], [cell - 3, cell - 3]]) {
      for (let y = 0; y < 3; y++) {
        for (let x = 0; x < 3; x++) {
          const a = atlas.data[((v.favicon.y + oy + y) * atlas.width + v.favicon.x + ox + x) * 4 + 3];
          assert.ok(a <= 8, key + ' corner alpha ' + a);
        }
      }
    }
  }
});

await check('T3.6 the middle of almost every cell stays opaque', () => {
  let opaqueCentres = 0;
  for (const [, v] of placed) {
    const mid = (v.favicon.y + cell / 2) * atlas.width + v.favicon.x + cell / 2;
    if (atlas.data[mid * 4 + 3] > 200) opaqueCentres++;
  }
  assert.ok(opaqueCentres >= 30, String(opaqueCentres));
});

await check('roundCorners rounds a full square to the token radius and leaves the straight edges', () => {
  const img = makeImage(100, 100);
  img.data.fill(255);
  const out = roundCorners(img);
  const alpha = (x, y) => out.data[(y * 100 + x) * 4 + 3];
  assert.equal(alpha(0, 0), 0);
  assert.equal(alpha(99, 99), 0);
  assert.equal(alpha(50, 0), 255);
  assert.equal(alpha(0, 50), 255);
  assert.equal(alpha(50, 50), 255);
  const r = 100 * CORNER_RATIO;
  assert.equal(alpha(Math.floor(r * (1 - Math.SQRT1_2)) + 3, Math.floor(r * (1 - Math.SQRT1_2)) + 3), 255);
  assert.ok(alpha(Math.round(r * (1 - Math.SQRT1_2)) - 2, Math.round(r * (1 - Math.SQRT1_2)) - 2) < 40);
});

await check('the token radius matches src/ui/tokens.css', async () => {
  const fs = await import('node:fs/promises');
  const css = await fs.readFile(new URL('../src/ui/tokens.css', import.meta.url), 'utf8');
  assert.equal(Number(/--r-icon:\s*([.\d]+)/.exec(css)[1]), CORNER_RATIO);
});

finish();
