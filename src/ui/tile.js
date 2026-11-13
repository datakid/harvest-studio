import { prefs } from '../store.js';
import { h } from '../dom.js';
import { effectiveTheme, tileColours } from '../colour.js';

export const theme = () => (prefs.tone === 'light' || prefs.tone === 'dark' ? prefs.tone : effectiveTheme(prefs.theme));

const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export const paint = (el, rec, { size = 60, mask = null, tint = null, colors = prefs.colors, theme: tone = theme(), faithful = prefs.faithful, pick } = {}) => {
  const m = mask || (rec && rec.mask);
  const url = rec && rec.faviconUrl;
  const real = faithful && url;
  const kind = real ? 'real' : m ? 'glyph' : url ? 'img' : 'none';
  const col = tileColours(tint || (rec && rec.tint), { colors, theme: tone, pick: pick !== undefined ? pick : tint || !rec ? null : rec.pick });
  const sig = [kind, real ? tone : '', size, col.tile, col.hi, col.lo, col.ink, col.vivid, kind === 'glyph' ? m : kind === 'none' ? '' : url].join('|');
  if (el._sig === sig) return el;
  const was = el._kind;
  const bare = kind === 'img' && !tint && !(rec && rec.tint);
  el.className = 'tile-art' + (real ? ' faithful' + (tone === 'dark' ? ' dk' : '') : bare ? ' raw' : col.vivid ? ' vivid' : '');
  const s = el.style;
  s.removeProperty('animation');
  s.setProperty('--size', size + 'px');
  s.setProperty('--tile', col.tile);
  s.setProperty('--tile-hi', col.hi || col.tile);
  s.setProperty('--tile-lo', col.lo || col.tile);
  s.setProperty('--ink-glyph', col.ink);
  if (kind === 'glyph') s.setProperty('--mask', m);
  const child = el.firstElementChild;
  const tag = kind === 'glyph' ? 'span' : kind === 'none' ? null : 'img';
  if (!child || !tag || child.localName !== tag) {
    el.replaceChildren(...(tag === 'span' ? [h('span', { class: 'glyph' })] : tag ? [h('img', { src: url, alt: '' })] : []));
    el._url = tag === 'img' ? url : '';
  } else if (tag === 'img' && el._url !== url) {
    child.src = url;
    el._url = url;
  }
  el._kind = kind;
  el._sig = sig;
  if (was && was !== kind && el.animate && !still()) el.animate({ opacity: [0, 1] }, { duration: 260, easing: 'ease-out' });
  return el;
};

export const tile = (rec, opts) => paint(h('span'), rec, opts);

export const trioEl = (rec) => h('div', { class: 'tint-trio', 'aria-hidden': 'true' }, (rec.tint || []).map((c) => h('i', { style: { background: c } })));
