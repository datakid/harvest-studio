import assert from 'node:assert/strict';
import fs from 'node:fs';
import { scanJson } from '../core/sources.js';
import { rank } from '../src/search.js';
import { check, finish, studioDir } from './util.mjs';
import path from 'node:path';

const read = (f) => JSON.parse(fs.readFileSync(path.join(studioDir, 'config', f), 'utf8'));
const docsOf = (data, lang) =>
  scanJson(data, {}, lang).targets.map((t) => ({ key: t.key, name: t.name, terms: t.terms || [], url: t.url || '', group: t.groupId || '', tint: (t.catalogueTint && t.catalogueTint[0]) || '' }));
const en = docsOf(read('fihrist.json'), 'en');
const ar = docsOf(read('fihrist.json'), 'ar');
const launcher = docsOf(read('catalogue.json'), 'en');
const top = (docs, q, n = 3) => rank(docs, q).slice(0, n);
const has = (docs, q, key) => assert.ok(rank(docs, q).includes(key), q + ' should find ' + key + ', got ' + rank(docs, q).slice(0, 6).join(','));

await check('S1 an empty query keeps every tile and a query with no match keeps none', () => {
  assert.equal(rank(en, '   ').length, en.length);
  assert.equal(rank(en, 'zzzzqx').length, 0);
});

await check('S2 the app name wins, whole or by prefix, and ranks above weaker matches', () => {
  assert.equal(top(en, 'harvest studio', 1)[0], 'harvest-studio');
  assert.equal(top(en, 'solver', 1)[0], 'solver');
  assert.equal(top(en, 'harv', 1)[0], 'harvest-studio');
});

await check('S3 typos and half-remembered spellings still find the app', () => {
  has(en, 'ledgr', 'ledger-form--main');
  has(en, 'harvset', 'harvest-studio');
  has(en, 'surviwal', 'survival-mirror');
  has(en, 'platn', 'platen');
  has(en, 'pwr quer', 'power-query-manager');
  has(en, 'typngprac', 'typing-practice');
});

await check('S4 aliases and franco spellings from the Fihrist file find the app in either language', () => {
  has(en, 'khargy', 'ledger-form--main');
  has(ar, 'khargy', 'ledger-form--main');
  has(en, 'khetta', 'plan-maker--full');
  has(en, 'ledger', 'ledger-form--main');
  has(ar, 'ledger', 'ledger-form--main');
});

await check('S5 Arabic matches ignore diacritics, hamza forms and the closing ta', () => {
  has(ar, 'خارجي', 'ledger-form--main');
  has(ar, 'الخطه', 'plan-maker--full');
  has(ar, 'الخطّة', 'plan-maker--full');
  has(ar, 'باور كويري', 'power-query-manager');
  has(en, 'حصاد', 'harvest-studio');
});

await check('S6 the address finds the app by host, path or fragment of either', () => {
  has(en, 'roi-calc-express', 'roi--express');
  has(en, 'netlify', 'paper');
  has(en, 'platen-2zj1', 'platen');
  has(launcher, 'power-query-manager', 'quoin');
  assert.ok(rank(en, 'vercel').length > 40);
});

await check('S7 words combine: every word has to match and the group counts as a word', () => {
  const both = rank(en, 'print letters');
  assert.ok(both.includes('letters') && !both.includes('solver'));
  assert.deepEqual(rank(en, 'solver letters'), []);
  has(en, 'experimental draw', 'draw');
});

await check('S8 colour names, Arabic colour names and hex prefixes select by colour', () => {
  const red = rank(en, 'red');
  assert.ok(!red.includes('adad'));
  const madder = en.filter((d) => d.tint === '#c4403f').map((d) => d.key);
  for (const k of madder) assert.ok(red.includes(k), k);
  const arRed = rank(ar, 'احمر');
  for (const k of madder) assert.ok(arRed.includes(k), k);
  const hex = rank(en, '#c4403');
  for (const k of madder) assert.ok(hex.includes(k), k);
  assert.ok(hex.every((k) => en.find((d) => d.key === k).tint.startsWith('#c4403')));
  assert.ok(rank(en, 'green').includes('adad'));
});

await check('S9 two thousand tiles answer in well under a frame', () => {
  const big = Array.from({ length: 2000 }, (_, i) => ({ key: 'k' + i, name: 'Tool ' + i + ' ' + ['ledger', 'solver', 'planner'][i % 3], terms: ['alias' + i, 'khargy'], url: 'https://app-' + i + '.vercel.app/', group: 'core', tint: '#' + ((i * 2654435) % 0xffffff).toString(16).padStart(6, '0') }));
  rank(big, 'warm');
  const slowest = Math.max(
    ...['ledgr', 'khargy', 'app-19', 'red planner'].map((q) => {
      const runs = [0, 1, 2].map(() => {
        const started = performance.now();
        rank(big, q);
        return performance.now() - started;
      });
      return Math.min(...runs);
    })
  );
  assert.ok(slowest < 40, slowest + ' ms for the slowest query');
  const started = performance.now();
  rank(en, 'ledgr');
  assert.ok(performance.now() - started < 10);
});

finish();
