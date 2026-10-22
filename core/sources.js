import { buildTargets, KEY_RE } from './targets.js';

const URL_RE = /^https?:\/\/[^\s]+$/i;
const DOMAIN_RE = /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/:?#][^\s]*)?$/i;
const ICON_FIELD_RE = /icon|favicon|logo|image|img|avatar/i;
const NAME_FIELDS = ['name', 'title', 'label', 'displayName', 'display_name', 'appName', 'app'];
const ID_FIELDS = ['id', 'key', 'slug', 'handle', 'code', 'name', 'title'];
const URL_FIELDS = ['url', 'href', 'link', 'website', 'homepage', 'site', 'address', 'uri', 'target'];

export const slugify = (text) =>
  String(text)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

export const hostKey = (url) => {
  try {
    const u = new URL(url);
    const slug = slugify(u.hostname.replace(/^www\./, '') + (u.pathname.length > 1 ? u.pathname : ''));
    return slug || 'app';
  } catch {
    return slugify(url) || 'app';
  }
};

export const normalizeUrl = (value) => {
  const v = String(value).trim();
  if (URL_RE.test(v)) return v;
  if (DOMAIN_RE.test(v)) return 'https://' + v;
  return null;
};

export const uniqueKeys = (items) => {
  const used = new Set();
  return items.map((item) => {
    let base = KEY_RE.test(item.key || '') ? item.key : slugify(item.key || '') || 'app';
    if (!KEY_RE.test(base)) base = 'app';
    let key = base;
    let n = 2;
    while (used.has(key)) key = base + '-' + n++;
    used.add(key);
    return { ...item, key, appId: item.appId && item.appId !== item.key ? item.appId : key };
  });
};

const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

const LANG_KEY = /^[a-z]{2,3}(?:[-_][a-z0-9]{2,8})?$/i;

export const isLabelObject = (v) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const entries = Object.entries(v);
  return entries.length > 0 && entries.every(([k, x]) => LANG_KEY.test(k) && typeof x === 'string');
};

const textAt = (obj, path, lang) => {
  const v = get(obj, path);
  return isLabelObject(v) ? pickLabel(v, lang) : v;
};

export const labelLanguages = (data) => {
  const found = new Set();
  const visit = (node, depth) => {
    if (depth > 8 || !node || typeof node !== 'object') return;
    if (isLabelObject(node)) {
      for (const k of Object.keys(node)) found.add(k.toLowerCase());
      return;
    }
    for (const child of Array.isArray(node) ? node : Object.values(node)) visit(child, depth + 1);
  };
  visit(data, 0);
  return [...found].sort();
};

const flatStringPaths = (obj, prefix = '', depth = 0, out = []) => {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) || depth > 2) return out;
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? prefix + '.' + k : k;
    if (typeof v === 'string' || isLabelObject(v)) out.push(path);
    else if (v && typeof v === 'object' && !Array.isArray(v)) flatStringPaths(v, path, depth + 1, out);
  }
  return out;
};

const collections = (data) => {
  const found = [];
  const visit = (node, path, depth) => {
    if (depth > 4 || node == null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      if (node.length && node.every((x) => x && typeof x === 'object' && !Array.isArray(x))) found.push({ path, items: node.map((value, i) => ({ value, hint: String(i) })) });
      else if (node.length && node.every((x) => typeof x === 'string')) found.push({ path, items: node.map((value, i) => ({ value, hint: String(i) })), strings: true });
      node.slice(0, 50).forEach((child, i) => visit(child, path ? path + '.' + i : String(i), depth + 1));
      return;
    }
    const entries = Object.entries(node);
    if (entries.length > 1 && entries.every(([, v]) => v && typeof v === 'object' && !Array.isArray(v))) found.push({ path, items: entries.map(([hint, value]) => ({ value, hint })), keyed: true });
    else if (entries.length > 1 && entries.every(([, v]) => typeof v === 'string' && normalizeUrl(v))) found.push({ path, items: entries.map(([hint, value]) => ({ value, hint })), keyed: true, strings: true });
    for (const [k, v] of entries) visit(v, path ? path + '.' + k : k, depth + 1);
  };
  visit(data, '', 0);
  return found;
};

