import { state, prefs, client, proxySettings, emit } from '../store.js';
import { t } from '../i18n.js';
import { announce, toast } from '../ui/toast.js';
import { decodeRecord, pinnedHref, recordPayload } from '../model.js';
import { applyColours } from './colour.js';
import { scheduleSave } from './project.js';

export const removeTile = async (rec) => {
  const entry = { payload: recordPayload(rec), item: state.items.get(rec.key), name: rec.name, hadImage: rec.hasImage, rec };
  const index = state.order.indexOf(rec.key);
  state.records.delete(rec.key);
  state.items.delete(rec.key);
  state.order = state.order.filter((k) => k !== rec.key);
  emit('drop', rec.key);
  if (state.selected === rec.key) {
    state.selected = state.order[Math.min(index, state.order.length - 1)] || null;
    document.querySelectorAll('.cell').forEach((c) => c.setAttribute('aria-selected', String(c.dataset.key === state.selected)));
    emit('inspector');
  }
  await client.call('remove', { key: rec.key });
  emit('pairs');
  emit('count');
  scheduleSave();
  announce(t('removedTile', { name: entry.name }));
  toast(t('removedTile', { name: entry.name }), { label: t('undo'), ms: 8000, onAction: () => restoreTile(entry) });
};

export const restoreTile = async (entry) => {
  const rec = entry.rec;
  state.records.set(rec.key, rec);
  if (entry.item) state.items.set(rec.key, entry.item);
  state.order = [...state.records.keys()].sort();
  await client.call('put', { record: entry.payload });
  emit('cell', rec);
  emit('pairs');
  emit('count');
  scheduleSave();
  announce(t('restoredTile', { name: entry.name }));
};

export const copyPin = async (rec) => {
  await navigator.clipboard.writeText(JSON.stringify({ [rec.key]: { href: pinnedHref(rec) } }, null, 2));
  toast(t('copied'));
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
    emit('main');
    toast(t(doneKey));
  } catch (e) {
    toast(t('retryFailed', { why: e.message || String(e) }));
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
    emit('main');
    toast(t('replaced'));
  } catch (e) {
    toast(t('replaceFailed', { why: e.message }));
  }
};
