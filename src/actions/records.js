import { state, prefs, client, history, proxySettings, emit } from '../store.js';
import { dropFromSelection, selectMany, selectOnly } from './select.js';
import { t } from '../i18n.js';
import { announce, toast } from '../ui/toast.js';
import { decodeRecord, pinnedHref, recordPayload } from '../model.js';
import { applyColours } from './colour.js';
import { scheduleSave } from './project.js';

const detach = async (entries) => {
  const gone = new Set(entries.map((e) => e.rec.key));
  const first = state.order.indexOf(entries[0].rec.key);
  for (const e of entries) {
    state.records.delete(e.rec.key);
    state.items.delete(e.rec.key);
    emit('drop', e.rec.key);
  }
  state.order = state.order.filter((k) => !gone.has(k));
  const next = state.order[Math.min(first, state.order.length - 1)] || null;
  dropFromSelection([...gone]);
  if (!state.sel.size && next) selectOnly(next);
  for (const e of entries) await client.call('remove', { key: e.rec.key });
  state.dirty = true;
  emit('pairs');
  emit('count');
  emit('inspector');
  scheduleSave();
};

const attach = async (entries) => {
  for (const e of entries) {
    state.records.set(e.rec.key, e.rec);
    if (e.item) state.items.set(e.rec.key, e.item);
  }
  state.order = [...state.records.keys()].sort();
  for (const e of entries) {
    await client.call('put', { record: e.payload });
    emit('cell', e.rec);
  }
  state.dirty = true;
  selectMany(entries.map((e) => e.rec.key));
  emit('pairs');
  emit('count');
  scheduleSave();
};

export const removeTiles = async (keys) => {
  const entries = keys.map((k) => state.records.get(k)).filter(Boolean).map((rec) => ({ payload: recordPayload(rec), item: state.items.get(rec.key), name: rec.name, rec }));
  if (!entries.length) return;
  await detach(entries);
  history.push({ label: 'remove', undo: () => attach(entries), redo: () => detach(entries) });
  emit('history');
  const label = entries.length === 1 ? t('removedTile', { name: entries[0].name }) : t('removedN', { n: entries.length });
  announce(label);
  toast(label, { label: t('undo'), ms: 8000, onAction: () => history.undo().then(() => emit('history')) });
};

export const removeTile = (rec) => removeTiles([rec.key]);

export const copyPin = async (rec) => {
  await navigator.clipboard.writeText(JSON.stringify({ [rec.key]: { href: pinnedHref(rec) } }, null, 2));
  announce(t('copied'));
};

export const pinAttempt = async (rec, a) => {
  state.pins = { ...state.pins, [rec.key]: { href: a.href } };
  await reharvest(rec, 'pinDone');
};

export const unpin = async (rec) => {
  const next = { ...state.pins };
  delete next[rec.key];
  state.pins = next;
  await reharvest(rec, 'unpinDone');
};

export const retryLive = (rec) => reharvest(rec, 'retryDone');

export const reharvest = async (rec, doneKey) => {
  const item = state.items.get(rec.key) || {};
  if (!item.url) return;
  try {
    await client.call('configure', { wasmBase: '/wasm/', settings: await proxySettings() });
    const result = await client.call('harvest', { reset: false, fresh: true, targets: [{ key: rec.key, appId: rec.appId, url: item.url, name: rec.name }], target: state.target, seed: state.seed, cell: state.cell || undefined, faFallback: prefs.faFallback, pins: state.pins });
    const next = result.items[0];
    const payload = result.records.find((r) => r.key === rec.key);
    if (!payload || !next || (next.flags || []).includes('stale-source')) {
      toast(t('retryStale'));
      return;
    }
    const fresh = decodeRecord(payload, { name: rec.name });
    fresh.name = rec.name;
    state.records.set(rec.key, fresh);
    state.items.set(rec.key, { ...item, ...next, flags: next.flags || [], name: rec.name });
    state.dirty = true;
    applyColours();
    emit('tiles-lite');
    emit('cell', state.records.get(rec.key));
    emit('count');
    emit('inspector');
    announce(t('updated'));
  } catch (e) {
    toast(t('retryError', { why: e.message || String(e) }));
  }
};

export const replaceImage = async (rec, file) => {
  if (!file) return;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const payload = await client.call('replace', { target: state.target, key: rec.key, appId: rec.appId, bytes, fileName: file.name });
    const fresh = decodeRecord(payload, { name: rec.name });
    fresh.name = rec.name;
    state.records.set(rec.key, fresh);
    state.items.set(rec.key, { ...(state.items.get(rec.key) || {}), source: { type: 'file', href: file.name }, error: null, attempts: [], name: rec.name });
    state.dirty = true;
    applyColours();
    emit('tiles-lite');
    emit('cell', state.records.get(rec.key));
    emit('count');
    emit('inspector');
    announce(t('updated'));
  } catch (e) {
    toast(t('replaceError', { why: e.message }));
  }
};

export const reharvestMany = async (keys) => {
  for (const k of keys) {
    const rec = state.records.get(k);
    if (rec) await reharvest(rec, 'retryDone');
  }
};
