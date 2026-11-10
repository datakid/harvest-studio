import { state, client, history, emit } from '../store.js';
import { t } from '../i18n.js';
import { cleanAdjust, adjustSignature, SCALE_MIN, SCALE_MAX, OFFSET_MAX } from '../../core/adjust.js';
import { toast } from '../ui/toast.js';
import { decodeRecord, defaultScale } from '../model.js';
import { scheduleSave } from './project.js';

let session = { keys: [], before: new Map(), pending: null, timer: 0 };
let chain = Promise.resolve();

export const shapeOf = (a) => {
  const next = { ...cleanAdjust(a) };
  delete next.exclude;
  return adjustSignature(next);
};

export const applyAdjustNow = (key, next) => {
  const run = async () => {
    const rec = state.records.get(key);
    if (!rec || !rec.hasImage) return;
    const clean = cleanAdjust(next);
    if (shapeOf(clean) !== shapeOf(rec.adjust)) {
      const payload = await client.call('adjust', { key, adjust: clean, target: state.target });
      const fresh = decodeRecord(payload, { name: rec.name });
      rec.raw = fresh.raw;
      rec.faviconUrl = fresh.faviconUrl;
      rec.mask = fresh.mask;
      rec.trace = fresh.trace;
      rec.hash = fresh.hash;
    }
    rec.adjust = Object.keys(clean).length ? clean : null;
    state.dirty = true;
    scheduleSave();
  };
  chain = chain.then(run, run);
  return chain;
};

export const afterAdjust = () => emit('adjusted');

const same = (keys) => keys.length === session.keys.length && keys.every((k, i) => k === session.keys[i]);

const begin = (keys) => {
  if (same(keys)) return;
  session = { keys: [...keys], before: new Map(keys.map((k) => [k, { ...((state.records.get(k) || {}).adjust || {}) }])), pending: null, timer: 0 };
};

export const flushLive = async () => {
  clearTimeout(session.timer);
  const fn = session.pending;
  session.pending = null;
  if (!fn) return;
  try {
    for (const key of session.keys) await applyAdjustNow(key, fn(session.before.get(key) || {}, key));
    afterAdjust();
  } catch (e) {
    toast(t('adjustError', { why: e.message || String(e) }));
  }
};

export const adjustLive = (keys, fn) => {
  begin(keys);
  session.pending = fn;
  clearTimeout(session.timer);
  session.timer = setTimeout(flushLive, 60);
};

export const adjustCommit = async (keys, fn) => {
  begin(keys);
  session.pending = fn;
  await flushLive();
  const { before } = session;
  const list = session.keys;
  const after = new Map(list.map((k) => [k, { ...((state.records.get(k) || {}).adjust || {}) }]));
  session = { keys: [], before: new Map(), pending: null, timer: 0 };
  if (list.some((k) => adjustSignature(before.get(k)) !== adjustSignature(after.get(k)))) {
    const apply = (map) => async () => {
      for (const k of list) await applyAdjustNow(k, map.get(k));
      afterAdjust();
      emit('adjust-panel');
    };
    history.push({ label: 'adjust', undo: apply(before), redo: apply(after) });
  }
  afterAdjust();
  emit('adjust-panel');
  emit('history');
};

export const runHistory = async (which) => {
  if (state.stage !== 'work') return;
  const done = await history[which]();
  if (done) {
    afterAdjust();
    emit('adjust-panel');
    emit('colour-state');
    emit('selection');
    emit('history');
  }
};

export const scaleKeys = (keys, factor) =>
  adjustCommit(keys, (a) => {
    const cur = a.scale === undefined ? defaultScale(state.target) : a.scale;
    return cleanAdjust({ ...a, scale: Math.min(SCALE_MAX, Math.max(SCALE_MIN, cur * factor)) });
  });

export const nudgeKeys = (keys, dx, dy) =>
  adjustCommit(keys, (a) => {
    const cur = a.offset || { x: 0, y: 0 };
    const clamp = (v) => Math.min(OFFSET_MAX, Math.max(-OFFSET_MAX, v));
    return cleanAdjust({ ...a, offset: { x: clamp(cur.x + dx), y: clamp(cur.y + dy) } });
  });
