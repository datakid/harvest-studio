#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const manifestHash = (dir) => {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.v2.json'), 'utf8'));
    return typeof manifest.hash === 'string' ? manifest.hash : null;
  } catch {
    return null;
  }
};

export const shouldOpenPr = (before, after) => !!after && before !== after;

const list = (keys) => (keys.length ? keys.map((k) => '`' + k + '`').join(', ') : 'none');

const cell = (v) => String(v === null || v === undefined || v === '' ? '-' : v).replace(/\|/g, '\\|').replace(/\n/g, ' ');

const sourceOf = (item) => (item.source ? item.source.type + ' ' + String(item.source.href || '').replace(/^https?:\/\//, '') : '-');

const traceOf = (item) => {
  if (!item.trace) return item.glyph === 'raster' ? 'raster fallback' : '-';
  if (!item.trace.accepted) return 'rejected (' + item.trace.reason + ')';
  return 'IoU ' + item.trace.iou;
};

const flagsOf = (item) => [...(item.why || []), ...(item.status !== 'found' ? [item.status] : []), ...(item.contrast === 'flagged' ? ['contrast'] : [])].join(', ');

export const prBody = ({ set, diff, report, artifactUrl = null }) => {
  const touched = new Set([...diff.added, ...diff.changed]);
  const items = (report.items || []).filter((i) => touched.has(i.key));
  const lines = [];
  lines.push('Icons re-harvested for the ' + set + ' set by the reusable Harvest Studio workflow.', '');
  lines.push('**Added:** ' + list(diff.added));
  lines.push('**Changed:** ' + list(diff.changed));
  lines.push('**Removed:** ' + list(diff.removed), '');
  if (items.length) {
    lines.push('| Key | Source | Tint | Trace | Flags |', '| --- | --- | --- | --- | --- |');
    for (const i of items) lines.push('| `' + i.key + '` | ' + cell(sourceOf(i)) + ' | ' + cell((i.tint || []).join(' ')) + ' | ' + cell(traceOf(i)) + ' | ' + cell(flagsOf(i)) + ' |');
    lines.push('');
  }
  const p = report.polish;
  if (p) lines.push('**Polish:** ' + p.tiles + ' tiles, ' + p.glyphTiles + ' glyphs, ' + p.rasterFallbacks + ' raster fallbacks, ' + p.contrastFlags + ' contrast flags, ' + p.similarPairs + ' similar pairs, ' + p.strokeRetraced.length + ' stroke retraces.', '');
  const attention = (report.items || []).filter((i) => i.status === 'blocked' || i.status === 'stale' || (i.source && i.source.type === 'bundled'));
  lines.push('**Needs the owner**', '');
  if (attention.length) for (const i of attention) lines.push('- [ ] `' + i.key + '`: ' + (i.status === 'blocked' ? 'blocked' + (i.error ? ', ' + i.error : '') : i.status === 'stale' ? 'stale source, the previous icon was kept' : 'stale-source, a bundled icon was used'));
  else lines.push('Nothing flagged.');
  lines.push('');
  if (artifactUrl) lines.push('Full report: ' + artifactUrl, '');
  return lines.join('\n');
};

const parse = (argv) => {
  const out = {};
  for (let i = 1; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--') || argv[i + 1] === undefined) throw new Error('bad arguments');
    out[argv[i].slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = argv[i + 1];
  }
  return out;
};

const main = () => {
  const cmd = process.argv[2];
  const args = parse(process.argv.slice(2));
  if (cmd === 'hash') {
    process.stdout.write((manifestHash(args.dir) || 'none') + '\n');
  } else if (cmd === 'should-open') {
    const open = shouldOpenPr(args.before === 'none' ? null : args.before, args.after === 'none' ? null : args.after);
    process.stdout.write(String(open) + '\n');
  } else if (cmd === 'body') {
    const body = prBody({ set: args.set || 'launcher', diff: JSON.parse(fs.readFileSync(args.diff, 'utf8')), report: JSON.parse(fs.readFileSync(args.report, 'utf8')), artifactUrl: args.artifactUrl || null });
    fs.writeFileSync(args.out, body);
  } else throw new Error('usage: workflow.mjs hash|should-open|body');
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
