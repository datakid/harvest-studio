import { state, prefs, ui, emit } from '../store.js';
import { h, icon } from '../dom.js';
import { t } from '../i18n.js';
import { seg } from '../ui/seg.js';
import { toggle, info, colourField, swatch } from '../ui/controls.js';
import { tile, trioEl } from '../ui/tile.js';
import { sharedValue, defaultScale, loadPalette } from '../model.js';
import { setTint, setTintLive, setLocked, setStop, setStopLive, setPick, commitColour } from '../actions/colour.js';
import { adjustLive, adjustCommit } from '../actions/adjust.js';
import { cleanAdjust, SCALE_MIN, SCALE_MAX, OFFSET_MAX, WEIGHT_MIN, WEIGHT_MAX } from '../../core/adjust.js';
import { hexToLch, lchToHex, pickTint, v4Violations } from '../../core/color.js';

const pct = (v) => Math.round(v * 1000) / 10;

const range = ({ id, label, min, max, step, value, mixed, shown, changed, onLive, onCommit, onReset }) => {
  const readout = h('output', { class: 'adj-out', for: id }, mixed ? '—' : shown(value));
  const input = h('input', {
    id,
    type: 'range',
    min,
    max,
    step,
    value: mixed ? (Number(min) + Number(max)) / 2 : value,
    onInput: (e) => {
      readout.textContent = shown(Number(e.target.value));
      onLive(Number(e.target.value));
    },
    onChange: (e) => onCommit(Number(e.target.value))
  });
  return h(
    'div',
    { class: 'range adj-row' + (changed ? ' changed' : '') },
    h('label', { class: 'label', for: id }, label, changed ? h('i', { class: 'adj-dot', 'aria-hidden': 'true' }) : null),
    h('div', { class: 'adj-ctl' }, input, readout, changed ? h('button', { class: 'btn icon quiet small', type: 'button', 'aria-label': t('adjResetOne', { name: label }), title: t('adjResetOne', { name: label }), onClick: onReset }, icon('reset', { size: 14 })) : null)
  );
};

export const previews = (rec) => {
  const sizes = [['vivid', 'light'], ['vivid', 'dark'], ['muted', 'light'], ['muted', 'dark']];
  return h(
    'div',
    { class: 'look-previews', 'aria-label': t('preview'), role: 'group' },
    h('div', { class: 'preview-tiles' }, sizes.map(([colors, tone]) => h('span', { class: 'preview-cell', 'data-tone': tone }, tile(rec, { size: 52, colors, theme: tone, faithful: false })))),
    h('div', { class: 'preview-favicons' }, rec.faviconUrl ? [h('span', { class: 'fav fav16', title: t('favicon16') }, h('img', { src: rec.faviconUrl, alt: '', width: 16, height: 16 })), h('span', { class: 'fav fav32', title: t('favicon32') }, h('img', { src: rec.faviconUrl, alt: '', width: 32, height: 32 }))] : null)
  );
};

const eyedropper = (apply) =>
  'EyeDropper' in window
    ? h('button', { class: 'btn icon quiet', id: 'eyedropper', type: 'button', 'aria-label': t('pickColour'), title: t('pickColour'), onClick: async () => { try { const r = await new window.EyeDropper().open(); apply(r.sRGBHex); } catch {} } }, icon('eyedropper'))
    : null;

const fineTune = (rec) => {
  const [L, C, H] = hexToLch(rec.tint[0]);
  const sliders = [
    ['lch-l', 'L', 0.2, 0.9, 0.005, L],
    ['lch-c', 'C', 0, 0.25, 0.005, C],
    ['lch-h', 'H', 0, 360, 1, H]
  ];
  const read = () => sliders.map(([id]) => Number(document.getElementById(id).value));
  const live = () => setTintLive([rec.key], lchToHex(...read()));
  const done = () => {
    setTint([rec.key], lchToHex(...read()));
    emit('inspector');
  };
  return h(
    'details',
    { class: 'fine', id: 'fine-tune' },
    h('summary', null, t('fineTune')),
    h('div', { class: 'fine-body' }, sliders.map(([id, label, min, max, step, value]) => h('div', { class: 'range adj-row' }, h('label', { class: 'label', for: id }, label), h('div', { class: 'adj-ctl' }, h('input', { id, type: 'range', min, max, step, value, onInput: live, onChange: done }))))),
    h(
      'div',
      { class: 'stops' },
      toggle({ id: 'link-stops', label: t('linkStops'), checked: ui.linkStops !== false, onChange: (on) => { ui.linkStops = on; emit('inspector'); } }),
      ui.linkStops === false
        ? rec.tint.map((c, i) => colourField({ value: c, label: t('stopN', { n: i + 1 }), id: 'stop-' + i, onLive: (hex) => setStopLive(rec.key, i, hex), onCommit: (hex) => { setStop(rec.key, i, hex); emit('inspector'); } }))
        : null
    )
  );
};

