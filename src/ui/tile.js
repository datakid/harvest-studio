import { prefs } from '../store.js';
import { h } from '../dom.js';
import { effectiveTheme, tileColours } from '../colour.js';

export const theme = () => effectiveTheme(prefs.theme);

export const tile = (rec, { size = 60, mask = null, tint = null, colors = prefs.colors, theme: tone = theme() } = {}) => {
  const col = tileColours(tint || (rec && rec.tint), { colors, theme: tone });
  const el = h('span', { class: 'tile-art' + (col.vivid ? ' vivid' : ''), style: { '--size': size + 'px', '--tile': col.tile, '--tile-hi': col.hi || col.tile, '--tile-lo': col.lo || col.tile, '--ink-glyph': col.ink } });
  const m = mask || (rec && rec.mask);
  if (m) {
    el.style.setProperty('--mask', m);
    el.append(h('span', { class: 'glyph' }));
  } else if (rec && rec.faviconUrl) el.append(h('img', { src: rec.faviconUrl, alt: '' }));
  return el;
};

export const trioEl = (rec) => h('div', { class: 'tint-trio', 'aria-hidden': 'true' }, (rec.tint || []).map((c) => h('i', { style: { background: c } })));
