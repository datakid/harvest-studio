import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { chromium } from 'playwright-core';
import { serve } from '../scripts/serve.mjs';
import { buildKnownHosts, knownHostsFile } from '../scripts/known-hosts.mjs';
import { check, finish, fixturesDir, studioDir, invoke, localIo, NOW } from './util.mjs';
import { createHandler, registrableDomain, DEFAULT_PUBLIC_RATE } from '../api/fetch.js';
import { runHarvest, encodePng, netlifyProtection, headersReader, NETLIFY_PROTECTED_MESSAGE } from '../core/index.js';

const publicResolve = async () => [{ address: '93.184.216.34', family: 4 }];
const reply = (text, status = 200, type = 'text/html', extra = {}) => ({ status, headers: { 'content-type': type, ...extra }, body: Readable.from([Buffer.from(text)]), destroy() {} });
const KNOWN = { hosts: ['known.example.com', 'second.example.org', 'one.netlify.app'], cdn: ['cdn.example.net'] };
const browser = { 'sec-fetch-site': 'same-origin', host: 'studio.test' };

const make = (request, extra = {}) => createHandler({ resolve: publicResolve, request, env: { STUDIO_TOKEN: 'tok' }, known: KNOWN, ...extra });
const get = (handler, target, headers = browser) => invoke(handler, { path: '/api/fetch?url=' + encodeURIComponent(target), headers });

await check('T2.1 a tokenless same-origin request for a known host is answered', async () => {
  const h = make(async () => reply('<html></html>'));
  const r = await get(h, 'https://known.example.com/');
  assert.equal(r.status, 200);
  assert.equal(r.headers['x-upstream-status'], '200');
  const withOrigin = await get(h, 'https://known.example.com/', { ...browser, origin: 'https://studio.test' });
  assert.equal(withOrigin.status, 200);
  const withReferer = await get(h, 'https://known.example.com/', { ...browser, referer: 'https://studio.test/page' });
  assert.equal(withReferer.status, 200);
});

await check('T2.1 it also works when the proxy has no token configured at all', async () => {
  const h = make(async () => reply('<html></html>'), { env: {} });
  assert.equal((await get(h, 'https://known.example.com/')).status, 200);
  assert.equal((await get(h, 'https://other.example.com/')).status, 401);
});

await check('T2.2 a tokenless request for an unknown host is refused and nothing is fetched', async () => {
  let hits = 0;
  const h = make(async () => (hits++, reply('x')));
  const r = await get(h, 'https://unknown.example.com/');
  assert.equal(r.status, 401);
  assert.equal(JSON.parse(r.text).error, 'missing or wrong access token');
  assert.equal(hits, 0);
});

await check('T2.3 cross-site, foreign-origin and header-less requests are refused, even for a known host', async () => {
  let hits = 0;
  const h = make(async () => (hits++, reply('x')));
  const cases = [
    { 'sec-fetch-site': 'cross-site', host: 'studio.test' },
    { 'sec-fetch-site': 'same-site', host: 'studio.test' },
    { 'sec-fetch-site': 'none', host: 'studio.test' },
    { host: 'studio.test' },
    { ...browser, origin: 'https://evil.example' },
    { ...browser, origin: 'null' },
    { ...browser, referer: 'https://evil.example/page' }
  ];
  for (const headers of cases) assert.equal((await get(h, 'https://known.example.com/', headers)).status, 401, JSON.stringify(headers));
  assert.equal(hits, 0);
});

await check('T2.3 STUDIO_ORIGIN extends the accepted origins', async () => {
  const h = make(async () => reply('x'), { env: { STUDIO_TOKEN: 'tok', STUDIO_ORIGIN: 'https://front.example' } });
  assert.equal((await get(h, 'https://known.example.com/', { ...browser, origin: 'https://front.example' })).status, 200);
  assert.equal((await get(h, 'https://known.example.com/', { ...browser, origin: 'https://other.example' })).status, 401);
});

await check('T2.4 private, loopback and mapped addresses stay refused in tokenless mode', async () => {
  const addresses = ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fc00::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::a00:1', '2002:7f00:1::1'];
  for (const address of addresses) {
    let hits = 0;
    const h = make(async () => (hits++, reply('x')), { resolve: async () => [{ address, family: address.includes(':') ? 6 : 4 }] });
    const r = await get(h, 'https://known.example.com/');
    assert.equal(r.status, 403, address);
    assert.equal(hits, 0, address);
  }
  let literalHits = 0;
  const h = make(async () => (literalHits++, reply('x')));
  for (const u of ['http://127.0.0.1/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data/', 'http://localhost/', 'http://db.internal/', 'http://[::ffff:127.0.0.1]/', 'http://2130706433/']) assert.notEqual((await get(h, u)).status, 200, u);
  assert.equal(literalHits, 0);
});

