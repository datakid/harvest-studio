import { h } from '../dom.js';

export const toast = (message, { label = null, onAction = null, ms = 3200 } = {}) => {
  document.querySelectorAll('.toast').forEach((n) => n.remove());
  const el = h('div', { class: 'toast', role: 'status' }, h('div', null, message, label ? h('button', { class: 'toast-act', type: 'button', 'data-act': 'toast-action', onClick: () => { el.remove(); onAction(); } }, label) : null));
  document.body.append(el);
  setTimeout(() => el.remove(), ms);
};

export const announce = (message) => {
  let live = document.getElementById('live');
  if (!live) {
    live = h('div', { id: 'live', class: 'sr', 'aria-live': 'polite', role: 'status' });
    document.body.append(live);
  }
  live.textContent = message;
};
