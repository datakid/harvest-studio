import assert from 'node:assert/strict';
import { check, finish } from './util.mjs';
import { runHarvest, encodePng, fetchRetry } from '../core/index.js';

const NOW = '2026-01-01T00:00:00.000Z';
const SITE = 'https://dead.test/';
const target = (key = 'dead', url = SITE) => ({ key, appId: key, variantId: null, url });

const art = () => {
  const img = { width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4) };
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) img.data.set(x > 12 && x < 52 && y > 12 && y < 52 ? [30, 120, 220, 255] : [255, 255, 255, 255], (y * 64 + x) * 4);
  return img;
};
const icon = await encodePng(art(), { optimise: false });
const page = '<html><head><link rel="icon" type="image/png" href="/i.png"></head></html>';

const run = (targets, io, options = {}) => runHarvest({ targets, overrides: {} }, { profile: 'launcher', mode: 'follow', now: NOW, preview: true, ...options }, { readLocal: async () => null, readOverride: async () => null, readOutput: async () => null, sleep: async () => {}, ...io });

await check('a timed-out page is retried once and the same host is not probed again', async () => {
  const calls = [];
  const r = await run([target()], {
    fetchBytes: async (url) => {
      calls.push(url);
      throw Object.assign(new Error('proxy: upstream timed out'), { timeout: true });
    }
  });
  assert.deepEqual(calls, [SITE, SITE]);
  const item = r.report.items[0];
  assert.equal(item.status, 'notfound');
  assert.equal(item.attempts.filter((a) => a.type === 'page' && a.status === 'failed').length, 2);
  assert.ok(item.attempts.some((a) => /skipped/.test(a.reason)));
});

await check('other errors are retried once, not three times', async () => {
  const calls = [];
  await assert.rejects(
    fetchRetry({ sleep: async () => {}, fetchBytes: async (u) => { calls.push(u); throw new Error('proxy: upstream request failed'); } }, SITE),
    /upstream request failed/
  );
  assert.equal(calls.length, 2);
});

await check('fatal errors are never retried and a timeout is retried exactly once', async () => {
  let fatalCalls = 0;
  await assert.rejects(fetchRetry({ sleep: async () => {}, fetchBytes: async () => { fatalCalls++; throw Object.assign(new Error('x'), { fatal: true }); } }, SITE));
  assert.equal(fatalCalls, 1);
  let timeoutCalls = 0;
  const seen = [];
  await assert.rejects(fetchRetry({ sleep: async () => {}, fetchBytes: async () => { timeoutCalls++; throw Object.assign(new Error('x'), { timeout: true }); } }, SITE, undefined, { onTimeout: (e) => seen.push(e.message) }));
  assert.equal(timeoutCalls, 2);
  assert.deepEqual(seen, ['x']);
});

await check('a site that never answers is given up on after the deadline and the others finish', async () => {
  const t0 = Date.now();
  const r = await run([target('hang', 'https://hang.test/'), target('ok', 'https://ok.test/')], {
    fetchBytes: async (url) => {
      if (url.startsWith('https://hang.test')) return new Promise(() => {});
      if (url === 'https://ok.test/') return { ok: true, status: 200, url, bytes: new TextEncoder().encode(page), mitigated: null };
      return { ok: true, status: 200, url, bytes: icon, mitigated: null };
    }
  }, { targetTimeoutMs: 300 });
  assert.ok(Date.now() - t0 < 3000);
  const byKey = Object.fromEntries(r.report.items.map((i) => [i.key, i]));
  assert.equal(byKey.ok.status, 'found');
  assert.equal(byKey.hang.status, 'notfound');
  assert.match(byKey.hang.error, /gave up/);
  assert.equal(r.report.summary.total, 2);
});

await check('progress names the sites still pending while one is slow', async () => {
  const seen = [];
  await run([target('slow', 'https://slow.test/'), target('fast', 'https://fast.test/')], {
    fetchBytes: async (url) => {
      if (url.startsWith('https://slow.test')) {
        await new Promise((r) => setTimeout(r, 400));
        throw Object.assign(new Error('proxy: upstream timed out'), { timeout: true });
      }
      if (url === 'https://fast.test/') return { ok: true, status: 200, url, bytes: new TextEncoder().encode(page), mitigated: null };
      return { ok: true, status: 200, url, bytes: icon, mitigated: null };
    }
  }, { onProgress: (e) => seen.push(e), tickMs: 60 });
  const tail = seen.filter((e) => e.phase === 'fetch' && e.done === 1 && e.pending && e.pending.length === 1);
  assert.ok(tail.length >= 2, 'ticks while waiting: ' + tail.length);
  assert.deepEqual(tail[0].pending, ['slow']);
});

await check('the progress ticker stops when the run ends', async () => {
  let ticks = 0;
  await run([target('fast', 'https://fast.test/')], { fetchBytes: async (url) => ({ ok: true, status: 200, url, bytes: url.endsWith('/') ? new TextEncoder().encode(page) : icon, mitigated: null }) }, { onProgress: () => ticks++, tickMs: 20 });
  const at = ticks;
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(ticks, at);
});

finish();
