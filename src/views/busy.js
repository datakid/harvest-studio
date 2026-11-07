import { state, on } from '../store.js';
import { h } from '../dom.js';
import { t } from '../i18n.js';
import { tile } from '../ui/tile.js';

export const streamQueue = [];
export let streamFrame = 0;

export const flushStream = () => {
  streamFrame = 0;
  const cells = document.querySelectorAll('.work .gallery > li > .cell[data-busy-key]');
  const byKey = new Map([...cells].map((c) => [c.dataset.busyKey, c]));
  for (const p of streamQueue.splice(0)) {
    const cell = byKey.get(p.key);
    const ghost = cell && cell.querySelector('.tile-art.ghost');
    if (!ghost) continue;
    const url = URL.createObjectURL(new Blob([p.favicon], { type: 'image/png' }));
    const el = tile({ faviconUrl: url });
    el.querySelector('img').addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
    ghost.replaceWith(el);
  }
};

export const streamTile = (p) => {
  streamQueue.push(p);
  if (!streamFrame) streamFrame = requestAnimationFrame(flushStream);
};

export const updateProgress = () => {
  const bar = document.querySelector('.progress i');
  const text = document.querySelector('.progress-text');
  if (!state.progress || !bar) return;
  const { done, total, phase, pending } = state.progress;
  const share = phase === 'trace' ? 0.5 + (done / total) * 0.5 : (done / total) * 0.5;
  bar.style.width = Math.round(share * 100) + '%';
  const waiting = phase === 'fetch' && pending && pending.length && pending.length === total - done ? pending.map((k) => (state.names && state.names.get(k)) || k) : [];
  text.textContent = waiting.length ? t('fetchingWaiting', { done, total, names: waiting.join(', ') }) : t(phase === 'trace' ? 'tracing' : 'fetching', { done, total });
  bar.parentElement.setAttribute('aria-valuenow', String(Math.round(share * 100)));
  bar.parentElement.setAttribute('aria-valuetext', text.textContent);
};

export const renderBusy = () =>
  h(
    'section',
    { class: 'work', style: { display: 'block' } },
    h('div', { class: 'row', style: { 'margin-bottom': '14px' } }, h('div', { style: { flex: 1 } }, h('div', { class: 'progress', role: 'progressbar', 'aria-label': t('working'), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, h('i')), h('div', { class: 'progress-text' }, t('working')))),
    h('div', { class: 'stage' }, h('ul', { class: 'gallery' }, Array.from({ length: state.ghosts }, (_, i) => h('li', null, h('div', { class: 'cell', dataset: state.busyKeys && state.busyKeys[i] ? { busyKey: state.busyKeys[i] } : {} }, h('span', { class: 'tile-art ghost' }), h('span', { class: 'name' }, ' '))))))
  );

on('stream', streamTile);
on('progress', updateProgress);
