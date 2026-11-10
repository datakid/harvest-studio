import { h } from '../dom.js';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

export const place = (el, anchor) => {
  const r = anchor.getBoundingClientRect();
  const rtl = document.documentElement.dir === 'rtl';
  const w = el.offsetWidth;
  const hgt = el.offsetHeight;
  let x = rtl ? r.right - w : r.left;
  x = Math.max(12, Math.min(innerWidth - w - 12, x));
  let y = r.bottom + 8;
  if (y + hgt > innerHeight - 12) y = Math.max(12, r.top - hgt - 8);
  el.style.left = x + 'px';
  el.style.top = y + 'px';
};

export const popover = (anchor, content, { label = '', menu = false, onClose = null, className = '' } = {}) => {
  document.querySelectorAll('.popover').forEach((p) => p.dispatchEvent(new Event('dismiss')));
  const el = h('div', { class: 'popover' + (menu ? ' menu' : '') + (className ? ' ' + className : ''), role: menu ? 'menu' : 'dialog', 'aria-label': label || undefined, tabindex: -1 }, content);
  document.body.append(el);
  place(el, anchor);
  let closed = false;
  const close = (restore = true) => {
    if (closed) return;
    closed = true;
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', keys, true);
    removeEventListener('resize', reflow);
    el.remove();
    if (restore && anchor.isConnected) anchor.focus({ preventScroll: true });
    if (onClose) onClose();
  };
  const outside = (e) => {
    if (el.contains(e.target) || anchor.contains(e.target)) return;
    close(false);
  };
  const keys = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      return;
    }
    if (menu && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      const items = [...el.querySelectorAll(FOCUSABLE)];
      const i = items.indexOf(document.activeElement);
      e.preventDefault();
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
    }
    if (e.key === 'Tab') {
      const items = [...el.querySelectorAll(FOCUSABLE)];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  const reflow = () => place(el, anchor);
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
  document.addEventListener('keydown', keys, true);
  addEventListener('resize', reflow);
  el.addEventListener('dismiss', () => close(false));
  const first = el.querySelector(FOCUSABLE);
  (first || el).focus({ preventScroll: true });
  return { el, close, reflow };
};