const paletteSection = (rec) => {
  const body = h('div', { class: 'fine-body', id: 'palette-body' });
  const section = h('details', { class: 'fine', id: 'palette', open: ui.paletteOpen === null ? prefs.faithful : ui.paletteOpen }, h('summary', null, t('iconColours')), body);
  let loaded = false;
  const load = async () => {
    if (loaded) return;
    loaded = true;
    try {
      const [colours, m] = await Promise.all([loadPalette(rec), import('/palette.js')]);
      if (section.isConnected) body.replaceChildren(m.panel({ h, seg, t, colours, mix: pickTint, fits: (tint) => !v4Violations(tint).length, outside: () => state.target === 'v4', apply: (kind, picked) => setPick(rec.key, kind, picked) }));
    } catch {
      loaded = false;
    }
  };
  section.addEventListener('toggle', () => {
    ui.paletteOpen = section.open;
    if (section.open) load();
  });
  if (section.open) load();
  return section;
};

const colourSection = (recs) => {
  const imaged = recs.filter((r) => r.hasImage);
  if (!imaged.length) return null;
  const keys = imaged.map((r) => r.key);
  const first = sharedValue(imaged, (r) => (r.tint ? r.tint[0] : null));
  const single = imaged.length === 1 ? imaged[0] : null;
  const keptAll = imaged.every((r) => r.locked);
  const keptAny = imaged.some((r) => r.locked);
  const apply = (hex) => {
    setTint(keys, hex);
    emit('inspector');
  };
  const section = h(
    'section',
    { class: 'insp-section' },
    h('h3', null, t('colour')),
    h('div', { class: 'colour-row' }, colourField({ value: first, label: t('pickColour'), id: 'colour-hex', onLive: (hex) => setTintLive(keys, hex), onCommit: apply }), eyedropper(apply), single ? trioEl(single) : null),
    single && single.base ? h('div', { class: 'row from-icon', 'aria-label': t('fromIcon') }, h('span', { class: 'label' }, t('fromIcon')), [...new Set(single.base)].map((c) => swatch(c, { onPick: apply }))) : null,
    h('div', { class: 'row spread' }, toggle({ id: 'keep-colour', label: t('keepColour'), checked: keptAll, tip: t('keepColourTip'), onChange: (on) => { setLocked(keys, on); emit('inspector'); } }), keptAny ? h('button', { class: 'btn small', type: 'button', 'data-act': 'reset-colour', onClick: () => { setLocked(keys, false); emit('inspector'); } }, icon('reset', { size: 14 }), t('resetColour')) : null),
    single ? paletteSection(single) : null,
    single && single.tint ? fineTune(single) : null
  );
  return section;
};

const segRow = (label, field, options, recs, keys, value) =>
  h('div', { class: 'adj-row' + (value !== undefined && value !== null ? ' changed' : '') }, h('span', { class: 'label' }, label), seg(label, options, value === null ? '__mixed' : value, (v) => adjustCommit(keys, (a) => { const next = { ...a }; if (v === undefined) delete next[field]; else next[field] = v; return cleanAdjust(next); })));

