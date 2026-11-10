import { state, history, emit } from '../store.js';
import { t } from '../i18n.js';
import { announce } from '../ui/toast.js';
import { scheduleSave } from './project.js';

const read = (key) => {
  const rec = state.records.get(key);
  const item = state.items.get(key) || {};
  return { name: rec ? rec.name : '', url: item.url || '', groupId: rec ? rec.groupId || '' : '' };
};

const write = (key, v) => {
  const rec = state.records.get(key);
  if (!rec) return;
  rec.name = v.name;
  rec.groupId = v.groupId || null;
  const item = state.items.get(key);
  if (item) {
    item.name = v.name;
    item.url = v.url || undefined;
  }
  state.dirty = true;
  scheduleSave();
  emit('cell', rec);
  emit('view');
  emit('inspector');
};

export const editMeta = (key, patch) => {
  const before = read(key);
  const after = { ...before, ...patch };
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  write(key, after);
  history.push({ label: 'meta', undo: () => write(key, before), redo: () => write(key, after) });
  if (before.name !== after.name) announce(t('nameSaved'));
  emit('history');
};