await check('T2.4 ports, schemes and credentials are still checked in tokenless mode', async () => {
  const h = make(async () => reply('x'));
  assert.equal((await get(h, 'http://known.example.com:22/')).status, 403);
  assert.equal((await get(h, 'ftp://known.example.com/')).status, 400);
  assert.equal((await get(h, 'https://user:pw@known.example.com/')).status, 400);
});

await check('T2.5 a redirect to an unknown, unrelated host is refused with 403', async () => {
  let calls = 0;
  const h = make(async () => (calls++, reply('', 302, 'text/html', { location: 'https://unknown.example.net/x' })));
  const r = await get(h, 'https://known.example.com/');
  assert.equal(r.status, 403);
  assert.equal(calls, 1);
});

await check('T2.5 a redirect inside the same registrable domain is followed', async () => {
  let n = 0;
  const h = make(async ({ url }) => (n++ === 0 ? reply('', 301, 'text/html', { location: 'https://www.known.example.com/home' }) : reply('<html>ok ' + url.host + '</html>')));
  const r = await get(h, 'https://known.example.com/');
  assert.equal(r.status, 200);
  assert.match(r.text, /www\.known\.example\.com/);
});

await check('T2.5 a redirect from one known host to another known host is followed', async () => {
  let n = 0;
  const h = make(async () => (n++ === 0 ? reply('', 302, 'text/html', { location: 'https://second.example.org/' }) : reply('<html>second</html>')));
  assert.equal((await get(h, 'https://known.example.com/')).status, 200);
});

await check('T2.5 hosts under a shared suffix are not one registrable domain', () => {
  assert.equal(registrableDomain('a.b.example.com'), 'example.com');
  assert.equal(registrableDomain('www.example.co.uk'), 'example.co.uk');
  assert.equal(registrableDomain('one.netlify.app'), 'one.netlify.app');
  assert.notEqual(registrableDomain('one.netlify.app'), registrableDomain('two.netlify.app'));
  assert.equal(registrableDomain('192.0.2.1'), '192.0.2.1');
});

await check('T2.5 a redirect from one shared-suffix site to another is refused', async () => {
  const h = make(async () => reply('', 302, 'text/html', { location: 'https://two.netlify.app/' }));
  assert.equal((await get(h, 'https://one.netlify.app/')).status, 403);
});

await check('T2.5 a redirect to a listed CDN host is followed for images and pages only', async () => {
  let n = 0;
  const image = make(async () => (n++ === 0 ? reply('', 302, 'text/html', { location: 'https://cdn.example.net/i.png' }) : reply('png', 200, 'image/png')));
  assert.equal((await get(image, 'https://known.example.com/')).status, 200);
  n = 0;
  const json = make(async () => (n++ === 0 ? reply('', 302, 'text/html', { location: 'https://cdn.example.net/i.json' }) : reply('{}', 200, 'application/json')));
  assert.equal((await get(json, 'https://known.example.com/')).status, 403);
});

await check('T2.5 the token path keeps following redirects anywhere, as before', async () => {
  let n = 0;
  const h = make(async () => (n++ === 0 ? reply('', 302, 'text/html', { location: 'https://anywhere.example.net/' }) : reply('<html>ok</html>')));
  const r = await invoke(h, { path: '/api/fetch?url=' + encodeURIComponent('https://unlisted.example.com/'), headers: { 'x-studio-token': 'tok' } });
  assert.equal(r.status, 200);
});

await check('T2.10 the public limit answers 429 with retry-after and the token path counts separately', async () => {
  const clock = { t: 5000000 };
  const h = make(async () => reply('<html></html>'), { env: { STUDIO_TOKEN: 'tok', STUDIO_PUBLIC_RATE: '2', STUDIO_RATE_LIMIT: '2' }, now: () => clock.t });
  const viaToken = () => invoke(h, { path: '/api/fetch?url=' + encodeURIComponent('https://known.example.com/'), headers: { 'x-studio-token': 'tok', 'x-forwarded-for': '203.0.113.9' } });
  const viaBrowser = () => invoke(h, { path: '/api/fetch?url=' + encodeURIComponent('https://known.example.com/'), headers: { ...browser, 'x-forwarded-for': '203.0.113.9' } });
  assert.equal((await viaBrowser()).status, 200);
  assert.equal((await viaBrowser()).status, 200);
  const over = await viaBrowser();
  assert.equal(over.status, 429);
  assert.equal(over.headers['retry-after'], '60');
  assert.equal((await viaToken()).status, 200);
  assert.equal((await viaToken()).status, 200);
  assert.equal((await viaToken()).status, 429);
  clock.t += 61000;
  assert.equal((await viaBrowser()).status, 200);
  assert.equal(DEFAULT_PUBLIC_RATE, 300);
});

