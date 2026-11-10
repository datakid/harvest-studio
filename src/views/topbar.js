import { state, prefs, save, history, on, emit } from '../store.js';
import { h, icon } from '../dom.js';
import { t } from '../i18n.js';
import { stats, exportable } from '../model.js';
import { menu } from '../ui/menu.js';
import { runHistory } from '../actions/adjust.js';
import { scheduleSave, startOver } from '../actions/project.js';
import { downloadReport } from '../actions/export.js';
import { addInputs, openAdd } from './add-popover.js';
import { openExport } from './export-sheet.js';
import { openSettings } from './settings-sheet.js';
import { openShortcuts } from './shortcuts.js';

const statusText = () => {
  const s = stats();
  return t('iconsN', { n: s.n }) + (s.review ? ' · ' + t('reviewN', { n: s.review }) : '');
};

export const refreshTopbar = () => {
  const pill = document.getElementById('status-pill');
  if (pill) {
    pill.textContent = statusText();
    pill.setAttribute('aria-pressed', String(state.view.smart === 'review'));
    pill.classList.toggle('warn', stats().review > 0);
  }
  const ex = document.getElementById('export-btn');
  if (ex) ex.lastChild.textContent = t('export') + ' · ' + exportable().length;
  for (const [id, ok] of [['undo-btn', history.canUndo()], ['redo-btn', history.canRedo()]]) {
    const b = document.getElementById(id);
    if (b) b.disabled = !ok;
  }
  const bar = document.querySelector('.topbar');
  if (bar) bar.dataset.busy = String(state.adding > 0);
};

export const renderTopbar = () => {
  const more = h('button', { class: 'btn icon quiet', id: 'more-btn', type: 'button', 'aria-label': t('more'), title: t('more'), 'aria-haspopup': 'menu', onClick: (e) => menu(e.currentTarget, [{ id: 'start-over', icon: 'reset', label: t('startOver'), run: startOver }, { icon: 'report', label: t('report'), run: () => downloadReport() }, 'sep', { icon: 'settings', label: t('settings'), run: openSettings }, { icon: 'keyboard', label: t('shortcutsTitle'), run: openShortcuts }], { label: t('more') }) }, icon('more'));
  const bar = h(
    'header',
    { class: 'topbar' },
    h('button', { class: 'btn icon quiet rail-open', type: 'button', 'aria-label': t('filtersTitle'), title: t('filtersTitle'), onClick: () => emit('rail-toggle') }, icon('filter')),
    h('input', { class: 'proj-name', type: 'text', value: state.projectName, dir: 'auto', 'aria-label': t('projectName'), spellcheck: false, onInput: (e) => { state.projectName = e.target.value; scheduleSave(); } }),
    h('button', { class: 'pill', id: 'status-pill', type: 'button', onClick: () => { state.view.smart = state.view.smart === 'review' ? null : 'review'; emit('view'); } }, statusText()),
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn pill', id: 'add-btn', type: 'button', 'aria-label': t('add'), 'aria-haspopup': 'dialog', onClick: (e) => openAdd(e.currentTarget) }, icon('plus', { size: 18 }), h('span', { class: 'lbl' }, t('add'))),
    h('button', { class: 'btn icon quiet', id: 'undo-btn', type: 'button', 'data-act': 'undo', disabled: !history.canUndo(), 'aria-label': t('undo'), title: t('undo') + ' (Ctrl+Z)', onClick: () => runHistory('undo') }, icon('undo')),
    h('button', { class: 'btn icon quiet', id: 'redo-btn', type: 'button', 'data-act': 'redo', disabled: !history.canRedo(), 'aria-label': t('redo'), title: t('redo') + ' (Ctrl+Shift+Z)', onClick: () => runHistory('redo') }, icon('redo')),
    h('button', { class: 'btn primary pill', id: 'export-btn', type: 'button', onClick: openExport }, icon('download', { size: 18 }), t('export') + ' · ' + exportable().length),
    more,
    ...addInputs(),
    h('div', { class: 'progress topbar-progress', 'aria-hidden': 'true' }, h('i'))
  );
  return bar;
};

on('count', refreshTopbar);
on('history', refreshTopbar);
on('adding', refreshTopbar);
on('view', refreshTopbar);
