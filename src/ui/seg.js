import { h } from '../dom.js';

export const seg = (name, options, value, onPick, { wide = false } = {}) =>
  h(
    'div',
    { class: 'seg' + (wide ? ' wide' : ''), role: 'radiogroup', 'aria-label': name },
    options.map(([v, label]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(v === value), onClick: () => onPick(v) }, label))
  );
