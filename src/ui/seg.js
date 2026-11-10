import { h } from '../dom.js';

export const seg = (name, options, value, onPick, { wide = false, id = null } = {}) =>
  h(
    'div',
    { class: 'seg' + (wide ? ' wide' : ''), role: 'radiogroup', 'aria-label': name, id },
    options.map(([v, label]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(v === value), 'data-value': v === undefined ? 'auto' : v, onClick: () => onPick(v) }, label))
  );