await check('T2.10 each address has its own public budget', async () => {
  const h = make(async () => reply('<html></html>'), { env: { STUDIO_TOKEN: 'tok', STUDIO_PUBLIC_RATE: '1' } });
  const from = (ip) => get(h, 'https://known.example.com/', { ...browser, 'x-forwarded-for': ip });
  assert.equal((await from('198.51.100.1')).status, 200);
  assert.equal((await from('198.51.100.1')).status, 429);
  assert.equal((await from('198.51.100.2')).status, 200);
});

await check('the probe answers without fetching and reports what the caller may use', async () => {
  let hits = 0;
  const h = make(async () => (hits++, reply('x')));
  const inPage = await invoke(h, { path: '/api/fetch?probe=1', headers: browser });
  assert.deepEqual(JSON.parse(inPage.text), { ok: true, mode: 'public' });
  const outside = await invoke(h, { path: '/api/fetch?probe=1', headers: { 'sec-fetch-site': 'cross-site', host: 'studio.test' } });
  assert.deepEqual(JSON.parse(outside.text), { ok: true, mode: 'token' });
  const empty = createHandler({ resolve: publicResolve, request: async () => reply('x'), env: {}, known: { hosts: [], cdn: [] } });
  assert.deepEqual(JSON.parse((await invoke(empty, { path: '/api/fetch?probe=1', headers: browser })).text), { ok: true, mode: 'token' });
  assert.equal(hits, 0);
});

await check('upstream password protection is passed on as a header, tokenless and with a token', async () => {
  const protectedSite = make(async () => reply('<html>sign in</html>', 401, 'text/html', { 'netlify-site-protection-expires-in': '3600' }));
  assert.equal((await get(protectedSite, 'https://one.netlify.app/')).headers['x-upstream-protection'], 'netlify');
  const viaToken = await invoke(protectedSite, { path: '/api/fetch?url=' + encodeURIComponent('https://one.netlify.app/'), headers: { 'x-studio-token': 'tok' } });
  assert.equal(viaToken.headers['x-upstream-protection'], 'netlify');
  const plain = make(async () => reply('<html></html>'));
  assert.equal((await get(plain, 'https://known.example.com/')).headers['x-upstream-protection'], undefined);
});

await check('Netlify protection is recognised from its header or from a Netlify 401 only', () => {
  const read = (h) => headersReader(h);
  assert.equal(netlifyProtection(401, read({ 'Netlify-Site-Protection-Expires-In': '60' })), 'netlify');
  assert.equal(netlifyProtection(200, read({ 'netlify-site-protection-expires-in': '60' })), null);
  assert.equal(netlifyProtection(401, read({ server: 'Netlify' })), 'netlify');
  assert.equal(netlifyProtection(401, read({ 'x-nf-request-id': 'abc' })), 'netlify');
  assert.equal(netlifyProtection(401, read({ server: 'Vercel' })), null);
  assert.equal(netlifyProtection(403, read({})), null);
  assert.equal(netlifyProtection(401, headersReader(new Headers({ Server: 'Netlify' }))), 'netlify');
});

const SITE = 'https://same.test/';
const page = '<html><head><link rel="icon" type="image/png" href="i.png"></head></html>';
const art = () => {
  const img = { width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4) };
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) img.data.set(x > 12 && x < 52 && y > 12 && y < 52 ? [30, 120, 220, 255] : [255, 255, 255, 255], (y * 64 + x) * 4);
  return img;
};
const icon = await encodePng(art(), { optimise: false });
const run = (targets, io, options = {}) => runHarvest({ targets, overrides: {} }, { profile: 'launcher', mode: 'follow', now: NOW, preview: true, ...options }, { readLocal: async () => null, readOverride: async () => null, readOutput: async () => null, sleep: async () => {}, ...io });
const target = (key, url) => ({ key, appId: key, variantId: null, url });

