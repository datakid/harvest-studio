import { isHex, tintFromHex } from './color.js';

export const KEY_RE = /^[a-z0-9-]+$/;

const catalogueTint = (app) => {
  if (isHex(app.color)) return tintFromHex(app.color);
  if (Array.isArray(app.gradient) && app.gradient.length === 3 && app.gradient.every(isHex)) return app.gradient.map((c) => c.toLowerCase());
  return null;
};

const catalogueExtras = (app) => {
  const tint = catalogueTint(app);
  return { ...(tint ? { catalogueTint: tint } : {}), ...(app.closed === true ? { closed: true } : {}), ...(typeof app.icon === 'string' ? { faIcon: app.icon } : {}) };
};
export const buildTargets = (catalog) => {
  const out = [];
  const categories = catalog && Array.isArray(catalog.categories) ? catalog.categories : [];
  for (const cat of categories) {
    if (!cat) continue;
    for (const app of Array.isArray(cat.apps) ? cat.apps : []) {
      if (!app || typeof app.id !== 'string' || app.id.startsWith('u-')) continue;
      if (Array.isArray(app.variants) && app.variants.length) {
        for (const v of app.variants) out.push({ key: app.id + '--' + v.id, appId: app.id, variantId: v.id, url: v.url, groupId: cat.id, ...catalogueExtras(app) });
      } else if (typeof app.url === 'string') {
        out.push({ key: app.id, appId: app.id, variantId: null, url: app.url, groupId: cat.id, ...catalogueExtras(app) });
      }
    }
  }
  return out;
};

const PIGMENTS = { bone: '#b9ad92', verdigris: '#3aa89a', tyrian: '#a8327a', lapis: '#2f5fc4', madder: '#c4403f', orpiment: '#e0a21b', indigo: '#4b4aa8', malachite: '#2a9d62' };

const fihristName = (node, lang) => (lang === 'ar' ? node.ar || node.en : node.en || node.ar) || '';

export const isFihrist = (data) => !!(data && typeof data.format === 'string' && /^fihrist\//i.test(data.format) && Array.isArray(data.tools));

export const buildFihristTargets = (data, lang = 'en') => {
  const out = [];
  if (!isFihrist(data)) return out;
  for (const tool of data.tools) {
    if (!tool || typeof tool.id !== 'string' || !KEY_RE.test(tool.id)) continue;
    const title = fihristName(tool, lang) || tool.id;
    const extras = { ...(typeof tool.group === 'string' && tool.group ? { groupId: tool.group } : {}), ...(PIGMENTS[tool.pigment] ? { catalogueTint: tintFromHex(PIGMENTS[tool.pigment]) } : {}), ...(tool.closed === true ? { closed: true } : {}) };
    if (Array.isArray(tool.variants) && tool.variants.length) {
      for (const v of tool.variants) {
        if (!v || typeof v.id !== 'string' || typeof v.url !== 'string') continue;
        const label = fihristName(v, lang);
        out.push({ key: tool.id + '--' + v.id, appId: tool.id, variantId: v.id, url: v.url, name: label ? title + ' \u00b7 ' + label : title, ...extras });
      }
    } else if (typeof tool.url === 'string') {
      out.push({ key: tool.id, appId: tool.id, variantId: null, url: tool.url, name: title, ...extras });
    }
  }
  return out;
};

export const urlIdentity = (url) => {
  try {
    const u = new URL(url);
    return u.hostname.toLowerCase().replace(/^www\./, '') + u.pathname.replace(/\/+$/, '') + u.search;
  } catch {
    return null;
  }
};

export const findDuplicates = (targets) => {
  const groups = new Map();
  targets.forEach((t, index) => {
    const id = t.url ? urlIdentity(t.url) : null;
    if (!id) return;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push({ key: t.key, name: t.name || t.key, index, url: t.url });
  });
  return [...groups.entries()].filter(([, list]) => list.length > 1).map(([id, entries]) => ({ id, url: entries[0].url, entries }));
};

export const dropDuplicates = (targets) => {
  const seen = new Set();
  return targets.filter((t) => {
    const id = t.url ? urlIdentity(t.url) : null;
    if (!id) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

export const extrasToTargets = (parsed) => {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  return Object.entries(parsed)
    .map(([k, v]) => [k, typeof v === 'string' ? { url: v } : v])
    .filter(([k, v]) => KEY_RE.test(k) && v && typeof v.url === 'string' && /^https?:/.test(v.url))
    .map(([k, v]) => ({ key: k, appId: k, variantId: null, url: v.url, extra: true, ...(typeof v.name === 'string' && v.name ? { name: v.name } : {}) }));
};

export const mergeTargets = (catalogTargets, extras) => {
  const taken = new Set(catalogTargets.map((t) => t.key));
  return catalogTargets.concat(extras.filter((t) => !taken.has(t.key)));
};

