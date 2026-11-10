import { state, on } from '../store.js';
import { h, icon, kids } from '../dom.js';
import { t } from '../i18n.js';
import { popover } from '../ui/popover.js';
import { menu } from '../ui/menu.js';
import { colourField } from '../ui/controls.js';
import { selectedRecs, isExcluded } from '../model.js';
import { setTint, setTintLive, setLocked, spreadAcross } from '../actions/colour.js';
import { adjustCommit, scaleKeys } from '../actions/adjust.js';
import { reharvestMany, removeTiles } from '../actions/records.js';
import { clearSelection } from '../actions/select.js';
import { cleanAdjust } from '../../core/adjust.js';

const act = (id, iconName, label, run, extra = {}) => h('button', { class: 'btn small', id, type: 'button', 'data-act': id, onClick: run, ...extra }, icon(iconName, { size: 16 }), h('span', null, label));

const keys = () => [...state.sel];

const colourPop = (anchor) => {
  const recs = selectedRecs().filter((r) => r.hasImage);
  const first = recs[0] && recs[0].tint ? recs[0].tint[0] : '#8c95b6';
  popover(anchor, [h('div', { class: 'field' }, h('label', { class: 'label' }, t('oneColour')), colourField({ value: first, label: t('selColour'), id: 'sel-colour', onLive: (hex) => setTintLive(keys(), hex), onCommit: (hex) => setTint(keys(), hex) })), h('button', { class: 'btn', id: 'spread-palette', type: 'button', onClick: () => spreadAcross(keys()) }, t('spreadPalette'))], { label: t('selColour') });
};

const renderMenu = (anchor) =>
  menu(anchor, [['', t('adjAuto')], ['glyph', t('adjGlyph')], ['image', t('adjImage')]].map(([v, label]) => ({ label, run: () => adjustCommit(keys(), (a) => { const next = { ...a }; if (v) next.render = v; else delete next.render; return cleanAdjust(next); }) })), { label: t('selRender') });

export const refreshSelectionBar = () => {
  const slot = document.getElementById('selbar-slot');
  if (!slot) return;
  const recs = selectedRecs();
  if (recs.length < 2) {
    slot.replaceChildren();
    return;
  }
  const allKept = recs.every((r) => r.locked);
  const allOut = recs.every(isExcluded);
  slot.replaceChildren(...kids(
    h(
      'div',
      { class: 'selbar', id: 'selection-bar', role: 'toolbar', 'aria-label': t('selectedN', { n: recs.length }) },
      h('span', { class: 'selbar-count' }, t('selectedN', { n: recs.length })),
      act('sel-colour-btn', 'palette', t('selColour'), (e) => colourPop(e.currentTarget), { 'aria-haspopup': 'dialog' }),
      act('sel-keep', 'lock', allKept ? t('selUnkeep') : t('selKeep'), () => setLocked(keys(), !allKept), { 'aria-pressed': String(allKept) }),
      act('sel-size', 'sliders', t('selSize'), (e) => menu(e.currentTarget, [{ label: t('sizeSmaller'), run: () => scaleKeys(keys(), 0.95) }, { label: t('sizeLarger'), run: () => scaleKeys(keys(), 1.05) }], { label: t('selSize') }), { 'aria-haspopup': 'menu' }),
      act('sel-render', 'image', t('selRender'), (e) => renderMenu(e.currentTarget), { 'aria-haspopup': 'menu' }),
      act('sel-reharvest', 'reset', t('selReharvest'), () => reharvestMany(keys())),
      act('sel-exclude', 'eye', allOut ? t('selInclude') : t('selExclude'), () => adjustCommit(keys(), (a) => { const next = { ...a }; if (allOut) delete next.exclude; else next.exclude = true; return cleanAdjust(next); })),
      act('sel-remove', 'trash', t('selRemove'), () => removeTiles(keys())),
      h('button', { class: 'btn icon quiet small', id: 'sel-clear', type: 'button', 'aria-label': t('selClear'), title: t('selClear') + ' (Esc)', onClick: clearSelection }, icon('close', { size: 16 }))
    )
  ));
};

on('selection', refreshSelectionBar);
on('adjusted', refreshSelectionBar);
on('colour-state', refreshSelectionBar);
on('count', refreshSelectionBar);
