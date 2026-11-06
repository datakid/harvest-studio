import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { check, finish, studioDir } from './util.mjs';
import { scanJson, hostKey, normalizeUrl, uniqueKeys, pickLabel } from '../core/sources.js';
import { readLinks, readBaseHref } from '../core/discover.js';

const links = JSON.parse(await fs.readFile(path.join(studioDir, 'test', 'links.json'), 'utf8'));

await check('the real launcher catalogue is detected with variant keys', () => {
  const s = scanJson(links);
  assert.equal(s.kind, 'launcher');
  assert.equal(s.count, 32);
  assert.ok(s.targets.some((t) => t.key.includes('--')));
  assert.ok(s.targets.every((t) => /^[a-z0-9-]+$/.test(t.key) && t.url));
});

await check('an array of objects finds the url and name fields', () => {
  const s = scanJson({ tools: [{ name: 'Alpha Tool', homepage: 'https://alpha.example.com/' }, { name: 'Beta', homepage: 'beta.example.org' }, { name: 'Gamma', homepage: 'https://gamma.dev/app' }] });
  assert.equal(s.kind, 'generic');
  assert.equal(s.fields.collection, 'tools');
  assert.equal(s.fields.urlField, 'homepage');
  assert.equal(s.fields.nameField, 'name');
  assert.equal(s.count, 3);
  assert.equal(s.targets[1].url, 'https://beta.example.org');
  assert.deepEqual(s.targets.map((t) => t.key), ['alpha-tool', 'beta', 'gamma']);
});

await check('a bare list of urls and an object map of urls both work', () => {
  const list = scanJson(['https://a.example.com', 'https://b.example.com/x']);
  assert.equal(list.count, 2);
  assert.deepEqual(list.targets.map((t) => t.key), ['a-example-com', 'b-example-com-x']);
  const map = scanJson({ mail: 'https://mail.example.com', docs: 'https://docs.example.com' });
  assert.deepEqual(map.targets.map((t) => t.key).sort(), ['docs', 'mail']);
});

await check('nested collections are found and the biggest wins', () => {
  const s = scanJson({ meta: { owner: 'x' }, data: { sites: [{ id: 'one', url: 'https://one.test' }, { id: 'two', url: 'https://two.test' }], other: [{ url: 'https://solo.test' }] } });
  assert.equal(s.fields.collection, 'data.sites');
  assert.deepEqual(s.targets.map((t) => t.key), ['one', 'two']);
});

await check('icon fields become direct icon sources and can be overridden', () => {
  const data = { apps: [{ name: 'A', url: 'https://a.test', icon: 'https://a.test/i.png' }, { name: 'B', url: 'https://b.test', icon: 'data:image/png;base64,AAAA' }] };
  const s = scanJson(data);
  assert.equal(s.fields.iconField, 'icon');
  assert.equal(s.targets[0].iconHref, 'https://a.test/i.png');
  const off = scanJson(data, { iconField: null });
  assert.equal(off.targets[0].iconHref, null);
  assert.equal(off.targets[0].url, 'https://a.test');
});

await check('json without sites reports none, and duplicate keys are made unique', () => {
  assert.equal(scanJson({ a: 1, b: [1, 2, 3] }).kind, 'none');
  assert.equal(scanJson([]).kind, 'none');
  const keys = uniqueKeys([{ key: 'x' }, { key: 'x' }, { key: 'X!' }, { key: '' }]).map((t) => t.key);
  assert.equal(new Set(keys).size, 4);
});

await check('url helpers normalise addresses', () => {
  assert.equal(normalizeUrl('example.com'), 'https://example.com');
  assert.equal(normalizeUrl('http://x.test/a b'), null);
  assert.equal(normalizeUrl('hello'), null);
  assert.equal(hostKey('https://www.Example.com/app/'), 'example-com-app');
});

await check('icon links keep a > inside a quoted attribute, as inline SVG favicons do', () => {
  const raw = readLinks('<head><link rel="icon" href="data:image/svg+xml,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 9 9\'><rect width=\'9\' height=\'9\'/></svg>"><link rel="apple-touch-icon" href="/a.png"></head>');
  assert.equal(raw.length, 2);
  assert.match(raw[0].href, /<\/svg>$/);
  assert.equal(raw[1].href, '/a.png');
  const single = readLinks("<link rel='icon' href='data:image/svg+xml,<svg xmlns=\"http://www.w3.org/2000/svg\"><circle r=\"4\"/></svg>'>");
  assert.match(single[0].href, /<circle r="4"\/><\/svg>$/);
  assert.match(readBaseHref('<base href="https://cdn.test/x/?a=1>2">', 'https://page.test/'), /^https:\/\/cdn\.test\/x\/\?a=1/);
});

