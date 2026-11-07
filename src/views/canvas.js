import { state, emit, on } from '../store.js';
import { h, icon } from '../dom.js';
import { t, getLang } from '../i18n.js';
import { tile, trioEl } from '../ui/tile.js';
import { caption, contrastFlag, exportable, failureText, isExcluded, reasonOf, similarNow, stats, statusKey } from '../model.js';

export let renderSeq = 0;

export const cellEl = (rec, i) => {
  const flag = contrastFlag(rec);
  const cap = caption(rec);
  const why = cap ? failureText(rec) : '';
  return h(
    'li',
    { style: { '--i': i } },
    h(
      'button',
      { class: 'cell' + (isExcluded(rec) ? ' excluded' : ''), type: 'button', role: 'option', 'aria-selected': String(state.selected === rec.key), dataset: { key: rec.key, renderId: String(++renderSeq) }, 'aria-label': t('tileAria', { name: rec.name, status: t(statusKey(rec.status)) }), title: why || undefined, onClick: () => select(rec.key) },
      rec.hasImage ? tile(rec) : h('span', { class: 'tile-art ghost', style: rec.ghost ? {} : { animation: 'none' } }),
      h('span', { class: 'name', dir: 'auto' }, rec.name),
      cap ? h('span', { class: 'why' }, cap) : null,
      flag ? h('span', { class: 'flag ' + flag, title: reasonOf(rec) }, icon('warn', { size: 11, stroke: 2.4 })) : null
    )
  );
};

export const select = (key) => {
  state.selected = key;
  document.querySelectorAll('.cell').forEach((c) => c.setAttribute('aria-selected', String(c.dataset.key === key)));
  emit('inspector');
  if (matchMedia('(max-width: 979px)').matches) {
    const el = document.getElementById('inspector');
    if (el) el.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
};

export const gridKeys = (e) => {
  const cells = [...document.querySelectorAll('.cell')];
  const i = cells.indexOf(document.activeElement);
  if (i < 0) return;
  const rtl = getLang() === 'ar';
  const cols = Math.max(1, Math.round(cells[0].parentElement.parentElement.clientWidth / cells[0].clientWidth));
  const move = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
  if (!move) return;
  const next = cells[Math.max(0, Math.min(cells.length - 1, i + move))];
  e.preventDefault();
  next.focus();
  select(next.dataset.key);
};

export const galleryEl = () => document.querySelector('.gallery');

export const placeCell = (rec) => {
  const gallery = galleryEl();
  if (!gallery) return;
  const old = gallery.querySelector('.cell[data-key="' + CSS.escape(rec.key) + '"]');
  const li = cellEl(rec, 0);
  li.style.removeProperty('--i');
  if (old) {
    old.parentElement.replaceWith(li);
    return;
  }
  const next = [...gallery.querySelectorAll('.cell')].find((c) => c.dataset.key > rec.key);
  if (next) gallery.insertBefore(li, next.parentElement);
  else gallery.append(li);
};

export const dropCell = (key) => {
  const gallery = galleryEl();
  const old = gallery && gallery.querySelector('.cell[data-key="' + CSS.escape(key) + '"]');
  if (old) old.parentElement.remove();
};

export const refreshExportCount = () => {
  const el = document.getElementById('export-btn');
  if (el) el.lastChild.textContent = t('exportCount', { n: exportable().length });
  const stat = document.querySelector('.toolbar .stat');
  if (stat) {
    const x = stats();
    stat.replaceChildren(document.createTextNode(t('summary', { n: x.n, g: x.glyphs })), ...(x.review ? [h('small', null, t('review', { n: x.review }))] : []));
  }
};

export const refreshTiles = () => {
  refreshPairs();
  document.querySelectorAll('.cell').forEach((c) => {
    const rec = state.records.get(c.dataset.key);
    if (!rec || !rec.hasImage) return;
    const fresh = tile(rec);
    c.firstElementChild.replaceWith(fresh);
    const flag = contrastFlag(rec);
    const old = c.querySelector('.flag');
    if (old) old.remove();
    if (flag) c.append(h('span', { class: 'flag ' + flag, title: reasonOf(rec) }, icon('warn', { size: 11, stroke: 2.4 })));
  });
  if (state.stage === 'work') emit('inspector');
};

export const refreshPairs = () => {
  const el = document.getElementById('pairs');
  if (!el) return;
  const n = similarNow().length;
  el.dataset.pairs = String(n);
  el.replaceChildren(icon(n ? 'warn' : 'check', { size: 16 }), document.createTextNode(t('similarPairs', { n })));
};

export const refreshTilesOnly = () => {
  refreshPairs();
  document.querySelectorAll('.cell').forEach((c) => {
    const rec = state.records.get(c.dataset.key);
    if (!rec || !rec.hasImage) return;
    c.firstElementChild.replaceWith(tile(rec));
    const old = c.querySelector('.flag');
    if (old) old.remove();
    const flag = contrastFlag(rec);
    if (flag) c.append(h('span', { class: 'flag ' + flag, title: reasonOf(rec) }, icon('warn', { size: 11, stroke: 2.4 })));
  });
  const sel = state.records.get(state.selected);
  const head = document.querySelector('.sel-head .tile-art');
  if (sel && head) head.replaceWith(tile(sel, { size: 72 }));
  const trio = document.querySelector('.tint-trio');
  if (sel && trio) trio.replaceWith(trioEl(sel));
};

export const markExcluded = () => document.querySelectorAll('.cell').forEach((c) => c.classList.toggle('excluded', isExcluded(state.records.get(c.dataset.key))));

on('cell', placeCell);
on('drop', dropCell);
on('tiles', refreshTiles);
on('tiles-lite', refreshTilesOnly);
on('pairs', refreshPairs);
on('count', refreshExportCount);
on('adjusted', () => {
  refreshTilesOnly();
  refreshExportCount();
  markExcluded();
  emit('history');
});
