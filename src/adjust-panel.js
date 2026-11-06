import { h } from './dom.js';
import { t } from './i18n.js';
import { SCALE_MIN, SCALE_MAX, OFFSET_MAX, WEIGHT_MIN, WEIGHT_MAX, cleanAdjust } from '../core/adjust.js';

const DEFAULT_SCALE = { v3: 92 / 128, v4: 124 / 192 };

const pct = (v) => Math.round(v * 1000) / 10;

const seg = (name, options, value, onPick) =>
  h(
    'div',
    { class: 'seg', role: 'radiogroup', 'aria-label': name },
    options.map(([v, label]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(v === value), 'data-value': v === undefined ? 'auto' : v, onClick: () => onPick(v) }, label))
  );

const slider = ({ id, label, min, max, step, value, shown, changed, onLive, onCommit, onReset }) => {
  const readout = h('output', { class: 'adj-out', for: id }, shown(value));
  const input = h('input', {
    id,
    type: 'range',
    min,
    max,
    step,
    value,
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
    h('div', { class: 'adj-ctl' }, input, readout, changed ? h('button', { class: 'btn icon quiet', type: 'button', 'aria-label': t('adjResetOne', { name: label }), title: t('adjResetOne', { name: label }), onClick: onReset }, '↺') : null)
  );
};

const toggle = (id, label, on, onPick) => h('label', { class: 'check adj-row' + (on ? ' changed' : ''), for: id }, h('input', { id, type: 'checkbox', checked: on, onChange: (e) => onPick(e.target.checked) }), label);

export const adjustPanel = ({ rec, target, live, commit, copied }) => {
  const a = cleanAdjust(rec.adjust);
  const base = DEFAULT_SCALE[target === 'v4' ? 'v4' : 'v3'];
  const set = (patch) => cleanAdjust({ ...a, ...patch });
  const without = (...names) => {
    const next = { ...a };
    for (const n of names) delete next[n];
    return cleanAdjust(next);
  };
  const off = a.offset || { x: 0, y: 0 };
  const panel = h(
    'section',
    { class: 'panel adjust', id: 'adjust-panel' },
    h('h2', null, t('adjTitle')),
    h('div', { class: 'adj-row' + (a.render ? ' changed' : '') }, h('span', { class: 'label' }, t('adjRender')), seg(t('adjRender'), [[undefined, t('adjAuto')], ['glyph', t('adjGlyph')], ['image', t('adjImage')]], a.render, (v) => commit(v === undefined ? without('render') : set({ render: v })))),
    slider({
      id: 'adj-scale',
      label: t('adjScale'),
      min: SCALE_MIN * 100,
      max: SCALE_MAX * 100,
      step: 1,
      value: pct(a.scale === undefined ? base : a.scale),
      shown: (v) => v + '%',
      changed: a.scale !== undefined,
      onLive: (v) => live(set({ scale: v / 100 })),
      onCommit: (v) => commit(set({ scale: v / 100 })),
      onReset: () => commit(without('scale'))
    }),
    slider({
      id: 'adj-offset-x',
      label: t('adjOffsetX'),
      min: -OFFSET_MAX * 100,
      max: OFFSET_MAX * 100,
      step: 0.5,
      value: pct(off.x),
      shown: (v) => v + '%',
      changed: !!a.offset && a.offset.x !== 0,
      onLive: (v) => live(set({ offset: { x: v / 100, y: off.y } })),
      onCommit: (v) => commit(set({ offset: { x: v / 100, y: off.y } })),
      onReset: () => commit(set({ offset: { x: 0, y: off.y } }))
    }),
    slider({
      id: 'adj-offset-y',
      label: t('adjOffsetY'),
      min: -OFFSET_MAX * 100,
      max: OFFSET_MAX * 100,
      step: 0.5,
      value: pct(off.y),
      shown: (v) => v + '%',
      changed: !!a.offset && a.offset.y !== 0,
      onLive: (v) => live(set({ offset: { x: off.x, y: v / 100 } })),
      onCommit: (v) => commit(set({ offset: { x: off.x, y: v / 100 } })),
      onReset: () => commit(set({ offset: { x: off.x, y: 0 } }))
    }),
    slider({
      id: 'adj-weight',
      label: t('adjWeight'),
      min: WEIGHT_MIN,
      max: WEIGHT_MAX,
      step: 1,
      value: a.weight || 0,
      shown: (v) => (v > 0 ? '+' + v : String(v)),
      changed: a.weight !== undefined,
      onLive: (v) => live(set({ weight: v })),
      onCommit: (v) => commit(set({ weight: v })),
      onReset: () => commit(without('weight'))
    }),
    h('div', { class: 'adj-row' + (a.background ? ' changed' : '') }, h('span', { class: 'label' }, t('adjBackground')), seg(t('adjBackground'), [[undefined, t('adjAuto')], ['keep', t('adjKeep')], ['remove', t('adjRemove')]], a.background, (v) => commit(v === undefined ? without('background') : set({ background: v })))),
    target === 'v4' ? toggle('adj-twotone', t('adjTwoTone'), a.twoTone === false, (on) => commit(on ? set({ twoTone: false }) : without('twoTone'))) : null,
    toggle('adj-invert', t('adjInvert'), a.invert === true, (on) => commit(on ? set({ invert: true }) : without('invert'))),
    toggle('adj-exclude', t('adjExclude'), a.exclude === true, (on) => commit(on ? set({ exclude: true }) : without('exclude')))
  );
  const changedCount = Object.keys(a).length;
  if (changedCount) {
    panel.append(
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn', type: 'button', id: 'adj-reset', onClick: () => commit({}) }, t('adjResetAll')),
        h('button', { class: 'btn', type: 'button', id: 'adj-copy', onClick: () => navigator.clipboard.writeText(JSON.stringify({ [rec.key]: a }, null, 2)).then(copied) }, t('adjCopy'))
      )
    );
  }
  return panel;
};
