import { state, prefs, client, save, proxySettings, emit } from '../store.js';
import { t, getLang } from '../i18n.js';
import { scanJson } from '../../core/sources.js';
import { mergeTargets, findDuplicates, dropDuplicates } from '../../core/targets.js';
import { isJsonFile, isImageFile, readJsonFile, buildTargets, pendingCount } from '../inputs.js';
import { DEFAULT_SEED } from '../../core/tints.js';
import { toast } from '../ui/toast.js';
import { askDuplicates } from '../ui/dialogs.js';
import { adopt, enterWork } from './project.js';

export const BUNDLE_RE = /^(atlas|glyph-atlas|glyphs)\.[0-9a-f]{8}\.(webp|svg)$/;
export const looksLikeManifest = (data) => !!(data && data.version === 2 && data.icons && typeof data.icons === 'object' && data.atlas);
export const baseOf = (file) => String(file || '').split('/').pop();

export const openManifest = async () => {
  const b = state.pending.bundle;
  state.error = null;
  state.errorProxy = false;
  state.stage = 'busy';
  state.busyKeys = null;
  state.ghosts = Object.keys(b.manifest.data.icons).length;
  state.progress = { done: 0, total: 1, phase: 'fetch' };
  emit('main');
  try {
    const files = {};
    for (const [name, f] of b.files) files[name] = new Uint8Array(await f.arrayBuffer());
    await client.call('configure', { wasmBase: '/wasm/', settings: await proxySettings() });
    const result = await client.call('importManifest', { manifest: b.manifest.data, files });
    state.seed = result.seed || DEFAULT_SEED;
    state.cell = result.cell;
    state.target = result.v4 ? 'v4' : 'v3';
    prefs.mode = 'follow';
    save();
    adopt(result, (k) => k);
    enterWork();
  } catch (e) {
    state.stage = 'intake';
    state.error = t('manifestError', { why: e.message || String(e) });
    emit('main');
  }
};

export const addFiles = async (files) => {
  state.error = null;
  state.errorProxy = false;
  for (const f of files) {
    if (BUNDLE_RE.test(f.name)) state.pending.bundle.files.set(f.name, f);
    else if (isJsonFile(f)) {
      try {
        const j = await readJsonFile(f, getLang());
        if (looksLikeManifest(j.data)) state.pending.bundle.manifest = j;
        else state.pending.jsons.push(j);
      } catch {
        state.error = t('badJson') + ' ' + f.name;
      }
    } else if (isImageFile(f)) state.pending.files.push(f);
  }
  emit('main');
};

export const startHarvest = async () => {
  state.pending.urlText = (document.getElementById('urls') || { value: state.pending.urlText }).value;
  const count = pendingCount(state.pending);
  if (!count) {
    state.error = t('noInput');
    emit('main');
    return;
  }
  state.error = null;
  state.errorProxy = false;
  let targets = await buildTargets(state.pending);
  const duplicates = findDuplicates(targets);
  if (duplicates.length) {
    const choice = await askDuplicates(duplicates, targets.length);
    if (choice === 'cancel') {
      emit('main');
      return;
    }
    if (choice === 'once') targets = dropDuplicates(targets);
  }
  state.names = new Map(targets.map((x) => [x.key, x.name || x.key]));
  state.terms = new Map(targets.map((x) => [x.key, x.terms || []]));
  state.stage = 'busy';
  state.ghosts = targets.length;
  state.busyKeys = targets.map((x) => x.key);
  state.progress = { done: 0, total: targets.length, phase: 'fetch' };
  emit('main');
  try {
    await client.call('configure', { wasmBase: '/wasm/', settings: await proxySettings() });
    state.seed = state.seed || DEFAULT_SEED;
    state.target = prefs.target === 'v4' ? 'v4' : 'v3';
    const result = await client.call('harvest', { targets, target: state.target, seed: state.seed, mode: prefs.mode, cell: state.cell || undefined, faFallback: prefs.faFallback, pins: state.pins }, {
      onProgress: (p) => {
        if (p.phase === 'tile') {
          emit('stream', p);
          return;
        }
        state.progress = p;
        emit('progress');
      }
    });
    if (!result.records.some((r) => r.favicon)) {
      const why = (result.items.find((i) => i.error) || {}).error || t('statusNotfound');
      state.stage = 'intake';
      state.error = t('harvestError', { why });
      state.errorProxy = /proxy|token|fetch/i.test(why);
      emit('main');
      return;
    }
    const names = new Map(targets.map((x) => [x.key, x]));
    state.cell = null;
    state.polish = result.polish || null;
    adopt(result, (k) => (names.get(k) || {}).name || k);
    enterWork(prefs.mode === 'separate');
    const unreached = result.items.filter((i) => i.error && /needs the fetch proxy/.test(i.error)).length;
    if (unreached) toast(t('proxyMissingSome', { n: unreached }));
  } catch (e) {
    state.stage = 'intake';
    const why = e.message || String(e);
    state.error = /no proxy|needs the fetch proxy/i.test(why) ? t('proxyError') : t('harvestError', { why });
    state.errorProxy = /proxy|token|fetch/i.test(why);
    emit('main');
  }
};

export const launcherSet = () => {
  const c = state.catalogue;
  const scan = scanJson(c.data, {}, getLang());
  scan.targets = mergeTargets(scan.targets, c.extras);
  scan.count = scan.targets.length;
  return { name: 'catalogue.json', data: c.data, scan };
};

export const fihristSet = () => ({ name: 'fihrist.json', data: state.fihrist.data, scan: scanJson(state.fihrist.data, {}, getLang()) });

export const harvestSets = (which) => {
  const sets = [];
  if ((which === 'launcher' || which === 'both') && state.catalogue) sets.push(launcherSet());
  if ((which === 'fihrist' || which === 'both') && state.fihrist) sets.push(fihristSet());
  if (!sets.length) return;
  state.pending.jsons = sets;
  startHarvest();
};
