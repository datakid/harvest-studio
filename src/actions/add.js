import { state, prefs, client, proxySettings, emit } from '../store.js';
import { t, getLang } from '../i18n.js';
import { isJsonFile, isImageFile, readJsonFile, buildTargets, pendingCount, parseUrls } from '../inputs.js';
import { classify, keepBoth, notPresent } from '../add.js';
import { announce, toast } from '../ui/toast.js';
import { askCollisions } from '../ui/dialogs.js';
import { decodeRecord, existingUrls, ghostFor } from '../model.js';
import { applyColours } from './colour.js';
import { scheduleSave } from './project.js';
import { fihristSet, launcherSet } from './harvest.js';

export const runAdd = async (targets, updating) => {
  state.adding += 1;
  emit('adding');
  const names = new Map(targets.map((x) => [x.key, x.name || x.key]));
  try {
    await client.call('configure', { wasmBase: '/wasm/', settings: await proxySettings() });
    const result = await client.call('add', { targets, target: state.target, seed: state.seed, mode: prefs.mode, cell: state.cell || undefined, faFallback: prefs.faFallback, pins: state.pins }, {
      onProgress: (p) => {
        if (p.phase !== 'tile') return;
        const rec = state.records.get(p.key);
        if (!rec || !rec.ghost) return;
        rec.faviconUrl = URL.createObjectURL(new Blob([p.favicon], { type: 'image/png' }));
        rec.hasImage = true;
        emit('cell', rec);
        emit('pairs');
      }
    });
    const before = new Map(updating.map((x) => [x.key, state.records.get(x.key)]));
    const added = [];
    for (const item of result.items) {
      const prev = state.items.get(item.key) || {};
      state.items.set(item.key, { ...prev, ...item, name: names.get(item.key) || prev.name || item.key });
    }
    for (const payload of result.records) {
      const name = names.get(payload.key) || payload.key;
      const fresh = decodeRecord(payload, { name });
      fresh.name = name;
      const old = before.get(payload.key);
      if (old && old.locked && old.tint) {
        fresh.locked = true;
        fresh.tint = old.tint;
      }
      state.records.set(payload.key, fresh);
      added.push(payload.key);
    }
    for (const t of targets) if (!state.records.get(t.key) || state.records.get(t.key).ghost) state.records.set(t.key, { ...ghostFor(t), ghost: false, status: 'notfound' });
    applyColours(new Set(added.filter((k) => !(before.get(k) && before.get(k).locked))));
    for (const k of targets.map((x) => x.key)) {
      const rec = state.records.get(k);
      if (rec) emit('cell', rec);
    }
    state.polish = result.polish ? { ...result.polish, safeArea: Math.min(state.polish ? state.polish.safeArea : 1, result.polish.safeArea), rounded: Math.min(state.polish ? state.polish.rounded : 1, result.polish.rounded) } : state.polish;
    state.dirty = true;
    emit('pairs');
    emit('count');
    scheduleSave();
    const found = added.filter((k) => state.records.get(k) && state.records.get(k).hasImage);
    announce(found.length === 1 ? t('addedTile', { name: state.records.get(found[0]).name }) : t('addedBatch', { n: found.length }));
    const unreached = result.items.filter((i) => i.error && /needs the fetch proxy/.test(i.error)).length;
    if (unreached) toast(t('proxyMissingSome', { n: unreached }));
    if (state.selected && state.stage === 'work') emit('inspector');
  } catch (e) {
    for (const t of targets) {
      const rec = state.records.get(t.key);
      if (rec && rec.ghost) {
        state.records.delete(t.key);
        state.order = state.order.filter((k) => k !== t.key);
        emit('drop', t.key);
      }
    }
    toast(t('addError', { why: e.message || String(e) }));
  } finally {
    state.adding -= 1;
    emit('adding');
  }
};

export const addTargets = async (incoming) => {
  if (!incoming.length) {
    toast(t('addNothing'));
    return;
  }
  const existing = existingUrls();
  const { fresh, same, renamed } = classify(incoming, existing);
  let targets = fresh;
  let updating = [];
  if (same.length) {
    const choice = await askCollisions(same);
    if (choice === 'update') {
      updating = same;
      targets = [...fresh, ...same];
    } else if (choice === 'both') targets = [...fresh, ...keepBoth(same, new Map([...existing, ...fresh.map((x) => [x.key, x.url || null])]))];
  }
  if (!targets.length) return;
  for (const r of renamed) toast(t('renamedNote', { from: r.from, to: r.to }));
  const updatingKeys = new Set(updating.map((x) => x.key));
  for (const x of targets) {
    if (updatingKeys.has(x.key)) continue;
    state.records.set(x.key, ghostFor(x));
    state.items.set(x.key, { key: x.key, name: x.name || x.key, url: x.url || null, status: 'pending', flags: [], attempts: [] });
  }
  state.order = [...state.records.keys()].sort();
  for (const x of targets) {
    if (!updatingKeys.has(x.key)) emit('cell', state.records.get(x.key));
  }
  state.chain = state.chain.then(() => runAdd(targets, updating));
  await state.chain;
};

export const addFromFiles = async (files) => {
  const pending = { urlText: '', files: [], jsons: [], bundle: { manifest: null, files: new Map() } };
  for (const f of files) {
    if (isJsonFile(f)) {
      try {
        const j = await readJsonFile(f, getLang());
        if (j.scan && j.scan.count > 0) pending.jsons.push(j);
        else toast(t('badJson') + ' ' + f.name);
      } catch {
        toast(t('badJson') + ' ' + f.name);
      }
    } else if (isImageFile(f)) pending.files.push(f);
  }
  if (!pendingCount(pending)) return;
  await addTargets(await buildTargets(pending));
};

export const addFromUrls = async (text) => {
  if (!parseUrls(text).length) return false;
  await addTargets(await buildTargets({ urlText: text, files: [], jsons: [], bundle: { manifest: null, files: new Map() } }));
  return true;
};

export const addSets = async (which) => {
  const sets = [];
  if ((which === 'launcher' || which === 'both') && state.catalogue) sets.push(launcherSet());
  if ((which === 'fihrist' || which === 'both') && state.fihrist) sets.push(fihristSet());
  const all = await buildTargets({ urlText: '', files: [], jsons: sets, bundle: { manifest: null, files: new Map() } });
  const fresh = notPresent(all, existingUrls());
  if (!fresh.length) {
    toast(t('addNothing'));
    return;
  }
  await addTargets(fresh);
};

export const setCount = (which) => {
  const sets = [];
  if ((which === 'launcher' || which === 'both') && state.catalogue) sets.push(launcherSet());
  if ((which === 'fihrist' || which === 'both') && state.fihrist) sets.push(fihristSet());
  const keys = new Set(sets.flatMap((x) => x.scan.targets.map((y) => y.key)));
  return [...keys].filter((k) => !state.records.has(k)).length;
};
