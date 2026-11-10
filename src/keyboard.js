import { state, ui, emit } from './store.js';
import { selectedRecs } from './model.js';
import { selectAll, clearSelection } from './actions/select.js';
import { runHistory, scaleKeys, nudgeKeys } from './actions/adjust.js';
import { setLocked } from './actions/colour.js';
import { reharvestMany, removeTiles } from './actions/records.js';
import { openExport } from './views/export-sheet.js';
import { openShortcuts } from './views/shortcuts.js';

const typing = () => {
  const a = document.activeElement;
  if (!a) return false;
  if (a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable) return true;
  return a.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button', 'color'].includes(a.type);
};

const modal = () => !!document.querySelector('dialog[open], .popover');

const focusSearch = () => {
  const s = document.getElementById('search');
  if (s) {
    s.focus();
    s.select();
    return;
  }
  const open = document.getElementById('rail-toggle');
  if (open) {
    open.click();
    const again = document.getElementById('search');
    if (again) again.focus();
  }
};

const handlers = {
  '/': () => focusSearch(),
  '?': () => openShortcuts(),
  e: () => state.records.size && openExport(),
  k: () => {
    const recs = selectedRecs().filter((r) => r.hasImage);
    if (recs.length) setLocked(recs.map((r) => r.key), !recs.every((r) => r.locked));
  },
  r: () => state.sel.size && reharvestMany([...state.sel]),
  Delete: () => state.sel.size && removeTiles([...state.sel]),
  Backspace: () => state.sel.size && removeTiles([...state.sel]),
  '[': () => state.sel.size && scaleKeys([...state.sel], 0.95),
  ']': () => state.sel.size && scaleKeys([...state.sel], 1.05)
};

export const installKeyboard = () => {
  addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    const meta = e.metaKey || e.ctrlKey;
    if (meta && !e.altKey && e.key.toLowerCase() === 'z') {
      if (typing()) return;
      e.preventDefault();
      runHistory(e.shiftKey ? 'redo' : 'undo');
      return;
    }
    if (state.stage !== 'work' || typing() || modal()) return;
    if (meta && !e.altKey && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      selectAll();
      return;
    }
    if (meta) return;
    if (e.key === 'Escape') {
      if (state.sel.size) clearSelection();
      else if (ui.railOpen) emit('rail-toggle');
      return;
    }
    if (e.altKey && e.key.startsWith('Arrow') && state.sel.size) {
      e.preventDefault();
      const step = e.shiftKey ? 0.05 : 0.01;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      nudgeKeys([...state.sel], dx, dy);
      return;
    }
    if (e.altKey) return;
    const fn = handlers[e.key.length === 1 && e.key !== '?' && e.key !== '/' && e.key !== '[' && e.key !== ']' ? e.key.toLowerCase() : e.key];
    if (fn) {
      e.preventDefault();
      fn();
    }
  });
};
