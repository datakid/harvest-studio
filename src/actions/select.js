import { state, emit } from '../store.js';
import { visibleKeys } from '../model.js';

const set = (keys, primary) => {
  state.sel = new Set(keys.filter((k) => state.records.has(k)));
  state.selected = primary && state.sel.has(primary) ? primary : [...state.sel][state.sel.size - 1] || null;
  if (primary && state.sel.has(primary)) state.anchor = primary;
  if (!state.sel.size) state.anchor = null;
  emit('selection');
};

export const selectOnly = (key) => set([key], key);

export const toggleSelect = (key) => {
  const next = new Set(state.sel);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  set([...next], next.has(key) ? key : null);
};

export const selectRange = (key) => {
  const order = visibleKeys();
  const a = order.indexOf(state.anchor);
  const b = order.indexOf(key);
  if (a < 0 || b < 0) {
    selectOnly(key);
    return;
  }
  const [lo, hi] = a < b ? [a, b] : [b, a];
  const anchor = state.anchor;
  set(order.slice(lo, hi + 1), key);
  state.anchor = anchor;
};

export const selectMany = (keys) => set(keys, keys[keys.length - 1]);

export const selectAll = () => set(visibleKeys(), state.selected);

export const clearSelection = () => set([], null);

export const dropFromSelection = (keys) => {
  const gone = new Set(keys);
  set([...state.sel].filter((k) => !gone.has(k)), null);
};
