import assert from 'node:assert/strict';
import { check, finish } from './util.mjs';
import { siteReports } from '../core/report.js';

const items = [
  { key: 'alpha', url: 'https://alpha.test', status: 'found', source: { type: 'link', href: 'https://alpha.test/i.png' }, attempts: [{ type: 'link', href: 'https://alpha.test/i.png', status: 'used', reason: 'declared' }] },
  { key: 'beta', url: 'https://beta.test', status: 'notfound', error: null, attempts: [{ type: 'page', href: 'https://beta.test', status: 'failed', reason: 'HTTP 502' }, { type: 'link', href: 'https://beta.test/f.ico', status: 'rejected', reason: 'too small' }] },
  { key: 'gamma', url: 'https://gamma.test', status: 'found', flags: ['stale-source'], attempts: [{ type: 'page', href: 'https://gamma.test', status: 'failed', reason: 'HTTP 502' }, { type: 'known', href: 'gamma', status: 'used', reason: 'live fetch failed, using the copy shipped with the app' }] },
  { key: 'a/b c', url: null, status: 'blocked', error: 'protected by a login', attempts: [] },
  { key: 'a_b_c', url: null, status: 'notfound', attempts: [] }
];

const docs = siteReports(items, { generatedAt: '2026-01-01T00:00:00.000Z' });

await check('one file per site plus an index', () => {
  assert.equal(Object.keys(docs).filter((n) => !n.endsWith('_index.json')).length, items.length);
  assert.equal(docs['reports/_index.json'].total, items.length);
});

await check('file names are safe and never collide', () => {
  const names = Object.keys(docs);
  assert.equal(new Set(names).size, names.length);
  for (const n of names) assert.match(n, /^reports\/[A-Za-z0-9._-]+\.json$/);
});

await check('a failed site says why', () => {
  assert.equal(docs['reports/beta.json'].outcome, 'notfound');
  assert.equal(docs['reports/beta.json'].reason, 'HTTP 502');
  assert.equal(docs['reports/beta.json'].failures.length, 2);
  assert.equal(docs['reports/a_b_c.json'] ? docs['reports/a_b_c.json'].key : null, 'a/b c');
});

await check('a shipped copy is told apart from a live find', () => {
  assert.equal(docs['reports/alpha.json'].outcome, 'live');
  assert.equal(docs['reports/alpha.json'].reason, null);
  assert.equal(docs['reports/gamma.json'].outcome, 'bundled');
  assert.equal(docs['reports/gamma.json'].reason, 'HTTP 502');
  assert.deepEqual(docs['reports/_index.json'].outcomes, { live: 1, notfound: 2, bundled: 1, blocked: 1 });
});

const outcomes = siteReports(
  [
    { key: 'live', url: 'https://l.test', status: 'found', source: { type: 'link', href: 'https://l.test/i.png' }, attempts: [{ type: 'link', href: 'https://l.test/i.png', status: 'used', reason: 'declared' }] },
    { key: 'bundled', url: 'https://b.test', status: 'found', source: { type: 'bundled', href: 'known-icons/bundled.png' }, attempts: [{ type: 'page', href: 'https://b.test', status: 'failed', reason: 'HTTP 502' }, { type: 'known', href: 'bundled', status: 'used', reason: 'live fetch failed, using the saved icon' }] },
    { key: 'worded', url: 'https://w.test', status: 'found', source: { type: 'link', href: 'https://w.test/i.png' }, attempts: [{ type: 'link', href: 'https://w.test/i.png', status: 'used', reason: 'shipped in the page head' }] },
    { key: 'stale', url: 'https://s.test', status: 'stale', attempts: [] },
    { key: 'default', url: 'https://d.test', status: 'default', attempts: [{ type: 'link', href: 'https://d.test/f.ico', status: 'rejected', reason: 'a single flat colour' }] },
    { key: 'override', url: null, status: 'override', source: { type: 'override', href: 'fa' }, attempts: [] },
    { key: 'notfound', url: 'https://n.test', status: 'notfound', attempts: [{ type: 'page', href: 'https://n.test', status: 'failed', reason: 'HTTP 404' }] },
    { key: 'blocked', url: 'https://x.test', status: 'blocked', attempts: [{ type: 'page', href: 'https://x.test', status: 'blocked', reason: 'HTTP 403' }] }
  ],
  { generatedAt: '2026-01-01T00:00:00.000Z' }
);

await check('every outcome is reported once: live, bundled, stale, default, override, notfound and blocked', () => {
  const got = Object.fromEntries(outcomes['reports/_index.json'].sites.map((s) => [s.key, s.outcome]));
  assert.deepEqual(got, { live: 'live', bundled: 'bundled', worded: 'live', stale: 'stale', default: 'default', override: 'override', notfound: 'notfound', blocked: 'blocked' });
});

await check('a bundled copy is recognised by its source type, not by the wording of a reason', () => {
  assert.equal(outcomes['reports/bundled.json'].reason, 'HTTP 502');
  assert.equal(outcomes['reports/worded.json'].outcome, 'live');
});

finish();
