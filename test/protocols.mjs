import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { check, finish, studioDir, fixturesDir } from './util.mjs';
import { runHarvest, buildTargets, readIcoEntries, decodeImage, sha256, sniff } from '../core/index.js';

const NOW = '2026-01-01T00:00:00.000Z';
const PROTOCOLS = 'https://strong-snickerdoodle-02a92f.netlify.app/';
const links = JSON.parse(await fs.readFile(path.join(studioDir, 'test', 'links.json'), 'utf8'));
const bytes = new Uint8Array(await fs.readFile(path.join(fixturesDir, 'ico', 'protocols.ico')));
const page = '<!DOCTYPE html><html><head><link rel="icon" type="image/x-icon" href="favicon.ico"></head><body></body></html>';

const io = (pages) => ({
  fetchBytes: async (url) => {
    const hit = pages[url];
    if (!hit) return { ok: false, status: 404, url, bytes: new Uint8Array(), mitigated: null };
    return { ok: true, status: 200, url, bytes: typeof hit === 'string' ? new TextEncoder().encode(hit) : hit, mitigated: null };
  },
  readLocal: async () => null,
  readOverride: async () => null,
  readOutput: async () => null
});

await check('the real Protocols favicon is the file that was captured', async () => {
  assert.equal(bytes.length, 15406);
  assert.equal(await sha256(bytes), '1b8e56ad13b014c54e0ceeb890502d387c19b99068c310eb1d39639f9e42eead');
  assert.equal(sniff(bytes), 'ico');
});

await check('it holds three 32-bit frames at 16, 32 and 48 pixels', () => {
  assert.deepEqual(readIcoEntries(bytes).map((e) => [e.width, e.height, e.bpp]), [[16, 16, 32], [32, 32, 32], [48, 48, 32]]);
});

await check('the largest frame is chosen, fully opaque, near-white around dark ink', async () => {
  const { image, srcWidth } = await decodeImage(bytes, 'ico');
  assert.equal(srcWidth, 48);
  assert.equal(image.width, 48);
  let ink = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    assert.equal(image.data[i + 3], 255);
    if (image.data[i] < 80) ink++;
  }
  assert.ok(ink > 100, String(ink));
  assert.ok(image.data[0] > 240 && image.data[1] > 240 && image.data[2] > 240);
});

await check('harvesting the site finds the icon, keeps its drawn glyph and takes the catalogue gradient', async () => {
  const targets = buildTargets(links).filter((t) => t.key === 'protocols');
  const r = await runHarvest({ targets, overrides: {} }, { profile: 'launcher', mode: 'follow', now: NOW }, io({ [PROTOCOLS]: page, [PROTOCOLS + 'favicon.ico']: bytes }));
  const item = r.report.items[0];
  assert.equal(item.status, 'found');
  assert.equal(item.source.type, 'ico');
  assert.equal(item.tintSource, 'catalogue');
  assert.ok(item.glyph);
  assert.deepEqual(item.attempts.map((a) => [a.type, a.status]), [['ico', 'used']]);
  assert.ok(r.report.gate.ok);
});

finish();
