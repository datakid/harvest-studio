import { state, prefs, save, on, emit } from '../store.js';
import { h, icon, kids } from '../dom.js';
import { t } from '../i18n.js';
import { seg } from '../ui/seg.js';
import { paint, theme } from '../ui/tile.js';
import { contrastFlag, failureText, isExcluded, needsReview, reasonOf, statusKey, visibleKeys } from '../model.js';
import { clearSelection, selectMany, selectOnly, selectRange, toggleSelect } from '../actions/select.js';
import { openColours } from './colour-popover.js';

const cells = new Map();
let renderSeq = 0;

export const resetCells = () => cells.clear();

const gallery = () => document.querySelector('.work-grid');

const flagOf = (rec) => contrastFlag(rec) || (!rec.hasImage && !rec.ghost ? 'warn' : null);

const slot = (btn, sel, want) => {
  const cur = btn.querySelector(sel);
  if (!want) {
    if (cur) cur.remove();
    return;
  }
  if (!cur) btn.append(want.make());
  else if (want.sync) want.sync(cur);
};

const fillCell = (btn, rec) => {
  let [art, name] = btn.children;
  if (!art) {
    art = h('span');
    name = h('span', { class: 'name', dir: 'auto' });
    btn.append(art, name);
  }
  if (rec.hasImage) paint(art, rec, { size: prefs.tileSize });
  else if (art._kind !== 'ghost') {
    art.className = 'tile-art ghost';
    art.replaceChildren();
    art._sig = null;
    art._kind = 'ghost';
  }
  if (!rec.hasImage) {
    art.style.setProperty('--size', prefs.tileSize + 'px');
    art.style.animation = rec.ghost ? '' : 'none';
  }
  if (name.textContent !== rec.name) name.textContent = rec.name;
  const flag = flagOf(rec);
  slot(btn, '.dot', flag && { make: () => h('span', { class: 'dot ' + flag, 'aria-hidden': 'true' }), sync: (d) => { if (d.className !== 'dot ' + flag) d.className = 'dot ' + flag; } });
  slot(btn, '.compare-chip', state.compare && rec.faviconUrl && { make: () => h('img', { class: 'compare-chip', src: rec.faviconUrl, alt: '' }), sync: (i) => { if (i.getAttribute('src') !== rec.faviconUrl) i.src = rec.faviconUrl; } });
  const why = (!rec.hasImage ? failureText(rec) : needsReview(rec) ? reasonOf(rec) : '') || '';
  if (btn.title !== why) btn.title = why;
  const label = t('tileAria', { name: rec.name, status: t(statusKey(rec.status)) });
  if (btn.getAttribute('aria-label') !== label) btn.setAttribute('aria-label', label);
  btn.classList.toggle('excluded', isExcluded(rec));
  const sel = String(state.sel.has(rec.key));
  if (btn.getAttribute('aria-selected') !== sel) btn.setAttribute('aria-selected', sel);
};

const onCell = (e, key) => {
  if (e.shiftKey) selectRange(key);
  else if (e.metaKey || e.ctrlKey) toggleSelect(key);
  else selectOnly(key);
};

const cellEl = (rec) => {
  const btn = h('button', {
    class: 'cell',
    type: 'button',
    role: 'option',
    dataset: { key: rec.key, renderId: String(++renderSeq) },
    onClick: (e) => onCell(e, rec.key),
    onKeydown: (e) => {
      if (e.key === ' ') {
        e.preventDefault();
        toggleSelect(rec.key);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        selectOnly(rec.key);
        const first = document.querySelector('#inspector button, #inspector input');
        if (first) first.focus();
      }
    }
  });
  fillCell(btn, rec);
  return h('li', null, btn);
};

export const syncGallery = () => {
  const g = gallery();
  if (!g) return;
  const keys = visibleKeys();
  const want = new Set(keys);
  for (const [k, li] of cells) {
    if (!state.records.has(k)) {
      li.remove();
      cells.delete(k);
    } else if (!want.has(k) && li.parentElement) li.remove();
  }
  keys.forEach((k, i) => {
    let li = cells.get(k);
    if (!li) {
      li = cellEl(state.records.get(k));
      cells.set(k, li);
    }
    if (li._i !== i) {
      li._i = i;
      li.style.setProperty('--i', i);
    }
    if (g.children[i] !== li) g.insertBefore(li, g.children[i] || null);
  });
  const empty = document.getElementById('canvas-empty');
  if (empty) empty.hidden = keys.length > 0;
};

export const placeCell = (rec) => {
  if (!rec) return;
  const li = cells.get(rec.key);
  if (li) fillCell(li.firstElementChild, rec);
  syncGallery();
};

export const dropCell = (key) => {
  const li = cells.get(key);
  if (li) li.remove();
  cells.delete(key);
  syncGallery();
};

export const refreshArt = () => {
  for (const [k, li] of cells) {
    const rec = state.records.get(k);
    if (rec) fillCell(li.firstElementChild, rec);
  }
};

const markSelection = () => {
  for (const [k, li] of cells) li.firstElementChild.setAttribute('aria-selected', String(state.sel.has(k)));
};

const columns = () => {
  const list = [...document.querySelectorAll('.work-grid .cell')];
  if (!list.length) return 1;
  const top = list[0].offsetTop;
  return Math.max(1, list.filter((c) => c.offsetTop === top).length);
};

