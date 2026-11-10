import { state, prefs, save, ui, on, emit } from '../store.js';
import { h, icon, kids } from '../dom.js';
import { t } from '../i18n.js';
import { groupsList, smartCounts, similarNow } from '../model.js';
import { openPolish } from './polish.js';

const SMART_KEYS = [['review', 'smartReview'], ['locked', 'smartLocked'], ['adjusted', 'smartAdjusted'], ['imageOnly', 'smartImageOnly'], ['excluded', 'smartExcluded']];
const SORTS = [['name', 'sortName'], ['group', 'sortGroup'], ['hue', 'sortHue'], ['status', 'sortStatus']];

const prettyGroup = (id) => id.replace(/[-_]+/g, ' ');

const row = (label, count, pressed, onPick, extra = {}) =>
  h('button', { class: 'rail-row', type: 'button', 'aria-pressed': String(pressed), onClick: onPick, ...extra }, h('span', { class: 'rail-label', dir: 'auto' }, label), h('span', { class: 'rail-count' }, String(count)));

export const renderRail = () => {
  const collapsed = prefs.railCollapsed;
  const el = h('aside', { class: 'rail', id: 'rail', 'aria-label': t('filtersTitle'), 'data-collapsed': String(collapsed) });
  fillRail(el);
  return el;
};

const fillRail = (el) => {
  const collapsed = prefs.railCollapsed;
  el.dataset.collapsed = String(collapsed);
  el.replaceChildren();
  const toggle = h('button', { class: 'btn icon quiet rail-collapse', id: 'rail-toggle', type: 'button', 'aria-label': collapsed ? t('railShow') : t('railHide'), title: collapsed ? t('railShow') : t('railHide'), onClick: () => { prefs.railCollapsed = !prefs.railCollapsed; save(); fillRail(el); } }, icon('sidebar'));
  if (collapsed) {
    el.append(...kids(toggle, h('button', { class: 'btn icon quiet', type: 'button', 'aria-label': t('search'), title: t('search'), onClick: () => { prefs.railCollapsed = false; save(); fillRail(el); document.getElementById('search').focus(); } }, icon('search'))));
    return;
  }
  const search = h('input', { id: 'search', type: 'search', placeholder: t('searchPlaceholder'), 'aria-label': t('search'), value: state.view.q, autocomplete: 'off', spellcheck: false, onInput: (e) => { state.view.q = e.target.value; emit('view'); } });
  const groups = groupsList();
  const smart = smartCounts();
  const pairs = similarNow().length;
  el.append(...kids(
    h('div', { class: 'rail-head' }, search, toggle),
    groups.length
      ? h('section', { class: 'rail-section' }, h('h2', null, t('groupsTitle')), row(t('groupAll'), state.records.size, state.view.group === 'all', () => { state.view.group = 'all'; emit('view'); }, { 'data-group': 'all' }), groups.map(([g, n]) => row(prettyGroup(g), n, state.view.group === g, () => { state.view.group = state.view.group === g ? 'all' : g; emit('view'); }, { 'data-group': g })))
      : null,
    h(
      'section',
      { class: 'rail-section' },
      h('h2', null, t('filtersTitle')),
      SMART_KEYS.map(([k, label]) => row(t(label), smart[k], state.view.smart === k, () => { state.view.smart = state.view.smart === k ? null : k; emit('view'); }, { 'data-smart': k, disabled: !smart[k] && state.view.smart !== k })),
      h('button', { class: 'rail-row', id: 'pairs', type: 'button', 'data-pairs': String(pairs), onClick: openPolish }, h('span', { class: 'rail-label' }, icon(pairs ? 'warn' : 'check', { size: 16 }), t('similarPairs', { n: pairs })))
    ),
    h('section', { class: 'rail-section' }, h('h2', null, t('sortLabel')), h('select', { id: 'sort', 'aria-label': t('sortLabel'), onChange: (e) => { state.view.sort = e.target.value; emit('view'); } }, SORTS.map(([k, label]) => h('option', { value: k, selected: k === state.view.sort }, t(label)))))
  ));
};

export const refreshRail = () => {
  const el = document.getElementById('rail');
  if (!el) return;
  const hadFocus = document.activeElement && document.activeElement.id === 'search';
  const pos = hadFocus ? document.activeElement.selectionStart : 0;
  fillRail(el);
  if (hadFocus) {
    const s = document.getElementById('search');
    s.focus();
    s.setSelectionRange(pos, pos);
  }
};

on('view', refreshRail);
on('count', refreshRail);
on('adjusted', refreshRail);
on('colour-state', refreshRail);
on('rail-toggle', () => {
  ui.railOpen = !ui.railOpen;
  document.body.dataset.railOpen = String(ui.railOpen);
});
on('pairs', refreshRail);
