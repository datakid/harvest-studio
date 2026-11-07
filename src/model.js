import { state } from './store.js';
import { t } from './i18n.js';
import { similarPairs } from '../core/tints.js';

export const statusKey = (s) => 'status' + s.charAt(0).toUpperCase() + s.slice(1);

export const decodeRecord = (r, item) => {
  const rec = { ...r, hasImage: !!r.favicon, name: (item && item.name) || r.key };
  rec.raw = { favicon: r.favicon || null, glyph: r.glyph || null };
  if (r.favicon) rec.faviconUrl = URL.createObjectURL(new Blob([r.favicon], { type: 'image/png' }));
  if (r.trace && r.trace.accepted) rec.mask = 'url("data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' + (r.trace.layers && r.trace.layers.length > 1 ? r.trace.layers.map((l) => '<path fill="black"' + (l.opacity < 1 ? ' fill-opacity="' + l.opacity + '"' : '') + ' d="' + l.d + '"/>').join('') : '<path fill="black" d="' + r.trace.d + '"/>') + '</svg>') + '")';
  else if (r.glyph) rec.mask = 'url(' + URL.createObjectURL(new Blob([r.glyph], { type: 'image/png' })) + ')';
  delete rec.favicon;
  delete rec.glyph;
  return rec;
};

export const recordPayload = (r) => ({ key: r.key, appId: r.appId, status: r.status, base: r.base || null, tint: r.tint || null, sourceTint: r.sourceTint || null, locked: !!r.locked, contrast: r.contrast || null, tight: !!r.tight, groupId: r.groupId || null, colour: r.colour || null, hash: r.hash || null, adjust: r.adjust || null, trace: r.trace || null, favicon: (r.raw && r.raw.favicon) || null, glyph: (r.raw && r.raw.glyph) || null });

export const contrastFlag = (rec) => (rec.contrast === 'flagged' ? 'bad' : rec.status === 'default' || rec.status === 'stale' || rec.status === 'blocked' ? 'warn' : null);

export const caption = (rec) => {
  if (rec.status === 'stale') return t('staleSource');
  if (rec.status === 'found' || rec.status === 'override' || rec.status === 'pending') return null;
  return t(statusKey(rec.status));
};

export const failureText = (rec) => {
  const item = state.items.get(rec.key);
  if (!item) return '';
  if (item.error) return item.error;
  const bad = (item.attempts || []).find((a) => a.status !== 'used');
  return bad && bad.reason ? bad.reason : '';
};

export const reasonOf = (rec) => {
  if (rec.contrast === 'flagged') return t('contrastFlagged');
  if (rec.contrast === 'nudged') return t('contrastNudged');
  if (rec.tight) return t('tight');
  return t(statusKey(rec.status));
};

export const stats = () => {
  const list = [...state.records.values()].filter((r) => r.hasImage);
  const glyphs = list.filter((r) => r.mask).length;
  const review = [...state.records.values()].filter((r) => contrastFlag(r) || (!r.hasImage && !r.ghost)).length;
  return { n: list.length, glyphs, review };
};

export const imaged = () => [...state.records.values()].filter((r) => r.hasImage);

export const similarNow = () => similarPairs(imaged().filter((r) => r.tint), new Map(imaged().filter((r) => r.groupId).map((r) => [r.key, r.groupId])));

export const existingUrls = () => new Map([...state.records.keys()].map((k) => [k, (state.items.get(k) || {}).url || null]));

export const ghostFor = (t) => ({ key: t.key, appId: t.appId || t.key, status: 'pending', hasImage: false, ghost: true, name: t.name || t.key, base: null, tint: null, locked: false, trace: null });

export const isExcluded = (rec) => !!(rec && rec.adjust && rec.adjust.exclude);
export const exportable = () => imaged().filter((r) => !isExcluded(r));

export const pinnable = (a) => /^https?:\/\//i.test(a.href || '') && a.status !== 'blocked';

export const pinnedHref = (rec) => (state.pins[rec.key] && state.pins[rec.key].href) || null;