const gridKeys = (e) => {
  const list = [...document.querySelectorAll('.work-grid .cell')];
  const i = list.indexOf(document.activeElement);
  if (i < 0) return;
  const rtl = document.documentElement.dir === 'rtl';
  const move = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1, ArrowDown: columns(), ArrowUp: -columns() }[e.key];
  if (!move || e.altKey || e.metaKey || e.ctrlKey) return;
  e.preventDefault();
  const next = list[Math.max(0, Math.min(list.length - 1, i + move))];
  next.focus();
  if (e.shiftKey) selectRange(next.dataset.key);
  else selectOnly(next.dataset.key);
};

const marquee = (stage) => {
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.cell') || e.target.closest('button, input, a')) return;
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    const base = additive ? [...state.sel] : [];
    const x0 = e.clientX;
    const y0 = e.clientY;
    let box = null;
    const move = (ev) => {
      if (!box) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
        box = h('div', { class: 'marquee', 'aria-hidden': 'true' });
        document.body.append(box);
      }
      const l = Math.min(x0, ev.clientX);
      const tp = Math.min(y0, ev.clientY);
      const w = Math.abs(ev.clientX - x0);
      const hgt = Math.abs(ev.clientY - y0);
      box.style.left = l + 'px';
      box.style.top = tp + 'px';
      box.style.width = w + 'px';
      box.style.height = hgt + 'px';
      const hit = [...document.querySelectorAll('.work-grid .cell')].filter((c) => {
        const r = c.getBoundingClientRect();
        return r.left < l + w && r.right > l && r.top < tp + hgt && r.bottom > tp;
      }).map((c) => c.dataset.key);
      selectMany([...new Set([...base, ...hit])]);
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      if (box) box.remove();
      else if (!additive) clearSelection();
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  });
};

export const refreshExportCount = () => {};

export const renderToolbar = () =>
  h(
    'div',
    { class: 'canvas-toolbar' },
    h('label', { class: 'size-ctl' }, icon('grid', { size: 16 }), h('span', { class: 'sr' }, t('tileSize')), h('input', { id: 'tile-size', type: 'range', min: 48, max: 128, step: 4, value: prefs.tileSize, 'aria-label': t('tileSize'), onInput: (e) => { prefs.tileSize = Number(e.target.value); applyTileSize(); refreshArt(); }, onChange: save })),
    seg(t('colours'), [['vivid', t('vivid')], ['muted', t('muted')]], prefs.colors, (v) => { prefs.colors = v; save(); emit('tiles'); emit('canvas-toolbar'); }),
    seg(t('preview'), [['light', t('themeLight')], ['dark', t('themeDark')]], theme(), (v) => { prefs.tone = v; save(); emit('tiles'); emit('canvas-toolbar'); }),
    seg(t('corners'), [['balanced', t('balanced')], ['soft', t('soft')], ['crisp', t('crisp')]], prefs.corners, (v) => { prefs.corners = v; applyCorners(); save(); emit('tiles'); emit('canvas-toolbar'); }),
    h('button', { class: 'btn pill', id: 'faithful-btn', type: 'button', title: t('faithfulTip'), 'aria-pressed': String(prefs.faithful), onClick: () => { prefs.faithful = !prefs.faithful; save(); emit('canvas-toolbar'); emit('tiles'); } }, icon('image', { size: 16 }), t('faithful')),
    h('button', { class: 'btn pill', id: 'compare-btn', type: 'button', 'aria-pressed': String(state.compare), onClick: () => { state.compare = !state.compare; emit('canvas-toolbar'); refreshArt(); } }, icon('compare', { size: 16 }), t('compare')),
    h('button', { class: 'btn pill', id: 'colours-btn', type: 'button', 'aria-haspopup': 'dialog', onClick: (e) => openColours(e.currentTarget) }, icon('palette', { size: 16 }), t('colours'))
  );

export const applyCorners = () => {
  if (prefs.corners === 'balanced') delete document.documentElement.dataset.corners;
  else document.documentElement.dataset.corners = prefs.corners;
};

export const applyTileSize = () => {
  const g = gallery();
  if (g) g.style.setProperty('--tile-size', prefs.tileSize + 'px');
};

export const renderCanvas = () => {
  const list = h('ul', { class: 'gallery work-grid', role: 'listbox', 'aria-multiselectable': 'true', 'aria-label': t('galleryLabel'), onKeydown: gridKeys });
  list.style.setProperty('--tile-size', prefs.tileSize + 'px');
  const stage = h('div', { class: 'stage' + (state.bloom ? ' bloom' : '') }, list, h('div', { id: 'canvas-empty', class: 'empty', hidden: true }, h('span', null, t('noMatches')), h('button', { class: 'btn small', type: 'button', onClick: () => { state.view = { ...state.view, q: '', group: 'all', smart: null }; emit('view'); } }, t('clearFilters'))));
  marquee(stage);
  const wrap = h('section', { class: 'canvas', 'aria-label': t('galleryLabel') }, h('div', { class: 'canvas-toolbar-wrap' }, renderToolbar()), stage, h('div', { id: 'selbar-slot' }));
  if (state.bloom) setTimeout(() => document.querySelectorAll('.stage.bloom').forEach((el) => el.classList.remove('bloom')), 1900);
  state.bloom = false;
  resetCells();
  queueMicrotask(syncGallery);
  return wrap;
};

on('cell', placeCell);
on('drop', dropCell);
on('view', syncGallery);
on('tiles', refreshArt);
on('tiles-lite', refreshArt);
on('adjusted', () => {
  refreshArt();
  emit('count');
});
on('selection', markSelection);
on('canvas-toolbar', () => {
  const wrap = document.querySelector('.canvas-toolbar-wrap');
  if (wrap) wrap.replaceChildren(...kids(renderToolbar()));
});
