import { state, prefs, save, emit } from '../store.js';
import { h, icon } from '../dom.js';
import { t } from '../i18n.js';
import { randomSeed } from '../colour.js';
import { PRESETS, HARMONIES, harmony } from '../../core/palettes.js';
import { toast } from '../ui/toast.js';
import { seg } from '../ui/seg.js';
import { applyColours, setPalette } from '../actions/colour.js';

export const MODES = () => [['separate', t('modeSeparate')], ['follow', t('modeFollow')], ['mono', t('modeMono')], ['palette', t('modePalette')], ['family', t('modeFamily')], ['keep', t('modeKeep')]];
export const MODE_HINT = { separate: 'modeSeparateHint', follow: 'modeFollowHint', mono: 'modeMonoHint', palette: 'modePaletteHint', family: 'modeFamilyHint', keep: 'modeKeepHint' };

export const colourPanel = () => {
  const panel = h('section', { class: 'panel' }, h('h2', null, t('colours')), seg(t('colours'), MODES(), prefs.mode, (v) => { prefs.mode = v; save(); applyColours(); emit('tiles'); }, { wide: true }), h('p', { class: 'hint-text' }, t(MODE_HINT[prefs.mode])));
  if (prefs.mode === 'follow' || prefs.mode === 'family') {
    if (prefs.mode === 'follow') {
      panel.append(
        h('div', { class: 'range' }, h('label', { class: 'label', for: 'spread' }, t('spread')), h('input', { id: 'spread', type: 'range', min: 0, max: 1.6, step: 0.1, value: prefs.spread, onInput: (e) => { prefs.spread = Number(e.target.value); applyColours(); emit('tiles-lite'); }, onChange: save }))
      );
    }
    panel.append(h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onClick: () => { state.seed = randomSeed(); applyColours(); emit('tiles'); toast(t('shuffled')); } }, icon('shuffle', { size: 16 }), t('shuffle'))));
  }
  if (prefs.mode === 'mono') {
    const presets = ['#f0475c', '#ff8a3d', '#ffc247', '#3fb97a', '#2fa8c9', '#4c7df0', '#8c5cf0', '#c455b8'];
    const apply = (hex) => { prefs.monoColor = hex; save(); applyColours(); emit('tiles-lite'); const pk = document.getElementById('mono-picker'); if (pk) pk.value = hex; };
    panel.append(
      h(
        'div',
        { class: 'colour-row' },
        h('label', { class: 'picker', style: { background: prefs.monoColor } }, h('span', { class: 'sr' }, t('pickColour')), h('input', { id: 'mono-picker', type: 'color', value: prefs.monoColor, onInput: (e) => apply(e.target.value) })),
        h('div', { class: 'swatches' }, presets.map((p) => h('button', { class: 'sw', type: 'button', style: { background: p }, 'aria-label': p, 'aria-pressed': String(p === prefs.monoColor), onClick: () => { apply(p); emit('inspector'); } })))
      ),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: prefs.monoVary, onChange: (e) => { prefs.monoVary = e.target.checked; save(); applyColours(); emit('tiles-lite'); } }), t('vary')),
      prefs.monoVary ? h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onClick: () => { state.seed = randomSeed(); applyColours(); emit('tiles'); toast(t('shuffled')); } }, icon('shuffle', { size: 16 }), t('shuffle'))) : null
    );
  }
  if (prefs.mode === 'palette') panel.append(...palettePanel());
  return panel;
};

export const ui = { harmonyKind: 'analogous', harmonyBase: null, paletteName: '' };

export const strip = (colors) => h('span', { class: 'strip', 'aria-hidden': 'true' }, colors.map((c) => h('i', { style: { background: c } })));
export const sameColours = (a, b) => a.length === b.length && a.every((c, i) => c === b[i]);

export const palettePanel = () => {
  const colors = prefs.paletteColors;
  const base = ui.harmonyBase || colors[0];
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const out = [];
  out.push(
    h('div', { class: 'label' }, t('presets')),
    h('div', { class: 'pal-list' }, PRESETS.map((p) => h('button', { class: 'pal-chip', type: 'button', 'aria-pressed': String(sameColours(colors, p.colors)), onClick: () => setPalette(p.colors) }, strip(p.colors), t('preset' + cap(p.id))))),
    h('div', { class: 'label' }, t('harmony')),
    h(
      'div',
      { class: 'colour-row' },
      h('label', { class: 'picker', style: { background: base } }, h('span', { class: 'sr' }, t('pickColour')), h('input', { type: 'color', value: base, onInput: (e) => { e.target.parentElement.style.background = e.target.value; }, onChange: (e) => { ui.harmonyBase = e.target.value; setPalette(harmony(ui.harmonyBase, ui.harmonyKind)); } })),
      h('select', { 'aria-label': t('harmony'), onChange: (e) => { ui.harmonyKind = e.target.value; setPalette(harmony(base, ui.harmonyKind)); } }, HARMONIES.map((k) => h('option', { value: k, selected: k === ui.harmonyKind }, t('harmony' + cap(k)))))
    ),
    h('div', { class: 'label' }, t('yourPalette')),
    h(
      'div',
      { class: 'pal-list' },
      colors.map((c) => h('span', { class: 'pal-sw', style: { background: c } }, h('button', { type: 'button', 'aria-label': t('removeColour', { c }), onClick: () => setPalette(colors.filter((x) => x !== c)) }, icon('close', { size: 12, stroke: 2.6 })))),
      colors.length < 12 ? h('label', { class: 'pal-add' }, icon('plus', { size: 16 }), h('span', { class: 'sr' }, t('addColour')), h('input', { type: 'color', class: 'sr', value: colors[colors.length - 1], onChange: (e) => setPalette([...colors, e.target.value]) })) : null
    ),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: prefs.paletteVary, onChange: (e) => { prefs.paletteVary = e.target.checked; save(); applyColours(); emit('tiles-lite'); } }), t('vary')),
    prefs.paletteVary ? h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onClick: () => { state.seed = randomSeed(); applyColours(); emit('tiles'); toast(t('shuffled')); } }, icon('shuffle', { size: 16 }), t('shuffle'))) : null,
    h(
      'form',
      { class: 'pal-save', onSubmit: (e) => { e.preventDefault(); const name = ui.paletteName.trim(); if (!name) return; prefs.palettes = [{ name, colors: [...colors] }, ...prefs.palettes.filter((p) => p.name !== name)].slice(0, 12); ui.paletteName = ''; save(); toast(t('paletteSaved')); emit('inspector'); } },
      h('input', { type: 'text', placeholder: t('paletteName'), 'aria-label': t('paletteName'), value: ui.paletteName, maxlength: 32, onInput: (e) => { ui.paletteName = e.target.value; } }),
      h('button', { class: 'btn', type: 'submit' }, t('savePalette'))
    )
  );
  if (prefs.palettes.length) {
    out.push(
      h('div', { class: 'label' }, t('savedPalettes')),
      h('div', { class: 'pal-list' }, prefs.palettes.map((p) => h('span', { class: 'pal-chip saved' }, h('button', { type: 'button', 'aria-pressed': String(sameColours(colors, p.colors)), onClick: () => setPalette(p.colors) }, strip(p.colors), p.name), h('button', { class: 'del', type: 'button', 'aria-label': t('deletePalette', { name: p.name }), onClick: () => { prefs.palettes = prefs.palettes.filter((x) => x !== p); save(); emit('inspector'); } }, icon('trash', { size: 14 })))))
    );
  }
  return out;
};
