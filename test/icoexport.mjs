import assert from 'node:assert/strict';
import { unzipSync } from '../node_modules/fflate/esm/browser.js';
import { check, finish } from './util.mjs';
import { buildFaviconPack, buildCustomExport, decodeImage, decodeIcoBytes, readIcoEntries, encodeIco, sniff } from '../core/index.js';
import { bookImage } from './ico-fixtures.mjs';

const art = (size) => {
  const img = { width: size, height: size, data: new Uint8ClampedArray(size * size * 4) };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inside = x > size / 5 && x < (size * 4) / 5 && y > size / 5 && y < (size * 4) / 5;
      img.data.set(inside ? [30, 120 + Math.round((x / size) * 100), 230, 255] : [0, 0, 0, 0], (y * size + x) * 4);
    }
  }
  return img;
};

const framesOf = async (bytes) => {
  const out = [];
  for (const e of readIcoEntries(bytes)) {
    const png = bytes.subarray(e.offset, e.offset + e.size);
    assert.equal(sniff(png), 'png');
    out.push({ entry: e, image: (await decodeImage(png, 'png')).image });
  }
  return out;
};

await check('the favicon pack ico carries 16, 32 and 48 pixel png frames that decode', async () => {
  const pack = await buildFaviconPack({ key: 'demo', image: art(192), original: art(512) }, { name: 'Demo' });
  const frames = await framesOf(pack.files['favicon.ico']);
  assert.deepEqual(frames.map((f) => [f.entry.width, f.entry.height, f.image.width, f.image.height]), [[16, 16, 16, 16], [32, 32, 32, 32], [48, 48, 48, 48]]);
  for (const f of frames) assert.ok(f.image.data.some((v, i) => i % 4 === 3 && v === 255));
});

await check('the pack ico opens as one icon through the same decoder the harvester uses', async () => {
  const pack = await buildFaviconPack({ key: 'demo', image: art(192), original: art(512) }, { name: 'Demo' });
  const bytes = pack.files['favicon.ico'];
  assert.equal(sniff(bytes), 'ico');
  const { image, srcWidth } = await decodeIcoBytes(bytes);
  assert.equal(srcWidth, 48);
  assert.equal(image.width, 48);
  const viaDecode = await decodeImage(bytes, 'ico');
  assert.equal(viaDecode.image.width, 48);
});

await check('each frame of the pack ico keeps the artwork at its own size', async () => {
  const pack = await buildFaviconPack({ key: 'demo', image: art(192), original: bookImage(512) }, { name: 'Demo' });
  const [f16, f32, f48] = (await framesOf(pack.files['favicon.ico'])).map((f) => f.image);
  const ink = (img) => img.data.reduce((n, v, i) => (i % 4 === 3 && v > 0 ? n + 1 : n), 0) / (img.width * img.height);
  for (const f of [f16, f32, f48]) assert.ok(ink(f) > 0.05, String(ink(f)));
  assert.ok(Math.abs(ink(f16) - ink(f48)) < 0.25);
});

await check('a custom ico export never invents frames larger than its source', async () => {
  const small = await encodeIco(art(32));
  assert.deepEqual((await framesOf(small)).map((f) => f.entry.width), [16, 32]);
  const tiny = await encodeIco(art(16));
  assert.deepEqual((await framesOf(tiny)).map((f) => f.entry.width), [16]);
  const big = await encodeIco(art(192));
  assert.deepEqual((await framesOf(big)).map((f) => f.entry.width), [16, 32, 48]);
});

await check('the custom export writes an ico per size through the same path', async () => {
  const out = await buildCustomExport([{ key: 'demo', image: art(192), tint: null, status: 'found' }], { formats: ['ico'], sizes: [48, 192] });
  const files = unzipSync(out.zip);
  assert.ok(files['demo-48.ico'] && files['demo-192.ico']);
  assert.deepEqual((await framesOf(files['demo-48.ico'])).map((f) => f.entry.width), [16, 32, 48]);
});

finish();
