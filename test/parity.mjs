import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { check, finish, studioDir } from './util.mjs';
import { hashRun, linkSets, hookInventory } from './golden/make.mjs';

const golden = async (name) => JSON.parse(await fs.readFile(path.join(studioDir, 'test', 'golden', name), 'utf8'));

await check('P0.1 every app link from both launcher files is still parsed, with the same address (more is allowed)', async () => {
  const before = await golden('links.json');
  const now = await linkSets();
  for (const [set, entries] of Object.entries(before)) {
    assert.ok(Object.keys(entries).length >= 33, set + ' golden is too small');
    const missing = Object.keys(entries).filter((k) => !(k in now[set]));
    assert.deepEqual(missing, [], set + ' lost keys');
    const moved = Object.keys(entries).filter((k) => now[set][k] !== entries[k]);
    assert.deepEqual(moved, [], set + ' changed addresses');
  }
});

await check('P0.2 the launcher and Fihrist files each still yield at least their golden count', async () => {
  const before = await golden('links.json');
  const now = await linkSets();
  for (const set of Object.keys(before)) assert.ok(Object.keys(now[set]).length >= Object.keys(before[set]).length, set);
});

await check('P0.3 the default v3 output is byte-identical to main', async () => {
  const before = await golden('hashes.json');
  assert.deepEqual(await hashRun(), before.v3);
});

await check('P0.4 the default v4 output is byte-identical to main', async () => {
  const before = await golden('hashes.json');
  assert.deepEqual(await hashRun('v4'), before.v4);
});

await check('P0.5 every UI hook the browser suites rely on still exists', async () => {
  const before = await golden('hooks.json');
  const now = await hookInventory();
  for (const kind of ['ids', 'acts', 'studio']) {
    const lost = before[kind].filter((h) => !now[kind].includes(h));
    assert.deepEqual(lost, [], kind + ' hooks removed without updating the inventory');
  }
});

finish();
