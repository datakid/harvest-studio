import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { check, finish, studioDir } from './util.mjs';
import { dictionaries } from '../src/i18n.js';

const { en, ar } = dictionaries;

await check('I1 English and Arabic have exactly the same keys', () => {
  const only = (a, b) => Object.keys(a).filter((k) => !(k in b));
  assert.deepEqual(only(en, ar), [], 'missing in Arabic');
  assert.deepEqual(only(ar, en), [], 'missing in English');
});

await check('I2 no string is empty and both languages use the same placeholders', () => {
  for (const k of Object.keys(en)) {
    assert.ok(en[k].trim() && ar[k].trim(), k);
    const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
    assert.equal(vars(en[k]), vars(ar[k]), k);
  }
});

await check('I3 no string carries an exclamation mark', () => {
  for (const [name, d] of [['en', en], ['ar', ar]]) for (const [k, v] of Object.entries(d)) assert.ok(!v.includes('!'), name + ' ' + k);
});

await check('I4 labels stay within 40 characters unless they are errors, confirmations or tips', () => {
  for (const [name, d] of [['en', en], ['ar', ar]]) {
    for (const [k, v] of Object.entries(d)) {
      if (/(Error|Confirm|Tip)$/.test(k)) continue;
      assert.ok(v.replace(/\{\w+\}/g, '').length <= 40, name + ' ' + k + ' is ' + v.length);
    }
  }
});

const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []));
const sources = files(path.join(studioDir, 'src')).filter((f) => !f.endsWith('i18n.js'));

await check('I5 every key the interface asks for exists in both languages', () => {
  const missing = [];
  for (const f of sources) {
    const text = fs.readFileSync(f, 'utf8');
    for (const m of text.matchAll(/\bt\('([A-Za-z0-9]+)'(?!\s*\+)/g)) if (!(m[1] in en)) missing.push(path.basename(f) + ': ' + m[1]);
    for (const m of text.matchAll(/\bt\('([A-Za-z]+)' \+/g)) assert.ok(Object.keys(en).some((k) => k.startsWith(m[1])), m[1]);
  }
  assert.deepEqual(missing, []);
});

await check('I6 every key in the dictionary is used somewhere', () => {
  const text = sources.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  const dynamic = ['status', 'attempt', 'mode', 'preset', 'harmony', 'gate', 'sc', 'hist'];
  const unused = Object.keys(en).filter((k) => !new RegExp("'" + k + "'").test(text) && !dynamic.some((p) => k.startsWith(p)));
  assert.deepEqual(unused, []);
});

finish();
