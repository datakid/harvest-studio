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

finish();
