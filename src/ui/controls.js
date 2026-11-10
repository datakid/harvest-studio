import { h, icon } from '../dom.js';

export const info = (text) => h('button', { type: 'button', class: 'info', 'aria-label': text, 'data-tip': text }, icon('info', { size: 16 }));

export const toggle = ({ id, label, checked, onChange, tip = null }) =>
  h('label', { class: 'toggle', for: id }, h('input', { id, type: 'checkbox', role: 'switch', checked, onChange: (e) => onChange(e.target.checked) }), h('span', null, label), tip ? info(tip) : null);

export const swatch = (hex, { pressed = false, label = hex, onPick }) => h('button', { type: 'button', class: 'swatch', style: { background: hex }, 'aria-label': label, 'aria-pressed': String(pressed), title: label, onClick: () => onPick(hex) });

const HEX = /^#?[0-9a-f]{6}$/i;

export const colourField = ({ value, label, onLive, onCommit, id }) => {
  const mixed = value === null;
  const shown = mixed ? '#8c95b6' : value;
  const picker = h('input', {
    type: 'color',
    value: shown,
    'aria-label': label,
    onInput: (e) => {
      wrap.querySelector('.picker').style.background = e.target.value;
      hex.value = e.target.value;
      onLive(e.target.value);
    },
    onChange: (e) => onCommit(e.target.value)
  });
  const hex = h('input', {
    type: 'text',
    class: 'hex',
    id,
    value: mixed ? '' : shown,
    placeholder: mixed ? '—' : '#rrggbb',
    spellcheck: false,
    autocomplete: 'off',
    'aria-label': label + ' hex',
    onChange: (e) => {
      const v = e.target.value.trim();
      if (!HEX.test(v)) {
        e.target.value = mixed ? '' : shown;
        return;
      }
      const full = (v[0] === '#' ? v : '#' + v).toLowerCase();
      picker.value = full;
      wrap.querySelector('.picker').style.background = full;
      onLive(full);
      onCommit(full);
    }
  });
  const wrap = h('div', { class: 'colour-field' }, h('label', { class: 'picker', style: { background: shown } }, picker), hex);
  return wrap;
};
