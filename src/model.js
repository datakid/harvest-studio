import { state, emit } from './store.js';
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
  delete rec.original;
  delete rec.glyph;
  return rec;
};

export const recordPayload = (r) => ({ key: r.key, appId: r.appId, status: r.status, base: r.base || null, tint: r.tint || null, sourceTint: r.sourceTint || null, locked: !!r.locked, hasOriginal: r.hasOriginal === true, contrast: r.contrast || null, tight: !!r.tight, groupId: r.groupId || null, colour: r.colour || null, hash: r.hash || null, adjust: r.adjust || null, trace: r.trace || null, favicon: (r.raw && r.raw.favicon) || null, glyph: (r.raw && r.raw.glyph) || null });

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

export const hostOf = (rec) => {
  const item = state.items.get(rec.key) || {};
  try {
    return item.url ? new URL(item.url).hostname.replace(/^www\./, '') : '';
  } catch {
    return '';
  }
};

export const needsReview = (rec) => !!(contrastFlag(rec) || (!rec.hasImage && !rec.ghost));

export const isAdjusted = (rec) => !!(rec.adjust && Object.keys(rec.adjust).length);

export const SMART = {
  review: needsReview,
  locked: (r) => !!r.locked,
  adjusted: isAdjusted,
  imageOnly: (r) => r.hasImage && !r.mask,
  excluded: isExcluded
};

export const hueOf = (rec) => {
  const hex = rec.tint && rec.tint[0];
  if (!hex) return 1000;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 999;
  const d = max - min;
  const hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return ((hue * 60) + 360) % 360;
};

const STATUS_ORDER = { notfound: 0, blocked: 1, default: 2, stale: 3, override: 4, found: 5, pending: 6 };

export const groupOf = (rec) => rec.groupId || '';

let engine = null;
let loading = null;
export const loadSearch = () => (loading ||= import('/search.js').then((m) => { engine = m; emit('view'); }, () => { loading = null; }));
const docOf = (r) => {
  const it = state.items.get(r.key) || {};
  return { key: r.key, name: r.name, terms: it.terms || [], url: it.url || '', group: groupOf(r), tint: (r.tint && r.tint[0]) || '' };
};

export const groupsList = () => {
  const counts = new Map();
  for (const r of state.records.values()) {
    const g = groupOf(r);
    if (g) counts.set(g, (counts.get(g) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
};

export const smartCounts = () => {
  const out = {};
  for (const k of Object.keys(SMART)) out[k] = 0;
  for (const r of state.records.values()) for (const [k, fn] of Object.entries(SMART)) if (fn(r)) out[k] += 1;
  return out;
};

export const visibleKeys = () => {
  const { q, group, smart, sort } = state.view;
  const needle = q.trim().toLowerCase();
  let list = [...state.records.values()];
  if (group !== 'all') list = list.filter((r) => groupOf(r) === group);
  if (smart && SMART[smart]) list = list.filter(SMART[smart]);
  if (needle && engine) return engine.rank(list.map(docOf), needle);
  if (needle) {
    loadSearch();
    list = list.filter((r) => r.name.toLowerCase().includes(needle) || r.key.includes(needle) || hostOf(r).includes(needle));
  }
  const by = {
    name: (a, b) => a.name.localeCompare(b.name) || (a.key < b.key ? -1 : 1),
    group: (a, b) => groupOf(a).localeCompare(groupOf(b)) || a.name.localeCompare(b.name),
    hue: (a, b) => hueOf(a) - hueOf(b) || (a.key < b.key ? -1 : 1),
    status: (a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || a.name.localeCompare(b.name)
  }[sort] || ((a, b) => (a.key < b.key ? -1 : 1));
  return list.sort(by).map((r) => r.key);
};

export const selectedRecs = () => [...state.sel].map((k) => state.records.get(k)).filter(Boolean);

export const defaultScale = (target) => (target === 'v4' ? 124 / 192 : 92 / 128);

export const sharedValue = (recs, read) => {
  if (!recs.length) return undefined;
  const first = JSON.stringify(read(recs[0]));
  return recs.every((r) => JSON.stringify(read(r)) === first) ? read(recs[0]) : null;
};
