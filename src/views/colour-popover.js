import { state, prefs, ui, on } from '../store.js';
import { h, icon, kids } from '../dom.js';
import { t } from '../i18n.js';
import { PRESETS, HARMONIES, harmony } from '../../core/palettes.js';
import { popover } from '../ui/popover.js';
import { toggle, colourField, swatch } from '../ui/controls.js';
import { setMode, setSpreadLive, settleColour, setMono, setMonoLive, setVary, shuffle, setPalette, savePalette, deletePalette } from '../actions/colour.js';

const MODES = ['separate', 'follow', 'family', 'palette', 'mono', 'keep'];
const MONO_SWATCHES = ['#f0475c', '#ff8a3d', '#ffc247', '#3fb97a', '#2fa8c9', '#4c7df0', '#8c5cf0', '#c455b8'];

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const strip = (colors) => h('span', { class: 'strip', 'aria-hidden': 'true' }, colors.map((c) => h('i', { style: { background: c } })));
const same = (a, b) => a.length === b.length && a.every((c, i) => c === b[i]);

const shuffleRow = () => h('div', { class: 'row' }, h('button', { class: 'btn small', id: 'shuffle-btn', type: 'button', onClick: shuffle }, icon('shuffle', { size: 16 }), t('shuffle')));

const modeList = () =>
  h(
    'div',
    { class: 'mode-list', role: 'radiogroup', 'aria-label': t('colours') },
    MODES.map((m) =>
      h(
        'button',
        { class: 'mode-row', type: 'button', role: 'radio', 'aria-checked': String(prefs.mode === m), 'data-value': m, id: 'mode-' + m, onClick: () => setMode(m) },
        h('span', { class: 'mode-name' }, t('mode' + cap(m))),
        h('span', { class: 'mode-tip' }, t('mode' + cap(m) + 'Tip'))
      )
    )
  );

const followControls = () => [
  h('div', { class: 'range adj-row' }, h('label', { class: 'label', for: 'spread' }, t('spread')), h('div', { class: 'adj-ctl' }, h('input', { id: 'spread', type: 'range', min: 0, max: 1.6, step: 0.1, value: prefs.spread, onInput: (e) => setSpreadLive(Number(e.target.value)), onChange: settleColour }))),
  shuffleRow()
];

const monoControls = () => [
  h('div', { class: 'field' }, h('label', { class: 'label' }, t('oneColour')), colourField({ value: prefs.monoColor, label: t('oneColour'), id: 'mono-hex', onLive: setMonoLive, onCommit: () => settleColour() })),
  h('div', { class: 'row swatches' }, MONO_SWATCHES.map((c) => swatch(c, { pressed: c === prefs.monoColor, onPick: setMono }))),
  toggle({ id: 'mono-vary', label: t('vary'), checked: prefs.monoVary, onChange: (on) => setVary('mono', on) }),
  prefs.monoVary ? shuffleRow() : null
];

const paletteControls = () => {
  const colors = prefs.paletteColors;
  const base = ui.harmonyBase || colors[0];
  const out = [
    h('div', { class: 'label' }, t('presets')),
    h('div', { class: 'pal-list' }, PRESETS.map((p) => h('button', { class: 'pal-chip', type: 'button', 'aria-pressed': String(same(colors, p.colors)), onClick: () => setPalette(p.colors) }, strip(p.colors), t('preset' + cap(p.id))))),
    h('div', { class: 'label' }, t('harmony')),
    h(
      'div',
      { class: 'row' },
      colourField({ value: base, label: t('harmony'), id: 'harmony-hex', onLive: () => {}, onCommit: (hex) => { ui.harmonyBase = hex; setPalette(harmony(hex, ui.harmonyKind)); } }),
      h('select', { id: 'harmony-kind', 'aria-label': t('harmony'), onChange: (e) => { ui.harmonyKind = e.target.value; setPalette(harmony(base, ui.harmonyKind)); } }, HARMONIES.map((k) => h('option', { value: k, selected: k === ui.harmonyKind }, t('harmony' + cap(k)))))
    ),
    h('div', { class: 'label' }, t('yourPalette')),
    h(
      'div',
      { class: 'pal-list' },
      colors.map((c) => h('span', { class: 'pal-sw', style: { background: c } }, h('button', { type: 'button', 'aria-label': t('removeColour', { c }), onClick: () => setPalette(colors.filter((x) => x !== c)) }, icon('close', { size: 12, stroke: 2.6 })))),
      colors.length < 12 ? h('label', { class: 'pal-add' }, icon('plus', { size: 16 }), h('span', { class: 'sr' }, t('addColour')), h('input', { type: 'color', class: 'sr', value: colors[colors.length - 1], onChange: (e) => setPalette([...colors, e.target.value]) })) : null
    ),
    toggle({ id: 'palette-vary', label: t('vary'), checked: prefs.paletteVary, onChange: (on) => setVary('palette', on) }),
    prefs.paletteVary ? shuffleRow() : null,
    h(
      'form',
      {
        class: 'pal-save',
        onSubmit: (e) => {
          e.preventDefault();
          const name = ui.paletteName.trim();
          if (!name) return;
          ui.paletteName = '';
          savePalette(name);
        }
      },
      h('input', { id: 'palette-name', type: 'text', placeholder: t('paletteName'), 'aria-label': t('paletteName'), value: ui.paletteName, maxlength: 32, onInput: (e) => { ui.paletteName = e.target.value; } }),
      h('button', { class: 'btn small', type: 'submit' }, t('savePalette'))
    )
  ];
  if (prefs.palettes.length) {
    out.push(
      h('div', { class: 'label' }, t('savedPalettes')),
      h('div', { class: 'pal-list' }, prefs.palettes.map((p) => h('span', { class: 'pal-chip saved' }, h('button', { type: 'button', 'aria-pressed': String(same(prefs.paletteColors, p.colors)), onClick: () => setPalette(p.colors) }, strip(p.colors), p.name), h('button', { class: 'del', type: 'button', 'aria-label': t('deletePalette', { name: p.name }), onClick: () => deletePalette(p) }, icon('trash', { size: 14 })))))
    );
  }
  return out;
};

const fill = (root) => {
  const active = document.activeElement && root.contains(document.activeElement) ? document.activeElement.id : null;
  const kept = [...state.records.values()].filter((r) => r.locked).length;
  root.replaceChildren(...kids(
    modeList(),
    prefs.mode === 'follow' ? followControls() : null,
    prefs.mode === 'family' ? shuffleRow() : null,
    prefs.mode === 'mono' ? monoControls() : null,
    prefs.mode === 'palette' ? paletteControls() : null,
    kept ? h('p', { class: 'hint-text kept-note' }, t('keptN', { n: kept })) : null
  ));
  if (active) {
    const again = root.querySelector('#' + CSS.escape(active));
    if (again) again.focus({ preventScroll: true });
  }
};

export const openColours = (anchor) => {
  const root = h('div', { class: 'colour-pop', id: 'colour-pop' });
  fill(root);
  const off = on('colour-state', () => {
    if (root.isConnected) fill(root);
  });
  return popover(anchor, root, { label: t('colours'), className: 'wide', onClose: off });
};