await check('T2.7 an icon that times out once is retried, recorded as two attempts, and other targets are not skipped', async () => {
  const seen = new Map();
  const r = await run([target('first', SITE + 'a/'), target('second', SITE + 'b/')], {
    fetchBytes: async (url) => {
      const n = (seen.get(url) || 0) + 1;
      seen.set(url, n);
      if (url.endsWith('/i.png') && url === 'https://same.test/a/i.png' && n === 1) throw Object.assign(new Error('proxy: upstream timed out'), { timeout: true });
      if (url.endsWith('/i.png')) return { ok: true, status: 200, url, bytes: icon, mitigated: null };
      return { ok: true, status: 200, url, bytes: new TextEncoder().encode(page), mitigated: null };
    }
  });
  const byKey = Object.fromEntries(r.report.items.map((i) => [i.key, i]));
  assert.equal(byKey.first.status, 'found');
  assert.deepEqual(byKey.first.attempts.map((a) => [a.status, a.reason]), [['failed', 'proxy: upstream timed out'], ['used', 'retry after timeout']]);
  assert.equal(byKey.second.status, 'found');
  assert.deepEqual(byKey.second.attempts.map((a) => [a.status, a.reason]), [['used', null]]);
});

await check('T2.7 a page that times out once is retried and the icons are still fetched', async () => {
  let pageCalls = 0;
  const r = await run([target('only', SITE)], {
    fetchBytes: async (url) => {
      if (url === SITE) {
        if (++pageCalls === 1) throw Object.assign(new Error('proxy: upstream timed out'), { timeout: true });
        return { ok: true, status: 200, url, bytes: new TextEncoder().encode(page), mitigated: null };
      }
      return { ok: true, status: 200, url, bytes: icon, mitigated: null };
    }
  });
  const item = r.report.items[0];
  assert.equal(item.status, 'found');
  assert.deepEqual(item.attempts.slice(0, 2).map((a) => [a.type, a.status, a.reason]), [['page', 'failed', 'proxy: upstream timed out'], ['page', 'used', 'retry after timeout']]);
});

await check('T2.7 a timeout waits the page delay before the retry', async () => {
  const waits = [];
  await run([target('only', SITE)], {
    sleep: async (ms) => waits.push(ms),
    fetchBytes: async (url) => {
      if (url === SITE && waits.length === 0) throw Object.assign(new Error('proxy: upstream timed out'), { timeout: true });
      if (url === SITE) return { ok: true, status: 200, url, bytes: new TextEncoder().encode(page), mitigated: null };
      return { ok: true, status: 200, url, bytes: icon, mitigated: null };
    }
  });
  assert.deepEqual(waits, [1500]);
});

await check('T2.8 a password-protected Netlify site ends blocked and never falls back to the bundled copy', async () => {
  let readKnownCalls = 0;
  const bundled = new Uint8Array(fs.readFileSync(path.join(fixturesDir, 'protocols.png')));
  const r = await runHarvest(
    { targets: [target('guarded', 'https://one.netlify.app/')], overrides: {} },
    { profile: 'launcher', mode: 'follow', now: NOW, preview: true },
    {
      ...localIo(),
      sleep: async () => {},
      fetchBytes: async (url) => ({ ok: false, status: 401, url, bytes: new TextEncoder().encode('<html>password</html>'), mitigated: null, protection: 'netlify' }),
      readKnown: async () => (readKnownCalls++, { bytes: bundled, file: 'known/guarded.png' })
    }
  );
  const item = r.report.items[0];
  assert.equal(item.status, 'blocked');
  assert.equal(item.error, NETLIFY_PROTECTED_MESSAGE);
  assert.ok(!(item.attempts || []).some((a) => a.type === 'bundled'));
  assert.equal(readKnownCalls, 0);
  assert.equal(r.records[0].image, null);
});

await check('T2.8 a Vercel challenge page still falls back to the bundled copy as before', async () => {
  const bundled = new Uint8Array(fs.readFileSync(path.join(fixturesDir, 'protocols.png')));
  const r = await runHarvest(
    { targets: [target('guarded', 'https://one.vercel.app/')], overrides: {} },
    { profile: 'launcher', mode: 'follow', now: NOW, preview: true },
    { ...localIo(), sleep: async () => {}, fetchBytes: async (url) => ({ ok: false, status: 403, url, bytes: new TextEncoder().encode('<html>checkpoint</html>'), mitigated: 'challenge' }), readKnown: async () => ({ bytes: bundled, file: 'known/guarded.png' }) }
  );
  assert.equal(r.report.items[0].source.type, 'bundled');
});

await check('the shipped known-hosts list is in step with the config files', async () => {
  const onDisk = fs.readFileSync(knownHostsFile(studioDir), 'utf8');
  assert.equal(onDisk, await buildKnownHosts(studioDir));
  const parsed = JSON.parse(onDisk);
  assert.ok(parsed.hosts.includes('strong-snickerdoodle-02a92f.netlify.app'));
  assert.ok(parsed.hosts.every((h) => h === h.toLowerCase() && !h.includes('/')));
});