export const adjustSection = (recs) => {
  const imaged = recs.filter((r) => r.hasImage);
  if (!imaged.length) return null;
  const keys = imaged.map((r) => r.key);
  const get = (field) => sharedValue(imaged, (r) => cleanAdjust(r.adjust)[field]);
  const any = (field) => imaged.some((r) => cleanAdjust(r.adjust)[field] !== undefined);
  const off = (axis) => sharedValue(imaged, (r) => (cleanAdjust(r.adjust).offset || { x: 0, y: 0 })[axis]);
  const anyOff = (axis) => imaged.some((r) => ((cleanAdjust(r.adjust).offset || { x: 0, y: 0 })[axis] || 0) !== 0);
  const setField = (field, value) => (a) => cleanAdjust({ ...a, [field]: value });
  const without = (...names) => (a) => {
    const next = { ...a };
    for (const n of names) delete next[n];
    return cleanAdjust(next);
  };
  const setOff = (axis, v) => (a) => {
    const cur = cleanAdjust(a).offset || { x: 0, y: 0 };
    return cleanAdjust({ ...a, offset: { ...cur, [axis]: v } });
  };
  const scale = get('scale');
  const base = defaultScale(state.target);
  const canBackground = imaged.every((r) => r.hasOriginal !== false && r.hasOriginal !== undefined) || any('background');
  const glyphy = [
    segRow(t('adjRender'), 'render', [[undefined, t('adjAuto')], ['glyph', t('adjGlyph')], ['image', t('adjImage')]], imaged, keys, get('render')),
    range({ id: 'adj-scale', label: t('adjScale'), min: SCALE_MIN * 100, max: SCALE_MAX * 100, step: 1, value: pct(scale === undefined ? base : scale === null ? base : scale), mixed: scale === null, shown: (v) => v + '%', changed: any('scale'), onLive: (v) => adjustLive(keys, setField('scale', v / 100)), onCommit: (v) => adjustCommit(keys, setField('scale', v / 100)), onReset: () => adjustCommit(keys, without('scale')) }),
    range({ id: 'adj-offset-x', label: t('adjOffsetX'), min: -OFFSET_MAX * 100, max: OFFSET_MAX * 100, step: 0.5, value: pct(off('x') || 0), mixed: off('x') === null, shown: (v) => v + '%', changed: anyOff('x'), onLive: (v) => adjustLive(keys, setOff('x', v / 100)), onCommit: (v) => adjustCommit(keys, setOff('x', v / 100)), onReset: () => adjustCommit(keys, setOff('x', 0)) }),
    range({ id: 'adj-offset-y', label: t('adjOffsetY'), min: -OFFSET_MAX * 100, max: OFFSET_MAX * 100, step: 0.5, value: pct(off('y') || 0), mixed: off('y') === null, shown: (v) => v + '%', changed: anyOff('y'), onLive: (v) => adjustLive(keys, setOff('y', v / 100)), onCommit: (v) => adjustCommit(keys, setOff('y', v / 100)), onReset: () => adjustCommit(keys, setOff('y', 0)) }),
    range({ id: 'adj-weight', label: t('adjWeight'), min: WEIGHT_MIN, max: WEIGHT_MAX, step: 1, value: get('weight') || 0, mixed: get('weight') === null, shown: (v) => (v > 0 ? '+' + v : String(v)), changed: any('weight'), onLive: (v) => adjustLive(keys, setField('weight', v)), onCommit: (v) => adjustCommit(keys, setField('weight', v)), onReset: () => adjustCommit(keys, without('weight')) }),
    toggle({ id: 'adj-invert', label: t('adjInvert'), checked: get('invert') === true, onChange: (on) => adjustCommit(keys, on ? setField('invert', true) : without('invert')) }),
    state.target === 'v4' ? toggle({ id: 'adj-twotone', label: t('adjTwoTone'), checked: get('twoTone') === false, onChange: (on) => adjustCommit(keys, on ? setField('twoTone', false) : without('twoTone')) }) : null
  ];
  const background = [
    segRow(t('adjBackground'), 'background', [[undefined, t('adjAuto')], ['keep', t('adjKeep')], ['remove', t('adjRemove')]], imaged, keys, get('background')),
    !canBackground ? h('p', { class: 'hint-text' }, t('adjUnavailable')) : null
  ];
  const changed = imaged.some((r) => Object.keys(cleanAdjust(r.adjust)).length);
  return h(
    'section',
    { class: 'insp-section adjust', id: 'adjust-panel' },
    h('h3', null, t('sectionGlyph'), info(t('adjTip'))),
    glyphy,
    h('h3', null, t('sectionBackground')),
    background,
    toggle({ id: 'adj-exclude', label: t('adjExclude'), checked: get('exclude') === true, onChange: (on) => adjustCommit(keys, on ? setField('exclude', true) : without('exclude')) }),
    changed
      ? h(
          'div',
          { class: 'row' },
          h('button', { class: 'btn small', type: 'button', id: 'adj-reset', onClick: () => adjustCommit(keys, () => ({})) }, t('adjResetAll')),
          imaged.length === 1 ? h('button', { class: 'btn small', type: 'button', id: 'adj-copy', onClick: (e) => navigator.clipboard.writeText(JSON.stringify({ [imaged[0].key]: cleanAdjust(imaged[0].adjust) }, null, 2)).then(() => { e.target.textContent = t('copied'); }) }, t('adjCopy')) : null
        )
      : null
  );
};

export const lookPanel = (recs) => {
  const single = recs.length === 1 ? recs[0] : null;
  return h('div', { class: 'tab-panel', role: 'tabpanel', id: 'tab-look', 'aria-labelledby': 'tabbtn-look' }, single && single.hasImage ? previews(single) : null, single && !single.hasImage ? h('p', { class: 'empty-note' }, t('noIconTip')) : null, colourSection(recs), adjustSection(recs));
};
