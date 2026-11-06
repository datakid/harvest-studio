import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { serve } from '../scripts/serve.mjs';
import { createHandler } from '../api/fetch.js';

const [, , file, label] = process.argv;
const server = await serve(4300, createHandler({ env: {} }));
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const proxy = { total: 0, byStatus: {}, byUpstream: {}, slow: 0 };
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));
page.on('response', (r) => {
  if (!r.url().includes('/api/fetch') || r.url().includes('probe=1')) return;
  proxy.total++;
  proxy.byStatus[r.status()] = (proxy.byStatus[r.status()] || 0) + 1;
  const up = r.headers()['x-upstream-status'] || 'none';
  proxy.byUpstream[up] = (proxy.byUpstream[up] || 0) + 1;
});
await page.goto('http://localhost:4300/');
await page.waitForTimeout(1500);
console.log('=== ' + label + ' ===');
console.log('probe:', await page.evaluate(() => fetch('/api/fetch?probe=1').then((r) => r.json())));
await page.setInputFiles('#pick-files', file);
await page.waitForSelector('#go');
await page.waitForTimeout(800);
const started = Date.now();
await page.click('#go');
let ok = true;
try {
  await page.waitForFunction(() => window.__studio && window.__studio.state.stage === 'work', null, { timeout: 420000 });
} catch (e) {
  ok = false;
}
await page.waitForTimeout(2000);
console.log('reached work stage:', ok, 'seconds:', Math.round((Date.now() - started) / 1000));
const dump = await page.evaluate(() => {
  const s = window.__studio.state;
  const items = [...s.items.values()].map((i) => ({ key: i.key, status: i.status, error: i.error, attempts: (i.attempts || []).slice(0, 5), hasImage: !!(s.records.get(i.key) && s.records.get(i.key).image) }));
  return { total: items.length, records: s.records.size, items };
});
const counts = {};
for (const i of dump.items) counts[i.status] = (counts[i.status] || 0) + 1;
console.log('items:', dump.total, 'records with image:', dump.items.filter((i) => i.hasImage).length, JSON.stringify(counts));
console.log('proxy responses:', JSON.stringify(proxy));
console.log('console errors:', JSON.stringify([...new Set(errors)].slice(0, 6)));
for (const i of dump.items.filter((x) => x.status !== 'found' || !x.hasImage)) console.log('  ' + i.key.padEnd(32) + i.status + ' | ' + String(i.error).slice(0, 160) + '\n      ' + JSON.stringify(i.attempts).slice(0, 300));
await page.screenshot({ path: 'diag-' + label + '.png' });
await browser.close();
server.close();
