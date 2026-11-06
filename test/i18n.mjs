import assert from 'node:assert/strict';
import { check, finish } from './util.mjs';
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

finish();
