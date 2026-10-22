import assert from 'node:assert/strict';
import { check, finish } from './util.mjs';
import { decodeImage, normalize, gate, processTarget, analyzeIcon, encodeImage, orderFrames, readIcoEntries } from '../core/index.js';
import { bookImage, bmpFrame, pngFrame, buildIco, damaged } from './ico-fixtures.mjs';

const visible = (img) => {
  let n = 0;
  for (let p = 3; p < img.data.length; p += 4) if (img.data[p] > 0) n++;
  return n;
};
const expected = (img) => {
  let n = 0;
  for (let p = 3; p < img.data.length; p += 4) if (img.data[p] >= 128) n++;
  return n;
};

const book = bookImage(48);
const want = expected(book);

await check('a 32-bit icon with all-zero alpha takes its transparency from the AND mask', async () => {
  const { image } = await decodeImage(buildIco([bmpFrame(book, { bpp: 32, alpha: 'zero' })]), 'ico');
  assert.equal(image.width, 48);
  assert.equal(visible(image), want);
  const n = await normalize(buildIco([bmpFrame(book, { bpp: 32, alpha: 'zero' })]), 'ico');
  assert.equal(gate(n.img, n.srcWidth), null);
});

await check('a 32-bit icon with real alpha keeps its alpha untouched', async () => {
  const { image } = await decodeImage(buildIco([bmpFrame(book, { bpp: 32 })]), 'ico');
  assert.equal(visible(image), visible(book));
});

await check('a 32-bit icon with all-zero alpha and no mask is treated as opaque', async () => {
  const coloured = { width: 16, height: 16, data: new Uint8ClampedArray(16 * 16 * 4) };
  for (let p = 0; p < 256; p++) coloured.data.set([p, 40, 200 - p, 255], p * 4);
  const { image } = await decodeImage(buildIco([bmpFrame(coloured, { bpp: 32, alpha: 'zero', mask: false })]), 'ico');
  assert.equal(image.height, 16);
  assert.equal(visible(image), 256);
});

for (const bpp of [24, 8, 4, 1]) {
  await check('a ' + bpp + '-bit icon decodes with its AND mask', async () => {
    const { image } = await decodeImage(buildIco([bmpFrame(book, { bpp })]), 'ico');
    assert.equal(visible(image), want);
    const inked = image.data.findIndex((v, i) => i % 4 === 3 && v > 0);
    assert.deepEqual([...image.data.subarray(inked - 3, inked)], [0, 0, 0]);
  });
}

await check('a damaged largest frame is skipped in favour of the next one', async () => {
  const ico = buildIco([bmpFrame(bookImage(16), { bpp: 32 }), bmpFrame(bookImage(32), { bpp: 32 }), damaged(bmpFrame(book, { bpp: 32 }))]);
  const { image, srcWidth } = await decodeImage(ico, 'ico');
  assert.equal(image.width, 32);
  assert.equal(srcWidth, 32);
});

await check('an icon whose frames all fail reports why', async () => {
  const ico = buildIco([damaged(bmpFrame(book, { bpp: 32 }))]);
  await assert.rejects(() => decodeImage(ico, 'ico'), /no usable ico frame/);
});

await check('an ico that wraps PNG frames decodes', async () => {
  const { image } = await decodeImage(buildIco([await pngFrame(bookImage(16)), await pngFrame(book)]), 'ico');
  assert.equal(image.width, 48);
  assert.equal(visible(image), visible(book));
});

await check('a bare PNG served as favicon.ico still decodes', async () => {
  const png = await encodeImage(book, { format: 'png' });
  const { image } = await decodeImage(png, 'ico');
  assert.equal(image.width, 48);
});

await check('the smallest frame of at least 192 px wins, else the largest', async () => {
  const frames = [16, 48, 256, 512].map((size) => ({ width: size, height: size, bpp: 32, bytes: new Uint8Array(8) }));
  const entries = readIcoEntries(buildIco(frames));
  assert.equal(orderFrames(entries)[0].width, 256);
  assert.deepEqual(orderFrames(readIcoEntries(buildIco(frames.slice(0, 2)))).map((e) => e.width), [48, 16]);
});

await check('at the same size the deeper colour frame is preferred', async () => {
  const other = bookImage(32);
  other.data.fill(255);
  const ico = buildIco([bmpFrame(other, { bpp: 24, mask: false }), bmpFrame(bookImage(32), { bpp: 32 })]);
  const { image } = await decodeImage(ico, 'ico');
  assert.equal(visible(image), visible(bookImage(32)));
});

await check('a fully opaque icon gets its dark corners cut like a PNG would', async () => {
  const tile = { width: 48, height: 48, data: new Uint8ClampedArray(48 * 48 * 4) };
  for (let y = 0; y < 48; y++) {
    for (let x = 0; x < 48; x++) {
      const corner = Math.min(x, 47 - x) + Math.min(y, 47 - y) < 8;
      tile.data.set(corner ? [0, 0, 0, 255] : [40, 90, 220, 255], (y * 48 + x) * 4);
    }
  }
  const n = await normalize(buildIco([bmpFrame(tile, { bpp: 24, mask: false })]), 'ico');
  assert.equal(n.img.data[3], 0);
  assert.equal(n.img.data[(96 * 192 + 96) * 4 + 3], 255);
});

await check('webp and avif favicons normalise instead of crashing', async () => {
  const img = { width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4) };
  for (let p = 0; p < 64 * 64; p++) img.data.set([(p % 64) * 4, 100, 200 - (p % 64), 255], p * 4);
  for (const format of ['webp', 'avif']) {
    const n = await normalize(await encodeImage(img, { format }), format);
    assert.equal(n.img.width, 192);
  }
});

const pageHead = '<!DOCTYPE html><!-- Netlify --><html><head><meta charset="utf-8"><link rel="icon" type="image/x-icon" href="favicon.ico"></head><body></body></html>';
const mockIo = (ico) => {
  const pages = { 'https://p.test/': new TextEncoder().encode(pageHead), 'https://p.test/favicon.ico': ico };
  return {
    fetchBytes: async (url) => (pages[url] ? { ok: true, status: 200, url, bytes: pages[url], mitigated: null } : { ok: false, status: 404, url, bytes: new Uint8Array(), mitigated: null }),
    readLocal: async () => null,
    readOverride: async () => null
  };
};

for (const [label, ico] of [
  ['an all-zero-alpha 32-bit', buildIco([bmpFrame(book, { bpp: 32, alpha: 'zero' })])],
  ['an 8-bit palette', buildIco([bmpFrame(book, { bpp: 8 })])],
  ['a multi-frame with one damaged', buildIco([bmpFrame(bookImage(32), { bpp: 32 }), damaged(bmpFrame(book, { bpp: 32 }))])],
  ['a PNG-frame', buildIco([await pngFrame(book)])]
]) {
  await check('processTarget finds the Protocols favicon in ' + label + ' favicon.ico', async () => {
    const r = await processTarget({ key: 'protocols', appId: 'protocols', url: 'https://p.test/' }, { io: mockIo(ico), overrides: {}, local: false });
    assert.equal(r.status, 'found');
    assert.equal(r.source.type, 'ico');
    const a = await analyzeIcon(r.image);
    assert.ok(a.glyph, 'monochrome book should still give a glyph');
  });
}

finish();