await check('icon links ignore commented-out and script-embedded tags', () => {
  const found = readLinks('<!-- <link rel="icon" href="/old.png"> --><script>var s = \'<link rel="icon" href="/js.png">\';</script><link rel=icon href=/real.png>');
  assert.deepEqual(found.map((l) => l.href), ['/real.png']);
});

await check('pickLabel handles strings, locale objects and gaps', () => {
  assert.equal(pickLabel('Plain'), 'Plain');
  assert.equal(pickLabel({ ar: 'أ', en: 'A' }, 'ar'), 'أ');
  assert.equal(pickLabel({ ar: 'أ', en: 'A' }, 'fr'), 'A');
  assert.equal(pickLabel({ ar: 'أ' }, 'en'), 'أ');
  assert.equal(pickLabel({ de: 'D' }, 'en'), 'D');
  assert.equal(pickLabel(null), '');
  assert.equal(pickLabel({ en: '' }), '');
});

await check('catalogue names are plain text: app title plus variant label', () => {
  const en = scanJson(links, {}, 'en').targets;
  assert.ok(en.every((t) => typeof t.name === 'string' && !/object/i.test(t.name)));
  const byKey = Object.fromEntries(en.map((t) => [t.key, t.name]));
  assert.equal(byKey.protocols, 'Protocols');
  assert.equal(byKey['paid-calculator--daleel'], 'Paid · Daleel 460');
  assert.equal(byKey['ledger-form--tally'], 'Form · Tally');
  const ar = Object.fromEntries(scanJson(links, {}, 'ar').targets.map((t) => [t.key, t.name]));
  assert.equal(ar.protocols, 'بروتوكولات الصرف');
  assert.equal(ar['paid-calculator--daleel'], 'المنفذ والتحمل · دليل 460');
});

const bilingual = {
  sites: [
    { id: 'alpha', name: { en: 'Alpha', ar: 'ألفا' }, url: 'https://alpha.example.com', logo: 'https://alpha.example.com/logo.png' },
    { id: 'beta', name: { en: 'Beta', ar: 'بيتا' }, url: 'https://beta.example.com' },
    { id: 'gamma', name: { ar: 'جاما' }, url: 'https://gamma.example.com' }
  ]
};

await check('generic json: name objects pick the chosen language and fall back', () => {
  const en = scanJson(bilingual, {}, 'en');
  assert.equal(en.kind, 'generic');
  assert.equal(en.fields.nameField, 'name');
  assert.deepEqual(en.targets.map((t) => t.name), ['Alpha', 'Beta', 'جاما']);
  assert.deepEqual(scanJson(bilingual, {}, 'ar').targets.map((t) => t.name), ['ألفا', 'بيتا', 'جاما']);
  assert.equal(en.candidates.name[0], 'name');
});

await check('generic json: keys do not change with the label language', () => {
  const noId = { sites: [{ name: { en: 'Alpha', ar: 'ألفا' }, url: 'https://a.example.com' }, { name: { en: 'Beta', ar: 'بيتا' }, url: 'https://b.example.com' }] };
  const keys = (lang) => scanJson(noId, {}, lang).targets.map((t) => t.key);
  assert.deepEqual(keys('en'), ['alpha', 'beta']);
  assert.deepEqual(keys('ar'), keys('en'));
  assert.deepEqual(scanJson(bilingual, {}, 'ar').targets.map((t) => t.key), ['alpha', 'beta', 'gamma']);
});

await check('generic json: url and icon fields may also be locale objects', () => {
  const data = { items: [{ title: { en: 'One' }, link: { en: 'https://one.example.com', ar: 'https://one.example.com/ar' }, icon: { en: 'https://one.example.com/i.png' } }, { title: { en: 'Two' }, link: { en: 'https://two.example.com' } }] };
  const en = scanJson(data, {}, 'en');
  assert.deepEqual(en.targets.map((t) => t.url), ['https://one.example.com', 'https://two.example.com']);
  assert.equal(en.targets[0].iconHref, 'https://one.example.com/i.png');
  assert.equal(scanJson(data, {}, 'ar').targets[0].url, 'https://one.example.com/ar');
});

await check('the scan lists the label languages found in the file', () => {
  assert.deepEqual(scanJson(bilingual).languages, ['ar', 'en']);
  assert.deepEqual(scanJson(links).languages, ['ar', 'en']);
  assert.deepEqual(scanJson({ sites: [{ name: 'A', url: 'https://a.example.com' }] }).languages, []);
});

await check('pickLabel accepts upper-case language keys', () => {
  assert.equal(pickLabel({ EN: 'A', AR: 'أ' }, 'ar'), 'أ');
});

finish();