const rankFields = (items, matcher, preferred, lang = 'en') => {
  const counts = new Map();
  for (const { value } of items) {
    for (const path of flatStringPaths(value)) {
      const v = textAt(value, path, lang);
      if (typeof v === 'string' && matcher(v, path)) counts.set(path, (counts.get(path) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([path, n]) => ({ path, n, score: n / items.length + (preferred.includes(path.split('.').pop().toLowerCase()) ? 0.5 : 0) - path.split('.').length * 0.02 }))
    .sort((a, b) => b.score - a.score);
};

const isImageRef = (v) => /^data:image\//i.test(v) || (/^https?:\/\//i.test(v) && /\.(png|jpe?g|gif|webp|ico|svg|avif)(\?|#|$)/i.test(v));

export const pickLabel = (value, lang = 'en') => {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const byKey = (k) => Object.entries(value).find(([name, v]) => name.toLowerCase() === k && typeof v === 'string' && v);
    for (const k of [lang, 'en', 'ar']) {
      const hit = byKey(String(k).toLowerCase());
      if (hit) return hit[1];
    }
    return Object.values(value).find((v) => typeof v === 'string' && v) || '';
  }
  return '';
};

const catalogueName = (app, variantId, lang) => {
  const title = pickLabel(app.name ?? app.title, lang) || app.id;
  const variant = variantId && Array.isArray(app.variants) ? app.variants.find((v) => v && v.id === variantId) : null;
  const label = variant ? pickLabel(variant.label, lang) : '';
  return label ? title + ' · ' + label : title;
};

export const scanJson = (data, overrides = {}, lang = 'en') => {
  if (data && Array.isArray(data.categories) && data.categories.some((c) => c && Array.isArray(c.apps))) {
    const apps = new Map();
    for (const cat of data.categories) for (const app of (cat && cat.apps) || []) if (app && typeof app.id === 'string') apps.set(app.id, app);
    const targets = buildTargets(data).map((t) => ({ ...t, name: apps.has(t.appId) ? catalogueName(apps.get(t.appId), t.variantId, lang) : t.appId }));
    return { kind: 'launcher', label: 'launcher', count: targets.length, targets, fields: null, candidates: null, languages: labelLanguages(data) };
  }
  const cols = collections(data)
    .map((c) => {
      const urls = c.strings ? c.items.length : rankFields(c.items, (v) => !!normalizeUrl(v) && !isImageRef(v), URL_FIELDS, lang)[0]?.n || 0;
      const icons = c.strings ? 0 : rankFields(c.items, (v, p) => isImageRef(v) && ICON_FIELD_RE.test(p), [], lang)[0]?.n || 0;
      return { ...c, urls, icons, weight: Math.max(urls, icons) };
    })
    .filter((c) => c.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.path.length - b.path.length);
  if (!cols.length) return { kind: 'none', count: 0, targets: [], fields: null, candidates: null, languages: [] };
  const col = overrides.collection ? cols.find((c) => c.path === overrides.collection) || cols[0] : cols[0];
  let urlField = null;
  let iconField = null;
  let nameField = null;
  let urlCandidates = [];
  let iconCandidates = [];
  let nameCandidates = [];
  if (!col.strings) {
    urlCandidates = rankFields(col.items, (v) => !!normalizeUrl(v) && !isImageRef(v), URL_FIELDS, lang);
    iconCandidates = rankFields(col.items, (v, p) => isImageRef(v) && ICON_FIELD_RE.test(p), [], lang);
    nameCandidates = rankFields(col.items, (v) => v.length > 0 && v.length < 80 && !normalizeUrl(v), NAME_FIELDS, lang);
    urlField = overrides.urlField === undefined ? urlCandidates[0]?.path || null : overrides.urlField;
    iconField = overrides.iconField === undefined ? iconCandidates[0]?.path || null : overrides.iconField;
    nameField = overrides.nameField === undefined ? nameCandidates[0]?.path || null : overrides.nameField;
  }
  const raw = col.items.map(({ value, hint }) => {
    if (col.strings) {
      const url = normalizeUrl(value);
      return url ? { key: col.keyed ? hint : hostKey(url), name: col.keyed ? hint : hostKey(url), url } : null;
    }
    const url = urlField ? textAt(value, urlField, lang) : null;
    const nUrl = typeof url === 'string' ? normalizeUrl(url) : null;
    const icon = iconField ? textAt(value, iconField, lang) : null;
    const iconHref = typeof icon === 'string' && isImageRef(icon) ? icon : null;
    if (!nUrl && !iconHref) return null;
    const name = nameField ? textAt(value, nameField, lang) : null;
    let id = null;
    for (const f of ID_FIELDS) {
      const v = isLabelObject(value[f]) ? pickLabel(value[f], 'en') : value[f];
      if (typeof v === 'string' && v) {
        id = v;
        break;
      }
    }
    const stableName = nameField ? textAt(value, nameField, 'en') : null;
    const key = col.keyed ? hint : id || (typeof stableName === 'string' && stableName) || (nUrl ? hostKey(nUrl) : 'app');
    return { key, name: typeof name === 'string' && name ? name : key, url: nUrl, iconHref };
  });
  const targets = uniqueKeys(raw.filter(Boolean));
  return {
    kind: 'generic',
    label: col.path || 'root',
    count: targets.length,
    targets,
    languages: labelLanguages(data),
    fields: { collection: col.path, urlField, iconField, nameField },
    candidates: {
      collections: cols.map((c) => ({ path: c.path, count: c.items.length })),
      url: urlCandidates.map((c) => c.path),
      icon: iconCandidates.map((c) => c.path),
      name: nameCandidates.map((c) => c.path)
    }
  };
};