await check('T2.6 a build with a token in the environment leaves no secret in dist', () => {
  const secret = 'tok_' + 'f3a9c1d27b8e4455a1b2c3d4e5f60718';
  const r = spawnSync(process.execPath, [path.join(studioDir, 'scripts', 'build.mjs')], { env: { ...process.env, STUDIO_TOKEN: secret }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const textual = walk(path.join(studioDir, 'dist')).filter((f) => /\.(js|css|html|json|svg|webmanifest|txt)$/.test(f));
  assert.ok(textual.length > 5);
  for (const file of textual) {
    const body = fs.readFileSync(file, 'utf8');
    assert.ok(!body.includes(secret), file + ' holds the token');
    assert.ok(!body.includes('STUDIO_TOKEN='), file + ' holds STUDIO_TOKEN=');
    assert.ok(!/token[^A-Za-z0-9]{0,12}[0-9a-f]{32,}/i.test(body), file + ' has a hex run next to token');
    assert.ok(!/token[^A-Za-z0-9]{0,12}[A-Za-z0-9+/=_-]{32,}/i.test(body), file + ' has a base64 run next to token');
  }
});

const stubSite = {
  'https://stub-protected.netlify.app/': { type: 'text/html', body: Buffer.from('<html><head><link rel="icon" type="image/png" sizes="192x192" href="/icon.png"></head></html>') },
  'https://stub-protected.netlify.app/icon.png': { type: 'image/png', body: fs.readFileSync(path.join(fixturesDir, 'dafter.png')) }
};
const seenRequests = [];
const stubProxy = createHandler({
  resolve: publicResolve,
  request: async ({ url }) => {
    const hit = stubSite[url.href];
    return hit ? reply(hit.body, 200, hit.type) : reply('missing', 404);
  },
  env: {},
  known: { hosts: ['stub-protected.netlify.app'], cdn: [] }
});
const server = await serve(4201, (req, res) => {
  seenRequests.push({ url: req.url, token: req.headers['x-studio-token'], site: req.headers['sec-fetch-site'] });
  return stubProxy(req, res);
});
const exe = fs.readdirSync('/opt/pw-browsers').filter((d) => d.startsWith('chromium-')).flatMap((d) => ['chrome-linux64', 'chrome-linux'].map((s) => '/opt/pw-browsers/' + d + '/' + s + '/chrome')).find((p) => fs.existsSync(p));
const chrome = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const ctx = await chrome.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' });
const errors = [];
const tab = await ctx.newPage();
tab.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
tab.on('pageerror', (e) => errors.push(e.message));
await tab.goto('http://localhost:4201/');
await tab.waitForSelector('#urls');

await check('T2.9 the first screen shows no proxy warning and Settings says the proxy is built in', async () => {
  assert.equal(await tab.locator('.note.bad, .toast').count(), 0);
  assert.ok(!/no fetch proxy|add a fetch proxy/i.test(await tab.locator('main').innerText()));
  await tab.getByRole('button', { name: 'Settings' }).click();
  await tab.waitForSelector('#px-status');
  assert.equal(await tab.locator('#px-status').innerText(), 'Proxy: built-in (automatic)');
  await tab.keyboard.press('Escape');
});

await check('T2.9 a Netlify site on the known list is harvested with no token typed in', async () => {
  await tab.locator('#urls').fill('https://stub-protected.netlify.app/');
  await tab.click('#go');
  await tab.waitForSelector('.gallery .cell .tile-art:not(.ghost)', { timeout: 120000 });
  assert.equal(await tab.locator('.gallery .cell').count(), 1);
  const proxied = seenRequests.filter((r) => r.url.startsWith('/api/fetch?url='));
  assert.ok(proxied.length >= 2);
  assert.ok(proxied.every((r) => r.token === undefined && r.site === 'same-origin'));
});

await check('T2.9 a site that is not on the list gets an explanation instead of an access-token error', async () => {
  await tab.reload();
  await tab.waitForSelector('#urls');
  await tab.locator('#urls').fill('https://unlisted.example.org/');
  await tab.click('#go');
  await tab.waitForSelector('.note.bad', { timeout: 120000 });
  const text = await tab.locator('.note.bad').innerText();
  assert.match(text, /known sites/i);
});

await check('no console errors in the browser run', () => assert.deepEqual(errors.filter((e) => !/401|Failed to load resource/.test(e)), []));

await chrome.close();
server.close();
finish();
