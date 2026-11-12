import { state, ui, on } from '../store.js';
import { h, icon, kids } from '../dom.js';
import { t } from '../i18n.js';
import { tile, paint } from '../ui/tile.js';
import { selectedRecs, statusKey } from '../model.js';
import { retryLive } from '../actions/records.js';
import { clearSelection } from '../actions/select.js';
import { lookPanel, adjustSection, previews } from './look.js';
import { sourcePanel } from './source.js';
import { appPanel } from './app-tab.js';

const TABS = [
  ['look', 'tabLook', lookPanel],
  ['source', 'tabSource', sourcePanel],
  ['app', 'tabApp', appPanel]
];

const warnings = (rec) => {
  const item = state.items.get(rec.key) || {};
  const flags = item.flags || [];
  const out = [];
  if (rec.contrast === 'flagged') out.push(h('div', { class: 'warn-row bad', 'data-flag': 'contrast' }, icon('warn', { size: 16 }), h('span', null, t('warnContrast'))));
  if (rec.contrast === 'nudged' && Array.isArray(rec.sourceTint) && Array.isArray(rec.tint)) out.push(h('div', { class: 'warn-row', 'data-note': 'contrast', dir: 'ltr' }, icon('info', { size: 16 }), h('span', null, t('contrastAdjusted', { from: rec.sourceTint[0], to: rec.tint[0] }))));
  if (rec.tight) out.push(h('div', { class: 'warn-row', 'data-flag': 'tight' }, icon('warn', { size: 16 }), h('span', null, t('warnTight'))));
  if (flags.includes('low-res')) out.push(h('div', { class: 'warn-row', 'data-flag': 'low-res' }, icon('warn', { size: 16 }), h('span', null, t('lowRes'))));
  if (flags.includes('stale-source')) out.push(h('div', { class: 'warn-row', 'data-flag': 'stale-source' }, icon('warn', { size: 16 }), h('span', null, t('staleSource')), h('button', { class: 'btn small', type: 'button', 'data-act': 'retry-live', onClick: () => retryLive(rec) }, t('retryLive'))));
  return out.length ? h('div', { class: 'warns' }, out) : null;
};

const head = (recs) => {
  if (recs.length === 1) {
    const rec = recs[0];
    return h(
      'div',
      { class: 'insp-head' },
      rec.hasImage ? tile(rec, { size: 56 }) : h('span', { class: 'tile-art ghost', style: { '--size': '56px', animation: 'none' } }),
      h('div', { class: 'insp-title' }, h('h2', { dir: 'auto' }, rec.name), h('small', { dir: 'ltr' }, rec.key)),
      h('span', { class: 'pill' + (rec.status === 'found' || rec.status === 'override' ? ' ok' : ' warn') }, t(statusKey(rec.status))),
      h('button', { class: 'btn icon quiet insp-close', type: 'button', 'aria-label': t('selClear'), title: t('selClear'), onClick: clearSelection }, icon('close'))
    );
  }
  return h(
    'div',
    { class: 'insp-head' },
    h('span', { class: 'multi-stack', 'aria-hidden': 'true' }, recs.filter((r) => r.hasImage).slice(0, 3).map((r) => tile(r, { size: 36 }))),
    h('div', { class: 'insp-title' }, h('h2', null, t('selectedN', { n: recs.length }))),
    h('button', { class: 'btn icon quiet insp-close', type: 'button', 'aria-label': t('selClear'), title: t('selClear'), onClick: clearSelection }, icon('close'))
  );
};

const tabBar = (tabs) => {
  const bar = h('div', { class: 'tabs', role: 'tablist', 'aria-label': t('inspector') });
  const buttons = tabs.map(([id, label]) =>
    h('button', {
      class: 'tab',
      type: 'button',
      role: 'tab',
      id: 'tabbtn-' + id,
      'aria-selected': String(ui.tab === id),
      'aria-controls': 'tab-' + id,
      tabindex: ui.tab === id ? 0 : -1,
      onClick: () => {
        ui.tab = id;
        renderInspector();
        document.getElementById('tabbtn-' + id).focus();
      },
      onKeydown: (e) => {
        const rtl = document.documentElement.dir === 'rtl';
        const step = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 }[e.key];
        if (!step) return;
        e.preventDefault();
        const i = tabs.findIndex(([x]) => x === id);
        const next = tabs[(i + step + tabs.length) % tabs.length][0];
        ui.tab = next;
        renderInspector();
        document.getElementById('tabbtn-' + next).focus();
      }
    }, t(label))
  );
  bar.append(...buttons);
  return bar;
};

const build = (el) => {
  const recs = selectedRecs();
  el.dataset.empty = String(recs.length === 0);
  if (!recs.length) {
    el.replaceChildren(...kids(h('div', { class: 'insp-empty' }, icon('grid', { size: 28 }), h('p', null, t('noSelection')))));
    return;
  }
  if (!TABS.some(([id]) => id === ui.tab)) ui.tab = 'look';
  const tabs = TABS.map(([id, label]) => [id, label]);
  const render = TABS.find(([id]) => id === ui.tab)[2];
  el.replaceChildren(...kids(head(recs), recs.length === 1 ? warnings(recs[0]) : null, tabBar(tabs), render(recs)));
};

export const renderInspector = () => {
  const el = document.getElementById('inspector');
  if (!el) return;
  const active = document.activeElement && el.contains(document.activeElement) ? document.activeElement.id : null;
  const scroll = el.scrollTop;
  build(el);
  el.scrollTop = scroll;
  if (active) {
    const again = document.getElementById(active);
    if (again) again.focus({ preventScroll: true });
  }
};

export const renderAdjust = () => {
  const old = document.getElementById('adjust-panel');
  if (!old) return;
  const active = document.activeElement && old.contains(document.activeElement) ? document.activeElement.id : null;
  const next = adjustSection(selectedRecs());
  if (next) old.replaceWith(next);
  else old.remove();
  if (active) {
    const again = document.getElementById(active);
    if (again) again.focus({ preventScroll: true });
  }
};

export const refreshInspectorArt = () => {
  const el = document.getElementById('inspector');
  const recs = selectedRecs();
  if (!el || recs.length !== 1 || !recs[0].hasImage) return;
  const rec = recs[0];
  const headTile = el.querySelector('.insp-head > .tile-art');
  if (headTile) paint(headTile, rec, { size: 56 });
  el.querySelectorAll('.look-previews .preview-cell > .tile-art').forEach((a, i) => paint(a, rec, { size: 52, colors: i < 2 ? 'vivid' : 'muted', theme: i % 2 ? 'dark' : 'light', faithful: false }));
};

on('inspector', renderInspector);
on('selection', renderInspector);
on('adjust-panel', renderAdjust);
on('tiles-lite', refreshInspectorArt);
on('tiles', renderInspector);
