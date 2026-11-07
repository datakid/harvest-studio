import { state, client, history, emit } from '../store.js';
import { t } from '../i18n.js';
import { cleanAdjust, adjustSignature } from '../../core/adjust.js';
import { toast } from '../ui/toast.js';
import { decodeRecord } from '../model.js';
import { scheduleSave } from './project.js';

export const adjustSession = { key: null, before: null, pending: null, timer: 0 };
export let adjustChain = Promise.resolve();

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
  adjustChain = adjustChain.then(run, run);
  return adjustChain;
};

export const afterAdjust = () => emit('adjusted');

export const flushLive = async () => {
  clearTimeout(adjustSession.timer);
  const next = adjustSession.pending;
  adjustSession.pending = null;
  if (!next || !adjustSession.key) return;
  try {
    await applyAdjustNow(adjustSession.key, next);
    afterAdjust();
  } catch (e) {
    toast(t('retryFailed', { why: e.message || String(e) }));
  }
};

export const beginSession = (key) => {
  if (adjustSession.key === key) return;
  const rec = state.records.get(key);
  adjustSession.key = key;
  adjustSession.before = rec && rec.adjust ? { ...rec.adjust } : {};
};

export const adjustLive = (key, next) => {
  beginSession(key);
  adjustSession.pending = next;
  clearTimeout(adjustSession.timer);
  adjustSession.timer = setTimeout(flushLive, 60);
};

export const adjustCommit = async (key, next) => {
  beginSession(key);
  adjustSession.pending = next;
  await flushLive();
  const before = adjustSession.before || {};
  const rec = state.records.get(key);
  const after = rec && rec.adjust ? { ...rec.adjust } : {};
  adjustSession.key = null;
  adjustSession.before = null;
  if (adjustSignature(before) !== adjustSignature(after)) {
    history.push({
      label: 'adjust',
      undo: async () => {
        await applyAdjustNow(key, before);
        afterAdjust();
        emit('adjust-panel');
      },
      redo: async () => {
        await applyAdjustNow(key, after);
        afterAdjust();
        emit('adjust-panel');
      }
    });
  }
  afterAdjust();
  emit('adjust-panel');
};

export const runHistory = async (which) => {
  if (state.stage !== 'work') return;
  const done = await history[which]();
  if (done) {
    afterAdjust();
    emit('adjust-panel');
  }
};
