#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildTargets, buildFihristTargets, isFihrist, errText } from '../core/index.js';

const ZERO = /^0+$/;

export const targetsOf = (data, set) => (set === 'fihrist' ? buildFihristTargets(data, 'en') : buildTargets(data));

const signature = (t) => JSON.stringify([t.url || null, t.faIcon || null, t.catalogueTint || null]);

export const diffTargets = (baseTargets, headTargets) => {
  const base = new Map(baseTargets.map((t) => [t.key, t]));
  const head = new Map(headTargets.map((t) => [t.key, t]));
  const added = [];
  const changed = [];
  const removed = [];
  for (const [key, t] of head) {
    if (!base.has(key)) added.push(key);
    else if (signature(base.get(key)) !== signature(t)) changed.push(key);
  }
  for (const key of base.keys()) if (!head.has(key)) removed.push(key);
  return { added: added.sort(), changed: changed.sort(), removed: removed.sort() };
};

export const diffLinks = (baseData, headData, set = 'launcher') => {
  if (baseData === null) {
    const keys = targetsOf(headData, set).map((t) => t.key).sort();
    return { added: [], changed: keys, removed: [], renamedOnly: false, full: true, only: keys };
  }
  const d = diffTargets(targetsOf(baseData, set), targetsOf(headData, set));
  const relevant = d.added.length + d.changed.length + d.removed.length > 0;
  const same = JSON.stringify(baseData) === JSON.stringify(headData);
  return { ...d, renamedOnly: !relevant && !same, full: false, only: [...d.added, ...d.changed].sort() };
};

const gitShow = (sha, file) => {
  try {
    return execFileSync('git', ['show', sha + ':' + file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
};

const parseArgs = (argv) => {
  const out = { base: null, head: null, links: null, set: 'launcher', baseFile: null, headFile: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = argv[i + 1];
    if (!['--base', '--head', '--links', '--set', '--base-file', '--head-file'].includes(a)) throw new Error('unknown flag ' + a);
    if (v === undefined || v.startsWith('--')) throw new Error(a + ' needs a value');
    out[a.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = v;
    i++;
  }
  if (!['launcher', 'fihrist'].includes(out.set)) throw new Error('--set must be launcher or fihrist');
  return out;
};

const main = () => {
  const args = parseArgs(process.argv.slice(2));
  let headText;
  let baseText = null;
  if (args.headFile) {
    headText = fs.readFileSync(args.headFile, 'utf8');
    baseText = args.baseFile ? fs.readFileSync(args.baseFile, 'utf8') : null;
  } else {
    if (!args.links) throw new Error('--links needs a value');
    headText = args.head ? gitShow(args.head, args.links) : fs.readFileSync(args.links, 'utf8');
    if (headText === null) throw new Error('cannot read ' + args.links + ' at ' + args.head);
    baseText = args.base && !ZERO.test(args.base) ? gitShow(args.base, args.links) : null;
  }
  const headData = JSON.parse(headText);
  if (args.set === 'fihrist' ? !isFihrist(headData) : !Array.isArray(headData.categories)) throw new Error('the links file is not a ' + args.set + ' file');
  let baseData = null;
  if (baseText !== null) {
    try {
      baseData = JSON.parse(baseText);
    } catch {
      baseData = null;
    }
    if (baseData && (args.set === 'fihrist' ? !isFihrist(baseData) : !Array.isArray(baseData.categories))) baseData = null;
  }
  process.stdout.write(JSON.stringify(diffLinks(baseData, headData, args.set)) + '\n');
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error(errText(e));
    process.exit(1);
  }
}
