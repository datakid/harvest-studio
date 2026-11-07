import { state, prefs, save, history, emit } from '../store.js';
import { h, icon } from '../dom.js';
import { t } from '../i18n.js';
import { seg } from '../ui/seg.js';
import { exportable, similarNow, stats } from '../model.js';
import { scheduleSave, startOver } from '../actions/project.js';
import { runHistory } from '../actions/adjust.js';
import { downloadReport } from '../actions/export.js';
import { cellEl, gridKeys } from './canvas.js';
import { openPolish } from './polish.js';
import { addBar } from './addbar.js';
import { openExport } from './export-sheet.js';

export const renderToolbar = () => {
  const s = stats();
  return h(
    'div',
    { class: 'toolbar' },
    h('input', { class: 'proj-name', type: 'text', value: state.projectName, 'aria-label': t('projectName'), spellcheck: false, onInput: (e) => { state.projectName = e.target.value; scheduleSave(); } }),
    h('div', { class: 'stat' }, t('summary', { n: s.n, g: s.glyphs }), s.review ? h('small', null, t('review', { n: s.review })) : null),
    h('button', { class: 'btn quiet pairs', id: 'pairs', type: 'button', 'data-pairs': String(similarNow().length), onClick: openPolish }, icon(similarNow().length ? 'warn' : 'check', { size: 16 }), t('similarPairs', { n: similarNow().length })),
    h('div', { class: 'spacer pv' }, h('span', null, t('previewColors')), seg(t('previewColors'), [['vivid', t('vivid')], ['muted', t('muted')]], prefs.colors, (v) => { prefs.colors = v; save(); emit('main'); })),
    h('div', { class: 'pv' }, h('span', null, t('previewCorners')), seg(t('previewCorners'), [['balanced', t('balanced')], ['soft', t('soft')], ['crisp', t('crisp')]], prefs.corners, (v) => { prefs.corners = v; applyCorners(); save(); emit('main'); })),
    h('button', { class: 'btn icon quiet', id: 'undo-btn', type: 'button', 'data-act': 'undo', disabled: !history.canUndo(), 'aria-label': t('undo'), title: t('undo'), onClick: () => runHistory('undo') }, icon('reset', { size: 16 })),
    h('button', { class: 'btn icon quiet', id: 'redo-btn', type: 'button', 'data-act': 'redo', disabled: !history.canRedo(), 'aria-label': t('redo'), title: t('redo'), onClick: () => runHistory('redo') }, icon('reset', { size: 16, flip: true })),
    h('button', { class: 'btn quiet', id: 'report-btn', type: 'button', onClick: downloadReport }, icon('download', { size: 16 }), t('report')),
    h('button', { class: 'btn primary', id: 'export-btn', type: 'button', onClick: openExport }, icon('download', { size: 18 }), t('exportCount', { n: exportable().length }))
  );
};

export const applyCorners = () => {
  if (prefs.corners === 'balanced') delete document.documentElement.dataset.corners;
  else document.documentElement.dataset.corners = prefs.corners;
};

export const renderWork = () => {
  const gallery = h('ul', { class: 'gallery', role: 'listbox', 'aria-label': t('galleryLabel'), onKeydown: gridKeys });
  state.order.forEach((k, i) => gallery.append(cellEl(state.records.get(k), i)));
  const work = h(
    'section',
    { class: 'work' },
    h('div', null, addBar(), renderToolbar(), h('div', { class: 'stage' + (state.bloom ? ' bloom' : '') }, gallery), h('div', { class: 'row', style: { 'margin-top': '14px' } }, h('button', { class: 'btn quiet', type: 'button', onClick: startOver }, icon('reset', { size: 16 }), t('startOver')))),
    h('aside', { class: 'inspector', id: 'inspector' })
  );
  if (state.bloom) setTimeout(() => document.querySelectorAll('.stage.bloom').forEach((el) => el.classList.remove('bloom')), 1900);
  state.bloom = false;
  return work;
};
