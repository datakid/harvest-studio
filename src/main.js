import { h, clear, icon } from './dom.js';
import { t, setLang, getLang } from './i18n.js';
import { loadPrefs, savePrefs, loadToken, saveToken } from './prefs.js';
import { createClient } from './worker-client.js';
import { recolour, randomSeed, setManualColour, effectiveTheme, tileColours, requiredPatch } from './colour.js';
import { scanJson } from '../core/sources.js';
import { extrasToTargets, mergeTargets, findDuplicates, dropDuplicates, isFihrist } from '../core/targets.js';
import { filesFromDrop, isJsonFile, isImageFile, readJsonFile, rescan, buildTargets, pendingCount, parseUrls } from './inputs.js';
import { tintFromOklch } from '../core/color.js';
import { DEFAULT_SEED, similarPairs } from '../core/tints.js';
import { PRESETS, HARMONIES, harmony, cleanPalette } from '../core/palettes.js';
import { listProjects, saveProject, loadProject, removeProject, newId } from './projects.js';
import { classify, keepBoth, notPresent } from './add.js';

const prefs = loadPrefs();
setLang(prefs.lang);
const client = createClient();
for (const type of ['pointerdown', 'keydown', 'dragenter', 'paste']) addEventListener(type, () => client.warm(), { once: true, capture: true });
let proxyToken = loadToken();
let builtInProxy = false;
const proxyReady = fetch('/api/fetch?probe=1')
  .then((r) => (r.ok ? r.json() : null))
  .then((d) => {
    builtInProxy = !!(d && d.ok && d.mode === 'public');
  })
  .catch(() => {});
const proxySettings = async () => {
  await proxyReady;
  if (prefs.proxyUrl) return { proxyUrl: prefs.proxyUrl, proxyToken };
  return { proxyUrl: builtInProxy ? '/api/fetch' : '', proxyToken: '' };
};

const state = {
  stage: 'intake',
  pending: { urlText: '', files: [], jsons: [], bundle: { manifest: null, files: new Map() } },
  projects: [],
  pins: {},
  projectId: null,
  projectName: '',
  cell: null,
  records: new Map(),
  order: [],
  items: new Map(),
  catalogue: null,
  fihrist: null,
  selected: null,
  seed: DEFAULT_SEED,
  target: 'v3',
  progress: null,
  error: null,
  bloom: false,
  dirty: true,
  unsaved: false,
  adding: 0,
  chain: Promise.resolve(),
  ghosts: 0
};

let renderSeq = 0;

const app = document.getElementById('app');
const save = () => savePrefs(prefs);

const toast = (message, { label = null, onAction = null, ms = 3200 } = {}) => {
  document.querySelectorAll('.toast').forEach((n) => n.remove());
  const el = h('div', { class: 'toast', role: 'status' }, h('div', null, message, label ? h('button', { class: 'toast-act', type: 'button', 'data-act': 'toast-action', onClick: () => { el.remove(); onAction(); } }, label) : null));
  document.body.append(el);
  setTimeout(() => el.remove(), ms);
};

const announce = (message) => {
  let live = document.getElementById('live');
  if (!live) {
    live = h('div', { id: 'live', class: 'sr', 'aria-live': 'polite', role: 'status' });
    document.body.append(live);
  }
  live.textContent = message;
};

const download = (bytes, name, type = 'application/zip') => {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
};

const theme = () => effectiveTheme(prefs.theme);

const leafMask = (() => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path fill="black" d="M32 39C19 40 11 32 12 17C27 16 35 27 32 39Z"/><path fill="black" d="M32 38C31 22 40 11 53 10C55 25 47 37 32 38Z"/><path d="M32 55V36" stroke="black" stroke-width="4.5" stroke-linecap="round"/></svg>';
  return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
})();

const tile = (rec, { size = 60, mask = null, tint = null, colors = prefs.colors, theme: tone = theme() } = {}) => {
  const col = tileColours(tint || (rec && rec.tint), { colors, theme: tone });
  const el = h('span', { class: 'tile-art' + (col.vivid ? ' vivid' : ''), style: { '--size': size + 'px', '--tile': col.tile, '--tile-hi': col.hi || col.tile, '--tile-lo': col.lo || col.tile, '--ink-glyph': col.ink } });
  const m = mask || (rec && rec.mask);
  if (m) {
    el.style.setProperty('--mask', m);
    el.append(h('span', { class: 'glyph' }));
  } else if (rec && rec.faviconUrl) el.append(h('img', { src: rec.faviconUrl, alt: '' }));
  return el;
};

const statusKey = (s) => 'status' + s.charAt(0).toUpperCase() + s.slice(1);

const decodeRecord = (r, item) => {
  const rec = { ...r, hasImage: !!r.favicon, name: (item && item.name) || r.key };
  rec.raw = { favicon: r.favicon || null, glyph: r.glyph || null };
  if (r.favicon) rec.faviconUrl = URL.createObjectURL(new Blob([r.favicon], { type: 'image/png' }));
  if (r.trace && r.trace.accepted) rec.mask = 'url("data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' + (r.trace.layers && r.trace.layers.length > 1 ? r.trace.layers.map((l) => '<path fill="black"' + (l.opacity < 1 ? ' fill-opacity="' + l.opacity + '"' : '') + ' d="' + l.d + '"/>').join('') : '<path fill="black" d="' + r.trace.d + '"/>') + '</svg>') + '")';
  else if (r.glyph) rec.mask = 'url(' + URL.createObjectURL(new Blob([r.glyph], { type: 'image/png' })) + ')';
  delete rec.favicon;
  delete rec.glyph;
  return rec;
};

const applyColours = (only = null) => {
  const res = recolour(state.records, { mode: prefs.mode, seed: state.seed, monoColor: prefs.monoColor, monoVary: prefs.monoVary, spread: prefs.spread, paletteColors: prefs.paletteColors, paletteVary: prefs.paletteVary, only, target: state.target });
  scheduleSave();
  return res;
};

let saveTimer = 0;

const recordPayload = (r) => ({ key: r.key, appId: r.appId, status: r.status, base: r.base || null, tint: r.tint || null, sourceTint: r.sourceTint || null, locked: !!r.locked, contrast: r.contrast || null, tight: !!r.tight, groupId: r.groupId || null, colour: r.colour || null, hash: r.hash || null, trace: r.trace || null, favicon: (r.raw && r.raw.favicon) || null, glyph: (r.raw && r.raw.glyph) || null });

const snapshot = () => ({
  seed: state.seed,
  target: state.target,
  cell: state.cell,
  pins: state.pins,
  polish: state.polish || null,
  selected: state.selected,
  settings: { mode: prefs.mode, monoColor: prefs.monoColor, monoVary: prefs.monoVary, spread: prefs.spread, paletteColors: prefs.paletteColors, paletteVary: prefs.paletteVary },
  items: [...state.items.values()].map((i) => ({ key: i.key, name: i.name, url: i.url || null, flags: i.flags || [], status: i.status, source: i.source || null, error: i.error || null, attempts: i.attempts || [] })),
  records: [...state.records.values()].filter((r) => r.hasImage || !r.ghost).map(recordPayload)
});

const writeProject = async () => {
  const imaged = [...state.records.values()].filter((r) => r.hasImage);
  const meta = { id: state.projectId, name: state.projectName, updatedAt: Date.now(), count: imaged.length, dots: imaged.slice(0, 8).map((r) => (r.tint && r.tint[0]) || '#8c95b6') };
  if (await saveProject(meta, snapshot())) {
    state.unsaved = false;
    state.projects = await listProjects();
    window.__studio.saved = (window.__studio.saved || 0) + 1;
  }
};

const scheduleSave = () => {
  if (state.stage !== 'work' || !state.projectId) return;
  state.unsaved = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeProject, 700);
};

const defaultName = () => t('projectDefault', { n: [...state.records.values()].filter((r) => r.hasImage).length });

const adopt = (result, nameOf) => {
  state.items = new Map(result.items.map((i) => [i.key, { ...i, name: nameOf(i.key) }]));
  state.records = new Map();
  for (const r of result.records) state.records.set(r.key, decodeRecord(r, state.items.get(r.key)));
  for (const item of result.items) if (!state.records.has(item.key)) state.records.set(item.key, { key: item.key, appId: item.key, status: 'notfound', hasImage: false, name: item.name, base: null, tint: null, locked: false, trace: null });
  state.order = [...state.records.keys()].sort();
};

const enterWork = (primed = false) => {
  state.selected = state.order.find((k) => state.records.get(k).hasImage) || null;
  state.stage = 'work';
  state.bloom = true;
  state.dirty = true;
  launcherBuild = null;
  state.projectId = newId();
  state.projectName = defaultName();
  if (!primed) applyColours();
  else scheduleSave();
  renderMain();
};

const seg = (name, options, value, onPick, { wide = false } = {}) =>
  h(
    'div',
    { class: 'seg' + (wide ? ' wide' : ''), role: 'radiogroup', 'aria-label': name },
    options.map(([v, label]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(v === value), onClick: () => onPick(v) }, label))
  );

const renderBar = () => {
  const bar = h(
    'header',
    { class: 'bar' },
    h('div', { class: 'brand' }, h('img', { src: '/favicon.svg', alt: '', width: 32, height: 32 }), h('span', null, t('appName'))),
    seg(t('theme'), [['system', t('themeSystem')], ['light', t('themeLight')], ['dark', t('themeDark')]], prefs.theme, (v) => {
      prefs.theme = v;
      if (v === 'system') delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = v;
      save();
      refreshTiles();
    }),
    h(
      'button',
      {
        class: 'btn quiet',
        type: 'button',
        lang: getLang() === 'ar' ? 'en' : 'ar',
        onClick: () => {
          prefs.lang = getLang() === 'ar' ? 'en' : 'ar';
          setLang(prefs.lang);
          save();
          for (const j of state.pending.jsons) rescan(j, j.scan.fields || {}, langOf(j));
          renderAll();
        }
      },
      getLang() === 'ar' ? 'English' : 'العربية'
    ),
    h('button', { class: 'btn icon quiet', type: 'button', 'aria-label': t('settings'), title: t('settings'), onClick: openSettings }, icon('settings'))
  );
  return bar;
};

const sproutGrid = () => {
  const hues = [48, 52, 44, 56, 252, 150, 300, 8, 196, 84, 330, 120];
  const lights = [0.66, 0.68, 0.64, 0.7, 0.66, 0.66, 0.66, 0.66, 0.66, 0.66, 0.66, 0.66];
  const grid = h('div', { class: 'sprouts bloom', 'aria-hidden': 'true' });
  hues.forEach((hue, i) => {
    const base = tintFromOklch(0.13, (hue * Math.PI) / 180);
    const art = tile(null, { size: 100, mask: leafMask, tint: base });
    const wrap = h('div', { style: { '--i': i } }, art);
    grid.append(wrap);
    void lights[i];
  });
  return grid;
};

const pendingChips = () => {
  const chips = [];
  state.pending.files.forEach((f, i) => chips.push(h('span', { class: 'chip' }, f.name, h('button', { type: 'button', 'aria-label': t('close'), onClick: () => { state.pending.files.splice(i, 1); renderMain(); } }, icon('close', { size: 14 })))));
  return chips.length ? h('div', { class: 'chips' }, chips) : null;
};

const langOf = (json) => json.lang || getLang();

const scanPanel = (json, index) => {
  const s = json.scan;
  const panel = h('div', { class: 'scan' });
  if (s.kind === 'none') {
    panel.append(h('h3', null, json.name), h('p', { class: 'hint-text' }, t('scanNone')));
    return panel;
  }
  panel.append(h('h3', null, t('scanFound', { n: s.count, label: s.kind === 'launcher' ? t('scanLauncher') : s.kind === 'fihrist' ? t('scanFihrist') : s.label }) + ' · ' + json.name));
  if (s.kind === 'generic') {
    const select = (label, key, options, value, allowNone) =>
      h(
        'div',
        { class: 'field' },
        h('label', null, label),
        h(
          'select',
          {
            onChange: (e) => {
              const v = e.target.value === '' ? null : e.target.value;
              const f = { ...s.fields, [key]: v };
              if (key === 'collection') {
                delete f.urlField;
                delete f.iconField;
                delete f.nameField;
                rescan(json, { collection: v }, langOf(json));
              } else rescan(json, f, langOf(json));
              renderMain();
            }
          },
          allowNone ? h('option', { value: '' }, t('scanNoneOption')) : null,
          options.map((o) => h('option', { value: o, selected: o === value }, o || '(root)'))
        )
      );
    panel.append(
      h(
        'div',
        { class: 'scan-grid' },
        s.candidates.collections.length > 1 ? select(t('scanCollection'), 'collection', s.candidates.collections.map((c) => c.path), s.fields.collection, false) : null,
        s.candidates.url.length ? select(t('scanUrl'), 'urlField', s.candidates.url, s.fields.urlField, true) : null,
        s.candidates.icon.length ? select(t('scanIcon'), 'iconField', s.candidates.icon, s.fields.iconField, true) : null,
        s.candidates.name.length ? select(t('scanName'), 'nameField', s.candidates.name, s.fields.nameField, true) : null
      )
    );
  }
  if (s.languages && s.languages.length > 1) {
    panel.append(
      h(
        'div',
        { class: 'field' },
        h('label', { for: 'label-lang-' + index }, t('labelLanguage')),
        h(
          'select',
          {
            id: 'label-lang-' + index,
            onChange: (e) => {
              json.lang = e.target.value || null;
              rescan(json, s.fields || {}, langOf(json));
              renderMain();
            }
          },
          h('option', { value: '', selected: !json.lang }, t('labelLanguageAuto')),
          s.languages.map((l) => h('option', { value: l, selected: l === json.lang }, l))
        )
      )
    );
  }
  panel.append(h('ul', null, s.targets.slice(0, 4).map((x) => h('li', null, h('b', { dir: 'auto' }, x.name || x.key), x.url ? h('span', { dir: 'ltr', class: 'href' }, '  ' + x.url) : null))));
  panel.append(h('div', { class: 'row' }, h('button', { class: 'btn quiet', type: 'button', onClick: () => { state.pending.jsons.splice(index, 1); renderMain(); } }, icon('trash', { size: 16 }), t('close'))));
  return panel;
};

const BUNDLE_RE = /^(atlas|glyph-atlas|glyphs)\.[0-9a-f]{8}\.(webp|svg)$/;
const looksLikeManifest = (data) => !!(data && data.version === 2 && data.icons && typeof data.icons === 'object' && data.atlas);
const baseOf = (file) => String(file || '').split('/').pop();

const manifestNeeds = () => {
  const m = state.pending.bundle.manifest;
  if (!m) return null;
  const wanted = [m.data.atlas && baseOf(m.data.atlas.file), m.data.glyphAtlas && baseOf(m.data.glyphAtlas.file), m.data.glyphSprite && baseOf(m.data.glyphSprite.file)].filter(Boolean);
  const missing = wanted.filter((f) => !state.pending.bundle.files.has(f));
  const atlasMissing = !!(m.data.atlas && !state.pending.bundle.files.has(baseOf(m.data.atlas.file)));
  return { missing, atlasMissing, count: Object.keys(m.data.icons).length };
};

const manifestPanel = () => {
  const need = manifestNeeds();
  if (!need) return null;
  return h(
    'div',
    { class: 'scan', id: 'manifest-panel' },
    h('h3', null, t('manifestFound', { n: need.count }) + ' · ' + state.pending.bundle.manifest.name),
    need.missing.length ? h('p', { class: 'hint-text' }, need.missing.map((f) => t('manifestNeed', { file: f })).join(' ')) : h('p', { class: 'hint-text' }, t('manifestReady')),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', id: 'open-set', type: 'button', disabled: need.atlasMissing, onClick: openManifest }, t('manifestOpen')), h('button', { class: 'btn quiet', type: 'button', onClick: () => { state.pending.bundle = { manifest: null, files: new Map() }; renderMain(); } }, icon('trash', { size: 16 }), t('close')))
  );
};

const openManifest = async () => {
  const b = state.pending.bundle;
  state.error = null;
  state.stage = 'busy';
  state.busyKeys = null;
  state.ghosts = Object.keys(b.manifest.data.icons).length;
  state.progress = { done: 0, total: 1, phase: 'fetch' };
  renderMain();
  try {
    const files = {};
    for (const [name, f] of b.files) files[name] = new Uint8Array(await f.arrayBuffer());
    await client.call('configure', { wasmBase: '/wasm/', settings: await proxySettings() });
    const result = await client.call('importManifest', { manifest: b.manifest.data, files });
    state.seed = result.seed || DEFAULT_SEED;
    state.cell = result.cell;
    state.target = result.v4 ? 'v4' : 'v3';
    prefs.mode = 'follow';
    save();
    adopt(result, (k) => k);
    enterWork();
  } catch (e) {
    state.stage = 'intake';
    state.error = t('manifestFailed', { why: e.message || String(e) });
    renderMain();
  }
};

const addFiles = async (files) => {
  state.error = null;
  for (const f of files) {
    if (BUNDLE_RE.test(f.name)) state.pending.bundle.files.set(f.name, f);
    else if (isJsonFile(f)) {
      try {
        const j = await readJsonFile(f, getLang());
        if (looksLikeManifest(j.data)) state.pending.bundle.manifest = j;
        else state.pending.jsons.push(j);
      } catch {
        state.error = t('badJson') + ' ' + f.name;
      }
    } else if (isImageFile(f)) state.pending.files.push(f);
  }
  renderMain();
};

const startHarvest = async () => {
  state.pending.urlText = (document.getElementById('urls') || { value: state.pending.urlText }).value;
  const count = pendingCount(state.pending);
  if (!count) {
    state.error = t('noInput');
    renderMain();
    return;
  }
  state.error = null;
  let targets = await buildTargets(state.pending);
  const duplicates = findDuplicates(targets);
  if (duplicates.length) {
    const choice = await askDuplicates(duplicates, targets.length);
    if (choice === 'cancel') {
      renderMain();
      return;
    }
    if (choice === 'once') targets = dropDuplicates(targets);
  }
  state.names = new Map(targets.map((x) => [x.key, x.name || x.key]));
  state.stage = 'busy';
  state.ghosts = targets.length;
  state.busyKeys = targets.map((x) => x.key);
  state.progress = { done: 0, total: targets.length, phase: 'fetch' };
  renderMain();
  try {
    await client.call('configure', { wasmBase: '/wasm/', settings: await proxySettings() });
    state.seed = state.seed || DEFAULT_SEED;
    state.target = prefs.target === 'v4' ? 'v4' : 'v3';
    const result = await client.call('harvest', { targets, target: state.target, seed: state.seed, mode: prefs.mode, cell: state.cell || undefined, faFallback: prefs.faFallback, pins: state.pins }, {
      onProgress: (p) => {
        if (p.phase === 'tile') {
          streamTile(p);
          return;
        }
        state.progress = p;
        updateProgress();
      }
    });
    if (!result.records.some((r) => r.favicon)) {
      const why = (result.items.find((i) => i.error) || {}).error || t('statusNotfound');
      state.stage = 'intake';
      state.error = t('harvestFailed', { why }) + (/proxy|token|fetch/i.test(why) ? ' ' + t('proxyNeeded') : '');
      renderMain();
      return;
    }
    const names = new Map(targets.map((x) => [x.key, x]));
    state.cell = null;
    state.polish = result.polish || null;
    adopt(result, (k) => (names.get(k) || {}).name || k);
    enterWork(prefs.mode === 'separate');
    const unreached = result.items.filter((i) => i.error && /needs the fetch proxy/.test(i.error)).length;
    if (unreached) toast(t('proxyMissingSome', { n: unreached }));
  } catch (e) {
    state.stage = 'intake';
    const why = e.message || String(e);
    state.error = t('harvestFailed', { why }) + (/proxy/i.test(why) ? ' ' + t('proxyNeeded') : '');
    renderMain();
  }
};

const streamQueue = [];
let streamFrame = 0;

const flushStream = () => {
  streamFrame = 0;
  const cells = document.querySelectorAll('.work .gallery > li > .cell[data-busy-key]');
  const byKey = new Map([...cells].map((c) => [c.dataset.busyKey, c]));
  for (const p of streamQueue.splice(0)) {
    const cell = byKey.get(p.key);
    const ghost = cell && cell.querySelector('.tile-art.ghost');
    if (!ghost) continue;
    const url = URL.createObjectURL(new Blob([p.favicon], { type: 'image/png' }));
    const el = tile({ faviconUrl: url });
    el.querySelector('img').addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
    ghost.replaceWith(el);
  }
};

const streamTile = (p) => {
  streamQueue.push(p);
  if (!streamFrame) streamFrame = requestAnimationFrame(flushStream);
};

const updateProgress = () => {
  const bar = document.querySelector('.progress i');
  const text = document.querySelector('.progress-text');
  if (!state.progress || !bar) return;
  const { done, total, phase, pending } = state.progress;
  const share = phase === 'trace' ? 0.5 + (done / total) * 0.5 : (done / total) * 0.5;
  bar.style.width = Math.round(share * 100) + '%';
  const waiting = phase === 'fetch' && pending && pending.length && pending.length === total - done ? pending.map((k) => (state.names && state.names.get(k)) || k) : [];
  text.textContent = waiting.length ? t('fetchingWaiting', { done, total, names: waiting.join(', ') }) : t(phase === 'trace' ? 'tracing' : 'fetching', { done, total });
  bar.parentElement.setAttribute('aria-valuenow', String(Math.round(share * 100)));
  bar.parentElement.setAttribute('aria-valuetext', text.textContent);
};

const ago = (ms) => {
  const mins = Math.round((Date.now() - ms) / 60000);
  const rtf = new Intl.RelativeTimeFormat(getLang(), { numeric: 'auto' });
  if (mins < 60) return rtf.format(-Math.max(mins, 0), 'minute');
  if (mins < 1440) return rtf.format(-Math.round(mins / 60), 'hour');
  return rtf.format(-Math.round(mins / 1440), 'day');
};

const recentsPanel = () => {
  if (!state.projects.length) return null;
  return h(
    'section',
    { class: 'recents', 'aria-labelledby': 'recents-title' },
    h('h2', { id: 'recents-title' }, t('projectsTitle')),
    h(
      'ul',
      null,
      state.projects.map((p) =>
        h(
          'li',
          null,
          h('button', { class: 'recent', type: 'button', dataset: { id: p.id }, onClick: () => openProject(p), 'aria-label': t('projectOpen') + ' ' + p.name }, h('span', { class: 'dots', 'aria-hidden': 'true' }, (p.dots || []).map((c) => h('i', { style: { background: c } }))), h('span', { class: 'rname' }, p.name || t('projectsTitle')), h('small', null, t('projectIcons', { n: p.count }) + ' · ' + ago(p.updatedAt))),
          h('button', { class: 'btn icon quiet', type: 'button', 'aria-label': t('projectDelete', { name: p.name }), onClick: async () => { await removeProject(p.id); state.projects = await listProjects(); if (state.stage === 'intake') renderMain(); } }, icon('trash', { size: 16 }))
        )
      )
    ),
    h('p', { class: 'hint-text' }, t('projectsNote'))
  );
};

const openProject = async (meta) => {
  const payload = await loadProject(meta.id);
  if (!payload) {
    state.error = t('projectOpenFailed');
    renderMain();
    return;
  }
  state.error = null;
  state.stage = 'busy';
  state.busyKeys = null;
  state.ghosts = payload.records.length;
  state.progress = { done: 0, total: 1, phase: 'fetch' };
  renderMain();
  try {
    await client.call('configure', { wasmBase: '/wasm/', settings: await proxySettings() });
    await client.call('restore', { records: payload.records });
    Object.assign(prefs, payload.settings || {});
    prefs.paletteColors = cleanPalette(prefs.paletteColors).length ? cleanPalette(prefs.paletteColors) : ['#f0475c'];
    save();
    state.seed = payload.seed || DEFAULT_SEED;
    state.target = payload.target === 'v4' ? 'v4' : 'v3';
    state.polish = payload.polish || null;
    state.cell = payload.cell || null;
    state.pins = payload.pins && typeof payload.pins === 'object' ? payload.pins : {};
    adopt({ records: payload.records, items: payload.items }, (k) => (payload.items.find((i) => i.key === k) || {}).name || k);
    state.selected = payload.selected && state.records.has(payload.selected) ? payload.selected : null;
    state.stage = 'work';
    state.bloom = true;
    state.dirty = true;
    launcherBuild = null;
    state.projectId = meta.id;
    state.projectName = meta.name;
    renderAll();
  } catch (e) {
    state.stage = 'intake';
    state.error = t('projectOpenFailed') + ': ' + (e.message || e);
    renderMain();
  }
};

const targetPanel = () =>
  h(
    'div',
    { class: 'target-pick', id: 'target-pick' },
    h('span', null, t('targetTitle')),
    seg(t('targetTitle'), [['v3', t('targetV3')], ['v4', t('targetV4')]], prefs.target, (v) => { prefs.target = v; save(); renderMain(); }),
    h('p', { class: 'hint-text' }, prefs.target === 'v4' ? t('targetV4Hint') : t('targetV3Hint'))
  );

const renderIntake = () => {
  const urlText = state.pending.urlText;
  const count = pendingCount(state.pending);
  const over = (on) => (e) => {
    e.preventDefault();
    e.currentTarget.classList.toggle('over', on);
  };
  const drop = h(
    'div',
    {
      class: 'drop',
      onDragenter: over(true),
      onDragover: over(true),
      onDragleave: over(false),
      onDrop: async (e) => {
        e.preventDefault();
        e.currentTarget.classList.remove('over');
        await addFiles(await filesFromDrop(e.dataTransfer));
      }
    },
    icon('upload', { size: 26 }),
    h('strong', null, t('dropTitle')),
    h('span', { class: 'hint' }, t('dropBody')),
    h(
      'div',
      { class: 'row', style: { 'justify-content': 'center', 'margin-top': '6px' } },
      h('button', { class: 'btn', type: 'button', onClick: () => document.getElementById('pick-files').click() }, icon('image', { size: 16 }), t('browseFiles')),
      h('button', { class: 'btn', type: 'button', onClick: () => document.getElementById('pick-folder').click() }, icon('folder', { size: 16 }), t('browseFolder'))
    ),
    h('input', { id: 'pick-files', type: 'file', multiple: true, accept: 'image/*,.ico,.svg,.json,application/json', class: 'sr', tabindex: -1, onChange: (e) => { addFiles([...e.target.files]); e.target.value = ''; } }),
    h('input', { id: 'pick-folder', type: 'file', webkitdirectory: true, class: 'sr', tabindex: -1, onChange: (e) => { addFiles([...e.target.files]); e.target.value = ''; } })
  );
  const label = count === 0 ? t('harvest') : count === 1 ? t('harvestOne') : t('harvestN', { n: count });
  const hero = h(
    'section',
    { class: 'hero' },
    h(
      'div',
      null,
      h('h1', null, t('heroTitle')),
      h('p', { class: 'lede' }, t('heroBody')),
      h(
        'div',
        { class: 'intake' },
        setButtons(),
        h(
          'form',
          { class: 'field', onSubmit: (e) => { e.preventDefault(); startHarvest(); } },
          h('label', { for: 'urls' }, t('urlLabel')),
          h(
            'div',
            { class: 'url-row' },
            h('textarea', { id: 'urls', rows: 1, placeholder: t('urlPlaceholder'), spellcheck: false, autocapitalize: 'off', autocomplete: 'off', inputmode: 'url', value: urlText, onInput: (e) => { state.pending.urlText = e.target.value; refreshHarvestLabel(); }, onKeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); startHarvest(); } } }),
            h('button', { class: 'btn primary', id: 'go', type: 'submit' }, label)
          )
        ),
        drop,
        pendingChips(),
        manifestPanel(),
        targetPanel(),
        state.pending.jsons.map(scanPanel),
        state.pending.jsons.some((j) => j.scan.kind === 'launcher') ? h('label', { class: 'check', id: 'fa-fallback' }, h('input', { type: 'checkbox', checked: prefs.faFallback, onChange: (e) => { prefs.faFallback = e.target.checked; save(); } }), t('faFallback')) : null,
        state.error ? h('div', { class: 'note bad', role: 'alert' }, state.error) : null,
        recentsPanel()
      )
    ),
    sproutGrid()
  );
  hero.querySelector('textarea').value = urlText;
  return hero;
};

const launcherSet = () => {
  const c = state.catalogue;
  const scan = scanJson(c.data, {}, getLang());
  scan.targets = mergeTargets(scan.targets, c.extras);
  scan.count = scan.targets.length;
  return { name: 'catalogue.json', data: c.data, scan };
};

const fihristSet = () => ({ name: 'fihrist.json', data: state.fihrist.data, scan: scanJson(state.fihrist.data, {}, getLang()) });

const harvestSets = (which) => {
  const sets = [];
  if ((which === 'launcher' || which === 'both') && state.catalogue) sets.push(launcherSet());
  if ((which === 'fihrist' || which === 'both') && state.fihrist) sets.push(fihristSet());
  if (!sets.length) return;
  state.pending.jsons = sets;
  startHarvest();
};

const setButtons = () => {
  const buttons = [];
  if (state.catalogue) buttons.push(h('button', { class: 'btn primary catalogue', id: 'harvest-catalogue', type: 'button', onClick: () => harvestSets('launcher') }, icon('folder', { size: 16 }), t('harvestCatalogue', { n: state.catalogue.count })));
  if (state.fihrist) buttons.push(h('button', { class: 'btn', id: 'harvest-fihrist', type: 'button', onClick: () => harvestSets('fihrist') }, icon('folder', { size: 16 }), t('harvestFihrist', { n: state.fihrist.count })));
  if (state.catalogue && state.fihrist) buttons.push(h('button', { class: 'btn', id: 'harvest-both', type: 'button', onClick: () => harvestSets('both') }, icon('folder', { size: 16 }), t('harvestBoth', { n: state.catalogue.count + state.fihrist.count })));
  return buttons.length ? h('div', { class: 'sets' }, buttons) : null;
};

const askDuplicates = (groups, total) =>
  new Promise((resolve) => {
    const extra = groups.reduce((n, g) => n + g.entries.length - 1, 0);
    const dlg = h('dialog', { 'aria-labelledby': 'dup-title', id: 'dup-dialog' });
    let choice = 'cancel';
    const pick = (value) => () => {
      choice = value;
      dlg.close();
    };
    const shown = groups.slice(0, 8);
    dlg.append(
      h(
        'div',
        { class: 'dlg' },
        h('header', null, h('h2', { id: 'dup-title' }, t('dupTitle', { n: groups.length }))),
        h('p', { class: 'hint-text' }, t('dupBody', { n: groups.length, extra, total })),
        h(
          'ul',
          { class: 'dups' },
          shown.map((g) => h('li', null, h('b', { dir: 'auto' }, g.entries.map((e) => e.name).join(' = ')), h('span', { class: 'href', dir: 'ltr' }, g.url))),
          groups.length > shown.length ? h('li', { class: 'more' }, t('dupMore', { n: groups.length - shown.length })) : null
        ),
        h(
          'div',
          { class: 'actions-end' },
          h('button', { class: 'btn quiet', id: 'dup-cancel', type: 'button', onClick: pick('cancel') }, t('dupCancel')),
          h('button', { class: 'btn', id: 'dup-keep', type: 'button', onClick: pick('keep') }, t('dupKeep', { n: total })),
          h('button', { class: 'btn primary', id: 'dup-once', type: 'button', onClick: pick('once') }, t('dupOnce', { n: total - extra }))
        )
      )
    );
    dlg.addEventListener('close', () => {
      dlg.remove();
      resolve(choice);
    });
    document.body.append(dlg);
    dlg.showModal();
  });

const refreshHarvestLabel = () => {
  const go = document.getElementById('go');
  if (!go) return;
  const n = pendingCount(state.pending);
  go.textContent = n === 0 ? t('harvest') : n === 1 ? t('harvestOne') : t('harvestN', { n });
};

const renderBusy = () =>
  h(
    'section',
    { class: 'work', style: { display: 'block' } },
    h('div', { class: 'row', style: { 'margin-bottom': '14px' } }, h('div', { style: { flex: 1 } }, h('div', { class: 'progress', role: 'progressbar', 'aria-label': t('working'), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, h('i')), h('div', { class: 'progress-text' }, t('working')))),
    h('div', { class: 'stage' }, h('ul', { class: 'gallery' }, Array.from({ length: state.ghosts }, (_, i) => h('li', null, h('div', { class: 'cell', dataset: state.busyKeys && state.busyKeys[i] ? { busyKey: state.busyKeys[i] } : {} }, h('span', { class: 'tile-art ghost' }), h('span', { class: 'name' }, ' '))))))
  );

const contrastFlag = (rec) => (rec.contrast === 'flagged' ? 'bad' : rec.status === 'default' || rec.status === 'stale' || rec.status === 'blocked' ? 'warn' : null);

const cellEl = (rec, i) => {
  const flag = contrastFlag(rec);
  return h(
    'li',
    { style: { '--i': i } },
    h(
      'button',
      { class: 'cell', type: 'button', role: 'option', 'aria-selected': String(state.selected === rec.key), dataset: { key: rec.key, renderId: String(++renderSeq) }, 'aria-label': t('tileAria', { name: rec.name, status: t(statusKey(rec.status)) }), onClick: () => select(rec.key) },
      rec.hasImage ? tile(rec) : h('span', { class: 'tile-art ghost', style: rec.ghost ? {} : { animation: 'none' } }),
      h('span', { class: 'name', dir: 'auto' }, rec.name),
      flag ? h('span', { class: 'flag ' + flag, title: reasonOf(rec) }, icon('warn', { size: 11, stroke: 2.4 })) : null
    )
  );
};

const reasonOf = (rec) => {
  if (rec.contrast === 'flagged') return t('contrastFlagged');
  if (rec.contrast === 'nudged') return t('contrastNudged');
  if (rec.tight) return t('tight');
  return t(statusKey(rec.status));
};

const select = (key) => {
  state.selected = key;
  document.querySelectorAll('.cell').forEach((c) => c.setAttribute('aria-selected', String(c.dataset.key === key)));
  renderInspector();
  if (matchMedia('(max-width: 979px)').matches) {
    const el = document.getElementById('inspector');
    if (el) el.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
};

const gridKeys = (e) => {
  const cells = [...document.querySelectorAll('.cell')];
  const i = cells.indexOf(document.activeElement);
  if (i < 0) return;
  const rtl = getLang() === 'ar';
  const cols = Math.max(1, Math.round(cells[0].parentElement.parentElement.clientWidth / cells[0].clientWidth));
  const move = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
  if (!move) return;
  const next = cells[Math.max(0, Math.min(cells.length - 1, i + move))];
  e.preventDefault();
  next.focus();
  select(next.dataset.key);
};

const stats = () => {
  const list = [...state.records.values()].filter((r) => r.hasImage);
  const glyphs = list.filter((r) => r.mask).length;
  const review = [...state.records.values()].filter((r) => contrastFlag(r) || (!r.hasImage && !r.ghost)).length;
  return { n: list.length, glyphs, review };
};

const imaged = () => [...state.records.values()].filter((r) => r.hasImage);

const similarNow = () => similarPairs(imaged().filter((r) => r.tint), new Map(imaged().filter((r) => r.groupId).map((r) => [r.key, r.groupId])));

const polishRows = () => {
  const list = imaged();
  const raster = list.filter((r) => r.trace && !r.trace.accepted).length;
  const flagged = list.filter((r) => r.contrast === 'flagged').length;
  const pairs = similarNow().length;
  const p = state.polish;
  return [
    { id: 'safe', ok: !p || p.safeArea >= 0.95, text: t('polishSafe', { p: p ? Math.round(p.safeArea * 100) : 100 }) },
    { id: 'rounded', ok: !p || p.rounded === 1, text: t('polishRounded', { p: p ? Math.round(p.rounded * 100) : 100 }) },
    { id: 'pairs', ok: pairs === 0, text: t('polishPairs', { n: pairs }) },
    { id: 'raster', ok: raster === 0, text: t('polishRaster', { n: raster }) },
    { id: 'contrast', ok: flagged === 0, text: t('polishContrast', { n: flagged }) }
  ];
};

const previewStrip = (colors, tone) => h('div', { class: 'pstrip ' + tone, role: 'group', 'aria-label': t(colors === 'vivid' ? 'vivid' : 'muted') + ', ' + t(tone === 'dark' ? 'themeDark' : 'themeLight') }, imaged().map((r) => tile(r, { size: 36, colors, theme: tone })));

const openPolish = () => {
  const dlg = h('dialog', { 'aria-labelledby': 'pol-title', id: 'polish-dialog' });
  const rows = polishRows();
  const body = h(
    'div',
    { class: 'dlg' },
    h('header', null, h('h2', { id: 'pol-title' }, t('polishTitle')), h('button', { class: 'btn icon quiet', type: 'button', 'aria-label': t('close'), onClick: () => dlg.close() }, icon('close'))),
    h('ul', { class: 'checklist' }, rows.map((r) => h('li', { 'data-id': r.id, class: r.ok ? 'ok' : 'warn' }, icon(r.ok ? 'check' : 'warn', { size: 16 }), h('span', null, r.text)))),
    h('h3', { class: 'label' }, t('polishPreview')),
    ...['vivid', 'muted'].flatMap((c) => ['light', 'dark'].map((tone) => h('div', { class: 'pstrip-row' }, h('span', { class: 'label' }, t(c) + ' · ' + t(tone === 'dark' ? 'themeDark' : 'themeLight')), previewStrip(c, tone))))
  );
  dlg.append(body);
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
};

const existingUrls = () => new Map([...state.records.keys()].map((k) => [k, (state.items.get(k) || {}).url || null]));

const galleryEl = () => document.querySelector('.gallery');

const placeCell = (rec) => {
  const gallery = galleryEl();
  if (!gallery) return;
  const old = gallery.querySelector('.cell[data-key="' + CSS.escape(rec.key) + '"]');
  const li = cellEl(rec, 0);
  li.style.removeProperty('--i');
  if (old) {
    old.parentElement.replaceWith(li);
    return;
  }
  const next = [...gallery.querySelectorAll('.cell')].find((c) => c.dataset.key > rec.key);
  if (next) gallery.insertBefore(li, next.parentElement);
  else gallery.append(li);
};

const dropCell = (key) => {
  const gallery = galleryEl();
  const old = gallery && gallery.querySelector('.cell[data-key="' + CSS.escape(key) + '"]');
  if (old) old.parentElement.remove();
};

const ghostFor = (t) => ({ key: t.key, appId: t.appId || t.key, status: 'pending', hasImage: false, ghost: true, name: t.name || t.key, base: null, tint: null, locked: false, trace: null });

const askCollisions = (same) =>
  new Promise((resolve) => {
    const dlg = h('dialog', { 'aria-labelledby': 'col-title', id: 'collide-dialog' });
    let choice = 'skip';
    const pick = (v) => () => {
      choice = v;
      dlg.close();
    };
    const shown = same.slice(0, 8);
    dlg.append(
      h(
        'div',
        { class: 'dlg' },
        h('header', null, h('h2', { id: 'col-title' }, t('collideTitle'))),
        h('p', { class: 'hint-text' }, t('collideBody', { n: same.length })),
        h('ul', { class: 'dups' }, shown.map((x) => h('li', null, h('b', { dir: 'auto' }, x.name || x.key), x.url ? h('span', { class: 'href', dir: 'ltr' }, x.url) : null))),
        h(
          'div',
          { class: 'actions-end' },
          h('button', { class: 'btn quiet', id: 'collide-skip', type: 'button', onClick: pick('skip') }, t('collideSkip')),
          h('button', { class: 'btn', id: 'collide-both', type: 'button', onClick: pick('both') }, t('collideBoth')),
          h('button', { class: 'btn primary', id: 'collide-update', type: 'button', onClick: pick('update') }, t('collideUpdate'))
        )
      )
    );
    dlg.addEventListener('close', () => {
      dlg.remove();
      resolve(choice);
    });
    document.body.append(dlg);
    dlg.showModal();
  });

const runAdd = async (targets, updating) => {
  state.adding += 1;
  refreshAddBar();
  const names = new Map(targets.map((x) => [x.key, x.name || x.key]));
  try {
    await client.call('configure', { wasmBase: '/wasm/', settings: await proxySettings() });
    const result = await client.call('add', { targets, target: state.target, seed: state.seed, mode: prefs.mode, cell: state.cell || undefined, faFallback: prefs.faFallback, pins: state.pins }, {
      onProgress: (p) => {
        if (p.phase !== 'tile') return;
        const rec = state.records.get(p.key);
        if (!rec || !rec.ghost) return;
        rec.faviconUrl = URL.createObjectURL(new Blob([p.favicon], { type: 'image/png' }));
        rec.hasImage = true;
        placeCell(rec);
        refreshPairs();
      }
    });
    const before = new Map(updating.map((x) => [x.key, state.records.get(x.key)]));
    const added = [];
    for (const item of result.items) {
      const prev = state.items.get(item.key) || {};
      state.items.set(item.key, { ...prev, ...item, name: names.get(item.key) || prev.name || item.key });
    }
    for (const payload of result.records) {
      const name = names.get(payload.key) || payload.key;
      const fresh = decodeRecord(payload, { name });
      fresh.name = name;
      const old = before.get(payload.key);
      if (old && old.locked && old.tint) {
        fresh.locked = true;
        fresh.tint = old.tint;
      }
      state.records.set(payload.key, fresh);
      added.push(payload.key);
    }
    for (const t of targets) if (!state.records.get(t.key) || state.records.get(t.key).ghost) state.records.set(t.key, { ...ghostFor(t), ghost: false, status: 'notfound' });
    applyColours(new Set(added.filter((k) => !(before.get(k) && before.get(k).locked))));
    for (const k of targets.map((x) => x.key)) {
      const rec = state.records.get(k);
      if (rec) placeCell(rec);
    }
    state.polish = result.polish ? { ...result.polish, safeArea: Math.min(state.polish ? state.polish.safeArea : 1, result.polish.safeArea), rounded: Math.min(state.polish ? state.polish.rounded : 1, result.polish.rounded) } : state.polish;
    state.dirty = true;
    refreshPairs();
    refreshExportCount();
    scheduleSave();
    const found = added.filter((k) => state.records.get(k) && state.records.get(k).hasImage);
    announce(found.length === 1 ? t('addedTile', { name: state.records.get(found[0]).name }) : t('addedBatch', { n: found.length }));
    const unreached = result.items.filter((i) => i.error && /needs the fetch proxy/.test(i.error)).length;
    if (unreached) toast(t('proxyMissingSome', { n: unreached }));
    if (state.selected && state.stage === 'work') renderInspector();
  } catch (e) {
    for (const t of targets) {
      const rec = state.records.get(t.key);
      if (rec && rec.ghost) {
        state.records.delete(t.key);
        state.order = state.order.filter((k) => k !== t.key);
        dropCell(t.key);
      }
    }
    toast(t('addFailed', { why: e.message || String(e) }));
  } finally {
    state.adding -= 1;
    refreshAddBar();
  }
};

const addTargets = async (incoming) => {
  if (!incoming.length) {
    toast(t('addNothing'));
    return;
  }
  const existing = existingUrls();
  const { fresh, same, renamed } = classify(incoming, existing);
  let targets = fresh;
  let updating = [];
  if (same.length) {
    const choice = await askCollisions(same);
    if (choice === 'update') {
      updating = same;
      targets = [...fresh, ...same];
    } else if (choice === 'both') targets = [...fresh, ...keepBoth(same, new Map([...existing, ...fresh.map((x) => [x.key, x.url || null])]))];
  }
  if (!targets.length) return;
  for (const r of renamed) toast(t('renamedNote', { from: r.from, to: r.to }));
  const updatingKeys = new Set(updating.map((x) => x.key));
  for (const x of targets) {
    if (updatingKeys.has(x.key)) continue;
    state.records.set(x.key, ghostFor(x));
    state.items.set(x.key, { key: x.key, name: x.name || x.key, url: x.url || null, status: 'pending', flags: [], attempts: [] });
  }
  state.order = [...state.records.keys()].sort();
  for (const x of targets) {
    if (!updatingKeys.has(x.key)) placeCell(state.records.get(x.key));
  }
  state.chain = state.chain.then(() => runAdd(targets, updating));
  await state.chain;
};

const addFromFiles = async (files) => {
  const pending = { urlText: '', files: [], jsons: [], bundle: { manifest: null, files: new Map() } };
  for (const f of files) {
    if (isJsonFile(f)) {
      try {
        const j = await readJsonFile(f, getLang());
        if (j.scan && j.scan.count > 0) pending.jsons.push(j);
        else toast(t('badJson') + ' ' + f.name);
      } catch {
        toast(t('badJson') + ' ' + f.name);
      }
    } else if (isImageFile(f)) pending.files.push(f);
  }
  if (!pendingCount(pending)) return;
  await addTargets(await buildTargets(pending));
};

const addFromUrls = async (text) => {
  if (!parseUrls(text).length) return false;
  await addTargets(await buildTargets({ urlText: text, files: [], jsons: [], bundle: { manifest: null, files: new Map() } }));
  return true;
};

const addSets = async (which) => {
  const sets = [];
  if ((which === 'launcher' || which === 'both') && state.catalogue) sets.push(launcherSet());
  if ((which === 'fihrist' || which === 'both') && state.fihrist) sets.push(fihristSet());
  const all = await buildTargets({ urlText: '', files: [], jsons: sets, bundle: { manifest: null, files: new Map() } });
  const fresh = notPresent(all, existingUrls());
  if (!fresh.length) {
    toast(t('addNothing'));
    return;
  }
  await addTargets(fresh);
};

const setCount = (which) => {
  const sets = [];
  if ((which === 'launcher' || which === 'both') && state.catalogue) sets.push(launcherSet());
  if ((which === 'fihrist' || which === 'both') && state.fihrist) sets.push(fihristSet());
  const keys = new Set(sets.flatMap((x) => x.scan.targets.map((y) => y.key)));
  return [...keys].filter((k) => !state.records.has(k)).length;
};

const addBar = () => {
  const bar = h('form', { class: 'addbar', id: 'add-bar', role: 'search', 'aria-label': t('addBarLabel'), onSubmit: async (e) => {
    e.preventDefault();
    const input = document.getElementById('add-urls');
    const text = input.value;
    if (!parseUrls(text).length) return;
    input.value = '';
    await addFromUrls(text);
  } });
  bar.append(
    h('div', { class: 'addbar-row' },
      h('input', { id: 'add-urls', type: 'text', placeholder: t('addUrlPlaceholder'), 'aria-label': t('addUrlPlaceholder'), spellcheck: false, autocapitalize: 'off', autocomplete: 'off', inputmode: 'url' }),
      h('button', { class: 'btn primary', id: 'add-go', type: 'submit' }, icon('plus', { size: 16 }), t('add'))
    ),
    h('div', { class: 'addbar-row addbar-actions' },
      h('button', { class: 'btn', id: 'add-files', type: 'button', onClick: () => document.getElementById('add-pick-files').click() }, icon('image', { size: 16 }), t('addFiles')),
      h('button', { class: 'btn', id: 'add-folder', type: 'button', onClick: () => document.getElementById('add-pick-folder').click() }, icon('folder', { size: 16 }), t('addFolder')),
      h('button', { class: 'btn', id: 'add-json', type: 'button', onClick: () => document.getElementById('add-pick-json').click() }, icon('upload', { size: 16 }), t('addJson')),
      state.catalogue ? h('button', { class: 'btn', id: 'add-launcher', type: 'button', onClick: () => addSets('launcher') }, t('addLauncher', { n: setCount('launcher') })) : null,
      state.fihrist ? h('button', { class: 'btn', id: 'add-fihrist', type: 'button', onClick: () => addSets('fihrist') }, t('addFihrist', { n: setCount('fihrist') })) : null,
      state.catalogue && state.fihrist ? h('button', { class: 'btn', id: 'add-both', type: 'button', onClick: () => addSets('both') }, t('addBoth', { n: setCount('both') })) : null,
      h('span', { class: 'adding', id: 'adding', role: 'status' }, state.adding ? t('working') : '')
    ),
    h('input', { id: 'add-pick-files', type: 'file', multiple: true, accept: 'image/*,.ico,.svg', class: 'sr', tabindex: -1, onChange: (e) => { addFromFiles([...e.target.files]); e.target.value = ''; } }),
    h('input', { id: 'add-pick-folder', type: 'file', webkitdirectory: true, class: 'sr', tabindex: -1, onChange: (e) => { addFromFiles([...e.target.files]); e.target.value = ''; } }),
    h('input', { id: 'add-pick-json', type: 'file', multiple: true, accept: '.json,application/json', class: 'sr', tabindex: -1, onChange: (e) => { addFromFiles([...e.target.files]); e.target.value = ''; } })
  );
  return bar;
};

const refreshAddBar = () => {
  const el = document.getElementById('adding');
  if (el) el.textContent = state.adding ? t('working') : '';
  document.body.dataset.adding = String(state.adding);
  for (const [id, which] of [['add-launcher', 'launcher'], ['add-fihrist', 'fihrist'], ['add-both', 'both']]) {
    const b = document.getElementById(id);
    if (b) b.textContent = t(id === 'add-launcher' ? 'addLauncher' : id === 'add-fihrist' ? 'addFihrist' : 'addBoth', { n: setCount(which) });
  }
};

const removeTile = async (rec) => {
  const entry = { payload: recordPayload(rec), item: state.items.get(rec.key), name: rec.name, hadImage: rec.hasImage, rec };
  const index = state.order.indexOf(rec.key);
  state.records.delete(rec.key);
  state.items.delete(rec.key);
  state.order = state.order.filter((k) => k !== rec.key);
  dropCell(rec.key);
  if (state.selected === rec.key) {
    state.selected = state.order[Math.min(index, state.order.length - 1)] || null;
    document.querySelectorAll('.cell').forEach((c) => c.setAttribute('aria-selected', String(c.dataset.key === state.selected)));
    renderInspector();
  }
  await client.call('remove', { key: rec.key });
  refreshPairs();
  refreshExportCount();
  scheduleSave();
  announce(t('removedTile', { name: entry.name }));
  toast(t('removedTile', { name: entry.name }), { label: t('undo'), ms: 8000, onAction: () => restoreTile(entry) });
};

const restoreTile = async (entry) => {
  const rec = entry.rec;
  state.records.set(rec.key, rec);
  if (entry.item) state.items.set(rec.key, entry.item);
  state.order = [...state.records.keys()].sort();
  await client.call('put', { record: entry.payload });
  placeCell(rec);
  refreshPairs();
  refreshExportCount();
  scheduleSave();
  announce(t('restoredTile', { name: entry.name }));
};

const refreshExportCount = () => {
  const el = document.getElementById('export-btn');
  if (el) el.lastChild.textContent = t('exportCount', { n: imaged().length });
  const stat = document.querySelector('.toolbar .stat');
  if (stat) {
    const x = stats();
    stat.replaceChildren(document.createTextNode(t('summary', { n: x.n, g: x.glyphs })), ...(x.review ? [h('small', null, t('review', { n: x.review }))] : []));
  }
};

let overlayDepth = 0;

const dropOverlay = (on) => {
  let el = document.getElementById('drop-overlay');
  if (on && !el) {
    el = h('div', { id: 'drop-overlay', class: 'drop-overlay', role: 'presentation' }, h('div', null, icon('upload', { size: 34 }), h('strong', null, t('dropOverlay'))));
    document.body.append(el);
  }
  if (!on && el) el.remove();
};

const hasFiles = (e) => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');

document.addEventListener('dragenter', (e) => {
  if (state.stage !== 'work' || !hasFiles(e)) return;
  e.preventDefault();
  overlayDepth += 1;
  dropOverlay(true);
});
document.addEventListener('dragover', (e) => {
  if (state.stage !== 'work' || !hasFiles(e)) return;
  e.preventDefault();
});
document.addEventListener('dragleave', (e) => {
  if (state.stage !== 'work') return;
  overlayDepth = Math.max(0, overlayDepth - 1);
  if (!overlayDepth || !e.relatedTarget) {
    overlayDepth = 0;
    dropOverlay(false);
  }
});
document.addEventListener('drop', async (e) => {
  if (state.stage !== 'work') return;
  e.preventDefault();
  overlayDepth = 0;
  dropOverlay(false);
  if (!hasFiles(e)) return;
  await addFromFiles(await filesFromDrop(e.dataTransfer));
});
document.addEventListener('paste', (e) => {
  if (state.stage !== 'work') return;
  const a = document.activeElement;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) return;
  const text = (e.clipboardData && e.clipboardData.getData('text')) || '';
  if (!parseUrls(text).length) return;
  e.preventDefault();
  addFromUrls(text);
});

const renderToolbar = () => {
  const s = stats();
  return h(
    'div',
    { class: 'toolbar' },
    h('input', { class: 'proj-name', type: 'text', value: state.projectName, 'aria-label': t('projectName'), spellcheck: false, onInput: (e) => { state.projectName = e.target.value; scheduleSave(); } }),
    h('div', { class: 'stat' }, t('summary', { n: s.n, g: s.glyphs }), s.review ? h('small', null, t('review', { n: s.review })) : null),
    h('button', { class: 'btn quiet pairs', id: 'pairs', type: 'button', 'data-pairs': String(similarNow().length), onClick: openPolish }, icon(similarNow().length ? 'warn' : 'check', { size: 16 }), t('similarPairs', { n: similarNow().length })),
    h('div', { class: 'spacer pv' }, h('span', null, t('previewColors')), seg(t('previewColors'), [['vivid', t('vivid')], ['muted', t('muted')]], prefs.colors, (v) => { prefs.colors = v; save(); renderMain(); })),
    h('div', { class: 'pv' }, h('span', null, t('previewCorners')), seg(t('previewCorners'), [['balanced', t('balanced')], ['soft', t('soft')], ['crisp', t('crisp')]], prefs.corners, (v) => { prefs.corners = v; applyCorners(); save(); renderMain(); })),
    h('button', { class: 'btn primary', id: 'export-btn', type: 'button', onClick: openExport }, icon('download', { size: 18 }), t('exportCount', { n: s.n }))
  );
};

const applyCorners = () => {
  if (prefs.corners === 'balanced') delete document.documentElement.dataset.corners;
  else document.documentElement.dataset.corners = prefs.corners;
};

const renderWork = () => {
  const gallery = h('ul', { class: 'gallery', role: 'listbox', 'aria-label': t('galleryLabel'), onKeydown: gridKeys });
  state.order.forEach((k, i) => gallery.append(cellEl(state.records.get(k), i)));
  const work = h(
    'section',
    { class: 'work' },
    h('div', null, addBar(), renderToolbar(), h('div', { class: 'stage' + (state.bloom ? ' bloom' : '') }, gallery), h('div', { class: 'row', style: { 'margin-top': '14px' } }, h('button', { class: 'btn quiet', type: 'button', onClick: startOver }, icon('reset', { size: 16 }), t('startOver')))),
    h('aside', { class: 'inspector', id: 'inspector' })
  );
  if (state.bloom) setTimeout(() => document.querySelectorAll('.stage.bloom').forEach((el) => el.classList.remove('bloom')), 1900);
  state.bloom = false;
  return work;
};

const confirmStartOver = () =>
  new Promise((resolve) => {
    const dlg = h('dialog', { 'aria-labelledby': 'so-title', id: 'startover-dialog' });
    let ok = false;
    dlg.append(
      h(
        'div',
        { class: 'dlg' },
        h('header', null, h('h2', { id: 'so-title' }, t('startOverTitle'))),
        h('p', { class: 'hint-text' }, t('startOverBody')),
        h('div', { class: 'actions-end' },
          h('button', { class: 'btn quiet', id: 'startover-cancel', type: 'button', onClick: () => dlg.close() }, t('dupCancel')),
          h('button', { class: 'btn primary', id: 'startover-ok', type: 'button', onClick: () => { ok = true; dlg.close(); } }, t('startOverConfirm'))
        )
      )
    );
    dlg.addEventListener('close', () => {
      dlg.remove();
      resolve(ok);
    });
    document.body.append(dlg);
    dlg.showModal();
  });

const startOver = async () => {
  if (state.unsaved && !(await confirmStartOver())) return;
  clearTimeout(saveTimer);
  const saving = state.projectId && state.stage === 'work' && state.records.size ? writeProject() : Promise.resolve();
  state.stage = 'intake';
  state.pending = { urlText: '', files: [], jsons: [], bundle: { manifest: null, files: new Map() } };
  state.records = new Map();
  state.items = new Map();
  state.order = [];
  state.projectId = null;
  state.unsaved = false;
  state.error = null;
  client.call('restore', { records: [] });
  renderMain();
  await saving;
  if (state.stage === 'intake') renderMain();
};

const refreshTiles = () => {
  refreshPairs();
  document.querySelectorAll('.cell').forEach((c) => {
    const rec = state.records.get(c.dataset.key);
    if (!rec || !rec.hasImage) return;
    const fresh = tile(rec);
    c.firstElementChild.replaceWith(fresh);
    const flag = contrastFlag(rec);
    const old = c.querySelector('.flag');
    if (old) old.remove();
    if (flag) c.append(h('span', { class: 'flag ' + flag, title: reasonOf(rec) }, icon('warn', { size: 11, stroke: 2.4 })));
  });
  if (state.stage === 'work') renderInspector();
};

const MODES = () => [['separate', t('modeSeparate')], ['follow', t('modeFollow')], ['mono', t('modeMono')], ['palette', t('modePalette')], ['family', t('modeFamily')], ['keep', t('modeKeep')]];
const MODE_HINT = { separate: 'modeSeparateHint', follow: 'modeFollowHint', mono: 'modeMonoHint', palette: 'modePaletteHint', family: 'modeFamilyHint', keep: 'modeKeepHint' };

const colourPanel = () => {
  const panel = h('section', { class: 'panel' }, h('h2', null, t('colours')), seg(t('colours'), MODES(), prefs.mode, (v) => { prefs.mode = v; save(); applyColours(); refreshTiles(); }, { wide: true }), h('p', { class: 'hint-text' }, t(MODE_HINT[prefs.mode])));
  if (prefs.mode === 'follow' || prefs.mode === 'family') {
    if (prefs.mode === 'follow') {
      panel.append(
        h('div', { class: 'range' }, h('label', { class: 'label', for: 'spread' }, t('spread')), h('input', { id: 'spread', type: 'range', min: 0, max: 1.6, step: 0.1, value: prefs.spread, onInput: (e) => { prefs.spread = Number(e.target.value); applyColours(); refreshTilesOnly(); }, onChange: save }))
      );
    }
    panel.append(h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onClick: () => { state.seed = randomSeed(); applyColours(); refreshTiles(); toast(t('shuffled')); } }, icon('shuffle', { size: 16 }), t('shuffle'))));
  }
  if (prefs.mode === 'mono') {
    const presets = ['#f0475c', '#ff8a3d', '#ffc247', '#3fb97a', '#2fa8c9', '#4c7df0', '#8c5cf0', '#c455b8'];
    const apply = (hex) => { prefs.monoColor = hex; save(); applyColours(); refreshTilesOnly(); const pk = document.getElementById('mono-picker'); if (pk) pk.value = hex; };
    panel.append(
      h(
        'div',
        { class: 'colour-row' },
        h('label', { class: 'picker', style: { background: prefs.monoColor } }, h('span', { class: 'sr' }, t('pickColour')), h('input', { id: 'mono-picker', type: 'color', value: prefs.monoColor, onInput: (e) => apply(e.target.value) })),
        h('div', { class: 'swatches' }, presets.map((p) => h('button', { class: 'sw', type: 'button', style: { background: p }, 'aria-label': p, 'aria-pressed': String(p === prefs.monoColor), onClick: () => { apply(p); renderInspector(); } })))
      ),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: prefs.monoVary, onChange: (e) => { prefs.monoVary = e.target.checked; save(); applyColours(); refreshTilesOnly(); } }), t('vary')),
      prefs.monoVary ? h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onClick: () => { state.seed = randomSeed(); applyColours(); refreshTiles(); toast(t('shuffled')); } }, icon('shuffle', { size: 16 }), t('shuffle'))) : null
    );
  }
  if (prefs.mode === 'palette') panel.append(...palettePanel());
  return panel;
};

const ui = { harmonyKind: 'analogous', harmonyBase: null, paletteName: '' };

const strip = (colors) => h('span', { class: 'strip', 'aria-hidden': 'true' }, colors.map((c) => h('i', { style: { background: c } })));
const sameColours = (a, b) => a.length === b.length && a.every((c, i) => c === b[i]);

const setPalette = (colors) => {
  const next = cleanPalette(colors);
  if (!next.length) {
    toast(t('paletteMin'));
    return;
  }
  prefs.paletteColors = next;
  save();
  applyColours();
  refreshTilesOnly();
  renderInspector();
};

const palettePanel = () => {
  const colors = prefs.paletteColors;
  const base = ui.harmonyBase || colors[0];
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const out = [];
  out.push(
    h('div', { class: 'label' }, t('presets')),
    h('div', { class: 'pal-list' }, PRESETS.map((p) => h('button', { class: 'pal-chip', type: 'button', 'aria-pressed': String(sameColours(colors, p.colors)), onClick: () => setPalette(p.colors) }, strip(p.colors), t('preset' + cap(p.id))))),
    h('div', { class: 'label' }, t('harmony')),
    h(
      'div',
      { class: 'colour-row' },
      h('label', { class: 'picker', style: { background: base } }, h('span', { class: 'sr' }, t('pickColour')), h('input', { type: 'color', value: base, onInput: (e) => { e.target.parentElement.style.background = e.target.value; }, onChange: (e) => { ui.harmonyBase = e.target.value; setPalette(harmony(ui.harmonyBase, ui.harmonyKind)); } })),
      h('select', { 'aria-label': t('harmony'), onChange: (e) => { ui.harmonyKind = e.target.value; setPalette(harmony(base, ui.harmonyKind)); } }, HARMONIES.map((k) => h('option', { value: k, selected: k === ui.harmonyKind }, t('harmony' + cap(k)))))
    ),
    h('div', { class: 'label' }, t('yourPalette')),
    h(
      'div',
      { class: 'pal-list' },
      colors.map((c) => h('span', { class: 'pal-sw', style: { background: c } }, h('button', { type: 'button', 'aria-label': t('removeColour', { c }), onClick: () => setPalette(colors.filter((x) => x !== c)) }, icon('close', { size: 12, stroke: 2.6 })))),
      colors.length < 12 ? h('label', { class: 'pal-add' }, icon('plus', { size: 16 }), h('span', { class: 'sr' }, t('addColour')), h('input', { type: 'color', class: 'sr', value: colors[colors.length - 1], onChange: (e) => setPalette([...colors, e.target.value]) })) : null
    ),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: prefs.paletteVary, onChange: (e) => { prefs.paletteVary = e.target.checked; save(); applyColours(); refreshTilesOnly(); } }), t('vary')),
    prefs.paletteVary ? h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onClick: () => { state.seed = randomSeed(); applyColours(); refreshTiles(); toast(t('shuffled')); } }, icon('shuffle', { size: 16 }), t('shuffle'))) : null,
    h(
      'form',
      { class: 'pal-save', onSubmit: (e) => { e.preventDefault(); const name = ui.paletteName.trim(); if (!name) return; prefs.palettes = [{ name, colors: [...colors] }, ...prefs.palettes.filter((p) => p.name !== name)].slice(0, 12); ui.paletteName = ''; save(); toast(t('paletteSaved')); renderInspector(); } },
      h('input', { type: 'text', placeholder: t('paletteName'), 'aria-label': t('paletteName'), value: ui.paletteName, maxlength: 32, onInput: (e) => { ui.paletteName = e.target.value; } }),
      h('button', { class: 'btn', type: 'submit' }, t('savePalette'))
    )
  );
  if (prefs.palettes.length) {
    out.push(
      h('div', { class: 'label' }, t('savedPalettes')),
      h('div', { class: 'pal-list' }, prefs.palettes.map((p) => h('span', { class: 'pal-chip saved' }, h('button', { type: 'button', 'aria-pressed': String(sameColours(colors, p.colors)), onClick: () => setPalette(p.colors) }, strip(p.colors), p.name), h('button', { class: 'del', type: 'button', 'aria-label': t('deletePalette', { name: p.name }), onClick: () => { prefs.palettes = prefs.palettes.filter((x) => x !== p); save(); renderInspector(); } }, icon('trash', { size: 14 })))))
    );
  }
  return out;
};

const refreshPairs = () => {
  const el = document.getElementById('pairs');
  if (!el) return;
  const n = similarNow().length;
  el.dataset.pairs = String(n);
  el.replaceChildren(icon(n ? 'warn' : 'check', { size: 16 }), document.createTextNode(t('similarPairs', { n })));
};

const refreshTilesOnly = () => {
  refreshPairs();
  document.querySelectorAll('.cell').forEach((c) => {
    const rec = state.records.get(c.dataset.key);
    if (!rec || !rec.hasImage) return;
    c.firstElementChild.replaceWith(tile(rec));
    const old = c.querySelector('.flag');
    if (old) old.remove();
    const flag = contrastFlag(rec);
    if (flag) c.append(h('span', { class: 'flag ' + flag, title: reasonOf(rec) }, icon('warn', { size: 11, stroke: 2.4 })));
  });
  const sel = state.records.get(state.selected);
  const head = document.querySelector('.sel-head .tile-art');
  if (sel && head) head.replaceWith(tile(sel, { size: 72 }));
  const trio = document.querySelector('.tint-trio');
  if (sel && trio) trio.replaceWith(trioEl(sel));
};

const trioEl = (rec) => h('div', { class: 'tint-trio', 'aria-hidden': 'true' }, (rec.tint || []).map((c) => h('i', { style: { background: c } })));

const selectedPanel = () => {
  const rec = state.records.get(state.selected);
  if (!rec) return h('section', { class: 'panel' }, h('h2', null, t('icon')), h('p', { class: 'hint-text' }, t('noSelection')));
  const item = state.items.get(rec.key) || {};
  const panel = h('section', { class: 'panel' }, h('h2', null, t('icon')));
  panel.append(h('div', { class: 'sel-head' }, rec.hasImage ? tile(rec, { size: 72 }) : h('span', { class: 'tile-art ghost', style: { '--size': '72px', animation: 'none' } }), h('div', null, h('h3', { dir: 'auto' }, rec.name), h('small', { dir: 'ltr' }, rec.key))));
  if (rec.hasImage) {
    const pickHex = (rec.tint && rec.tint[0]) || '#8c95b6';
    panel.append(
      h(
        'div',
        { class: 'colour-row' },
        h('label', { class: 'picker', style: { background: pickHex } }, h('span', { class: 'sr' }, t('pickColour')), h('input', { type: 'color', value: pickHex, onInput: (e) => { setManualColour(rec, e.target.value, state.target); e.target.parentElement.style.background = e.target.value; refreshTilesOnly(); } , onChange: () => renderInspector() })),
        trioEl(rec),
        rec.locked ? h('span', { class: 'pill ok' }, t('locked')) : null
      ),
      h(
        'div',
        { class: 'row' },
        rec.locked ? h('button', { class: 'btn', type: 'button', onClick: () => { rec.locked = false; applyColours(); refreshTiles(); } }, icon('reset', { size: 16 }), t('reset')) : h('button', { class: 'btn', type: 'button', onClick: () => { rec.locked = true; scheduleSave(); renderInspector(); } }, icon('lock', { size: 16 }), t('lock')),
        h('label', { class: 'btn' }, icon('image', { size: 16 }), t('replaceImage'), h('input', { type: 'file', accept: 'image/*,.ico,.svg', class: 'sr', onChange: (e) => replaceImage(rec, e.target.files[0]) }))
      )
    );
  }
  panel.append(
    h(
      'div',
      { class: 'row' },
      item.url ? h('button', { class: 'btn', type: 'button', 'data-act': 'reharvest', onClick: () => reharvest(rec, 'retryDone') }, icon('reset', { size: 16 }), t('reharvest')) : null,
      h('button', { class: 'btn', type: 'button', 'data-act': 'remove', onClick: () => removeTile(rec) }, icon('trash', { size: 16 }), t('removeTile'))
    )
  );
  const glyphLabel = rec.trace && rec.trace.accepted ? t('glyphSymbol', { bytes: rec.trace.bytes }) : rec.mask ? t('glyphAtlas') : t('glyphNone');
  const flags = [];
  if (rec.contrast === 'flagged') flags.push(h('span', { class: 'pill bad' }, t('contrastFlagged')));
  if (rec.contrast === 'nudged') flags.push(h('span', { class: 'pill warn' }, t('contrastNudged')));
  if (rec.tight) flags.push(h('span', { class: 'pill warn' }, t('tight')));
  if ((item.flags || []).includes('low-res')) flags.push(h('span', { class: 'pill warn', 'data-flag': 'low-res' }, t('lowRes')));
  const stale = (item.flags || []).includes('stale-source');
  const nudge = rec.contrast === 'nudged' && Array.isArray(rec.sourceTint) && Array.isArray(rec.tint) ? h('span', { class: 'contrast-note', 'data-note': 'contrast', dir: 'ltr' }, t('contrastAdjusted', { from: rec.sourceTint[0], to: rec.tint[0] })) : null;
  if (stale) flags.push(h('span', { class: 'pill warn', 'data-flag': 'stale-source' }, t('staleSource')), h('button', { class: 'btn', type: 'button', 'data-act': 'retry-live', onClick: () => retryLive(rec) }, t('retryLive')));
  const src = item.source ? (item.source.type + ' ' + (item.source.href || '')).slice(0, 120) : item.error || '-';
  panel.append(
    h(
      'dl',
      { class: 'facts' },
      h('dt', null, t('status')),
      h('dd', null, h('span', { class: 'pill' + (rec.status === 'found' || rec.status === 'override' ? ' ok' : ' warn') }, t(statusKey(rec.status))), ' ', flags),
      nudge ? h('dt', null, t('contrast')) : null,
      nudge ? h('dd', null, nudge) : null,
      h('dt', null, t('glyph')),
      h('dd', null, glyphLabel),
      h('dt', null, t('source')),
      h('dd', null, rec.faviconUrl ? h('span', { class: 'favicon-chip', style: { display: 'inline-grid', 'vertical-align': 'middle', 'margin-inline-end': '8px' } }, h('img', { src: rec.faviconUrl, alt: '' })) : null, src)
    ),
    ...[attemptsList(rec, item.attempts)].filter(Boolean)
  );
  return panel;
};

const attemptsList = (rec, attempts) =>
  attempts && attempts.length
    ? h(
        'details',
        { class: 'attempts', open: !!pinnedHref(rec) },
        h('summary', null, t('attempts', { n: attempts.length })),
        h(
          'ol',
          null,
          ...attempts.map((a) =>
            h('li', null, h('span', { class: 'pill' + (a.status === 'used' ? ' ok' : ' warn') }, t('attempt' + a.status[0].toUpperCase() + a.status.slice(1))), ' ', h('b', null, a.type), ' ', h('span', { class: 'href', dir: 'ltr' }, a.href), a.reason ? h('span', { class: 'why' }, ' ' + a.reason) : null, pinnable(a) ? h('button', { class: 'btn quiet', type: 'button', 'data-act': 'pin', onClick: () => pinAttempt(rec, a) }, t('useThisOne')) : null)
          ),
          pinnedHref(rec) ? h('li', { class: 'pinned' }, h('span', { class: 'pill ok' }, t('pinned')), ' ', h('span', { class: 'href', dir: 'ltr' }, pinnedHref(rec)), h('button', { class: 'btn quiet', type: 'button', 'data-act': 'copy-pin', onClick: () => copyPin(rec) }, t('copyPin')), h('button', { class: 'btn quiet', type: 'button', 'data-act': 'unpin', onClick: () => unpin(rec) }, t('unpin'))) : null
        )
      )
    : null;

const renderInspector = () => {
  const el = document.getElementById('inspector');
  if (!el) return;
  clear(el);
  el.append(colourPanel(), selectedPanel());
};

const pinnable = (a) => /^https?:\/\//i.test(a.href || '') && a.status !== 'blocked';

const pinnedHref = (rec) => (state.pins[rec.key] && state.pins[rec.key].href) || null;

const copyPin = async (rec) => {
  await navigator.clipboard.writeText(JSON.stringify({ [rec.key]: { href: pinnedHref(rec) } }, null, 2));
  toast(t('copied'));
};

const pinAttempt = async (rec, a) => {
  state.pins = { ...state.pins, [rec.key]: { href: a.href } };
  await reharvest(rec, 'pinDone');
};

const unpin = async (rec) => {
  const next = { ...state.pins };
  delete next[rec.key];
  state.pins = next;
  await reharvest(rec, 'unpinDone');
};

const retryLive = (rec) => reharvest(rec, 'retryDone');

const reharvest = async (rec, doneKey) => {
  const item = state.items.get(rec.key) || {};
  if (!item.url) return;
  try {
    await client.call('configure', { wasmBase: '/wasm/', settings: await proxySettings() });
    const result = await client.call('harvest', { reset: false, fresh: true, targets: [{ key: rec.key, appId: rec.appId, url: item.url, name: rec.name }], target: state.target, seed: state.seed, cell: state.cell || undefined, faFallback: prefs.faFallback, pins: state.pins });
    const next = result.items[0];
    const payload = result.records.find((r) => r.key === rec.key);
    if (!payload || !next || (next.flags || []).includes('stale-source')) {
      toast(t('retryStale'));
      return;
    }
    const fresh = decodeRecord(payload, { name: rec.name });
    fresh.name = rec.name;
    state.records.set(rec.key, fresh);
    state.items.set(rec.key, { ...item, ...next, flags: next.flags || [], name: rec.name });
    state.dirty = true;
    applyColours();
    renderMain();
    toast(t(doneKey));
  } catch (e) {
    toast(t('retryFailed', { why: e.message || String(e) }));
  }
};

const replaceImage = async (rec, file) => {
  if (!file) return;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const payload = await client.call('replace', { target: state.target, key: rec.key, appId: rec.appId, bytes, fileName: file.name });
    const fresh = decodeRecord(payload, { name: rec.name });
    fresh.name = rec.name;
    state.records.set(rec.key, fresh);
    state.items.set(rec.key, { ...(state.items.get(rec.key) || {}), source: { type: 'file', href: file.name }, error: null, attempts: [], name: rec.name });
    state.dirty = true;
    applyColours();
    renderMain();
    toast(t('replaced'));
  } catch (e) {
    toast(t('replaceFailed', { why: e.message }));
  }
};

const patches = () => Object.fromEntries([...state.records.values()].filter((r) => r.hasImage).map((r) => [r.key, requiredPatch(r, prefs.mode, state.seed)]));

let launcherBuild = null;

const openExport = () => {
  state.dirty = true;
  const dlg = h('dialog', { 'aria-labelledby': 'exp-title' });
  const body = h('div', { class: 'dlg' });
  dlg.append(body);
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  let tab = 'launcher';
  const stateOpts = { formats: new Set(['png', 'webp']), sizes: '32, 64, 128, 192', quality: 90, lossless: false, name: '', background: '#ffffff', themeColor: '', key: state.selected || state.order.find((k) => state.records.get(k).hasImage) };

  const render = async () => {
    clear(body);
    body.append(
      h('header', null, h('h2', { id: 'exp-title' }, t('exportTitle')), h('button', { class: 'btn icon quiet', type: 'button', 'aria-label': t('close'), onClick: () => dlg.close() }, icon('close'))),
      seg(t('exportTitle'), [['launcher', t('tabLauncher')], ['pack', t('tabPack')], ['custom', t('tabCustom')]], tab, (v) => { tab = v; render(); }, { wide: true })
    );
    const area = h('div', { class: 'dlg', style: { padding: 0 } });
    body.append(area);
    if (tab === 'launcher') await renderLauncher(area);
    else if (tab === 'pack') renderPack(area);
    else renderCustom(area);
  };

  const run = async (type, payload) => {
    await client.call('configure', { wasmBase: '/wasm/', settings: await proxySettings() });
    return client.call('build', { patches: patches(), target: state.target, seed: state.seed, cell: state.cell || undefined, ...payload, kind: type });
  };

  const renderLauncher = async (area) => {
    const formatNotes = () => [h('p', { class: 'hint-text', id: 'exp-format' }, state.target === 'v4' ? t('exportV4') : t('exportV3')), prefs.target !== state.target ? h('p', { class: 'hint-text', id: 'exp-mismatch' }, t('targetMismatch', { from: state.target, to: prefs.target })) : null];
    area.append(h('p', { class: 'hint-text' }, t('launcherIntro')), ...formatNotes(), h('p', { class: 'progress-text' }, t('building')));
    try {
      if (state.dirty || !launcherBuild) {
        launcherBuild = await run('launcher', {});
        state.dirty = false;
      }
      const b = launcherBuild;
      clear(area);
      area.append(...formatNotes());
      const items = [];
      const stat = b.stats;
      const line = (ok, label, value) => h('li', null, h('span', { class: 'ic ' + (ok ? 'ok' : 'bad') }, icon(ok ? 'check' : 'close', { stroke: 2.6 })), label, h('small', null, value));
      const fails = new Set(b.gate.failures.map((f) => f.code));
      items.push(line(!fails.has('atlas-size'), 'atlas.webp (' + (stat.atlasMode || '-') + ')', stat.atlasBytes.toLocaleString() + ' / 153,600 B'));
      items.push(line(!fails.has('sprite-gzip'), 'glyphs.svg gzip', stat.spriteGzip.toLocaleString() + ' / 40,960 B'));
      items.push(line(!fails.has('symbol-size'), t('gateGlyphs', { n: stat.symbols }), stat.rejectedGlyphs ? t('gateImageOnly', { n: stat.rejectedGlyphs }) : state.target === 'v4' ? '≤ 1,536 B (' + t('twoTone') + ' ≤ 2,560 B)' : '≤ 1,536 B'));
      items.push(line(!fails.has('contrast'), t('gateContrast'), b.gate.failures.filter((f) => f.code === 'contrast').length ? t('gateLow', { n: b.gate.failures.filter((f) => f.code === 'contrast').length }) : '3:1'));
      area.append(
        h('p', { class: 'hint-text' }, t('launcherIntro')),
        h('ul', { class: 'gate' }, items),
        b.gate.failures.length ? h('div', { class: 'note bad' }, b.gate.failures.slice(0, 4).map((f) => h('div', null, f.message))) : h('div', { class: 'pill ok', style: { 'justify-self': 'start' } }, t('gateOk')),
        h('pre', { class: 'code' }, b.files.map((f) => 'icons/' + f).join('\n')),
        h('div', { class: 'actions-end' }, h('button', { class: 'btn primary', type: 'button', disabled: !b.gate.ok, onClick: () => download(b.zip, 'launcher-icons.zip') }, icon('download', { size: 18 }), t('downloadZip')))
      );
    } catch (e) {
      clear(area);
      area.append(h('div', { class: 'note bad' }, t('exportFailed', { why: e.message })));
    }
  };

  const renderPack = (area) => {
    const keys = state.order.filter((k) => state.records.get(k).hasImage);
    const preview = h('pre', { class: 'code', id: 'head-tags' }, '');
    area.append(
      h('p', { class: 'hint-text' }, t('packIntro')),
      h('div', { class: 'field' }, h('label', { for: 'pk-icon' }, t('packIcon')), h('select', { id: 'pk-icon', onChange: (e) => { stateOpts.key = e.target.value; } }, keys.map((k) => h('option', { value: k, selected: k === stateOpts.key }, state.records.get(k).name)))),
      h('div', { class: 'field' }, h('label', { for: 'pk-name' }, t('packName')), h('input', { id: 'pk-name', type: 'text', placeholder: (state.records.get(stateOpts.key) || {}).name || '', value: stateOpts.name, onInput: (e) => { stateOpts.name = e.target.value; } })),
      h('div', { class: 'row' }, h('div', { class: 'field' }, h('label', { for: 'pk-bg' }, t('packBackground')), h('input', { id: 'pk-bg', type: 'color', value: stateOpts.background, style: { 'min-height': '48px', padding: '4px' }, onInput: (e) => { stateOpts.background = e.target.value; } })), h('div', { class: 'field' }, h('label', { for: 'pk-theme' }, t('packTheme')), h('input', { id: 'pk-theme', type: 'color', value: stateOpts.themeColor || '#17151f', style: { 'min-height': '48px', padding: '4px' }, onInput: (e) => { stateOpts.themeColor = e.target.value; } }))),
      h('div', { class: 'label' }, t('headTags')),
      preview,
      h('div', { class: 'actions-end' }, h('button', { class: 'btn', type: 'button', onClick: async () => { await navigator.clipboard.writeText(preview.textContent); toast(t('copied')); } }, icon('copy', { size: 16 }), t('copy')), h('button', { class: 'btn primary', type: 'button', onClick: async (e) => { const b = e.currentTarget; b.disabled = true; try { const r = await run('pack', { key: stateOpts.key, name: stateOpts.name || (state.records.get(stateOpts.key) || {}).name, background: stateOpts.background, themeColor: stateOpts.themeColor || null }); preview.textContent = r.head; download(r.zip, (stateOpts.key || 'favicon') + '-favicon-pack.zip'); } catch (err) { toast(t('exportFailed', { why: err.message })); } b.disabled = false; } }, icon('download', { size: 18 }), t('downloadZip')))
    );
    preview.textContent = '<link rel="icon" href="/favicon.ico" sizes="48x48">\n<link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32">\n<link rel="icon" href="/icon-192.png" type="image/png" sizes="192x192">\n<link rel="apple-touch-icon" href="/apple-touch-icon.png">\n<link rel="manifest" href="/site.webmanifest">';
  };

  const renderCustom = (area) => {
    const fmt = ['png', 'webp', 'avif', 'jxl', 'ico'];
    area.append(
      h('p', { class: 'hint-text' }, t('customIntro')),
      h('div', { class: 'label' }, t('formats')),
      h('div', { class: 'checks' }, fmt.map((f) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: stateOpts.formats.has(f), onChange: (e) => { if (e.target.checked) stateOpts.formats.add(f); else stateOpts.formats.delete(f); } }), f.toUpperCase()))),
      h('div', { class: 'field' }, h('label', { for: 'cu-sizes' }, t('sizes')), h('input', { id: 'cu-sizes', type: 'text', value: stateOpts.sizes, inputmode: 'numeric', onInput: (e) => { stateOpts.sizes = e.target.value; } })),
      h('div', { class: 'row' }, h('div', { class: 'range', style: { flex: 1 } }, h('label', { class: 'label', for: 'cu-q' }, t('quality') + ' ' + stateOpts.quality), h('input', { id: 'cu-q', type: 'range', min: 40, max: 100, value: stateOpts.quality, onInput: (e) => { stateOpts.quality = Number(e.target.value); e.target.previousElementSibling.textContent = t('quality') + ' ' + stateOpts.quality; } })), h('label', { class: 'check' }, h('input', { type: 'checkbox', onChange: (e) => { stateOpts.lossless = e.target.checked; } }), t('lossless'))),
      h('div', { class: 'actions-end' }, h('button', { class: 'btn primary', type: 'button', onClick: async (e) => { const b = e.currentTarget; b.disabled = true; try { const sizes = stateOpts.sizes.split(/[\s,]+/).map(Number).filter((n) => n >= 16 && n <= 1024); const r = await run('custom', { formats: [...stateOpts.formats], sizes: sizes.length ? sizes : [192], quality: stateOpts.quality, lossless: stateOpts.lossless }); download(r.zip, 'icons-custom.zip'); } catch (err) { toast(t('exportFailed', { why: err.message })); } b.disabled = false; } }, icon('download', { size: 18 }), t('downloadZip')))
    );
  };

  dlg.showModal();
  render();
};

const openSettings = () => {
  const dlg = h('dialog', { 'aria-labelledby': 'set-title' });
  const url = h('input', { id: 'px-url', type: 'url', value: prefs.proxyUrl, placeholder: 'https://your-studio.vercel.app/api/fetch', autocomplete: 'off', spellcheck: false });
  const token = h('input', { id: 'px-token', type: 'password', value: proxyToken, autocomplete: 'off' });
  dlg.append(
    h(
      'div',
      { class: 'dlg' },
      h('header', null, h('h2', { id: 'set-title' }, t('proxyTitle')), h('button', { class: 'btn icon quiet', type: 'button', 'aria-label': t('close'), onClick: () => dlg.close() }, icon('close'))),
      h('p', { class: 'hint-text', id: 'px-status' }, !prefs.proxyUrl && builtInProxy ? t('proxyBuiltIn') : prefs.proxyUrl ? t('proxyCustom') : t('proxyNone')),
      h('p', { class: 'hint-text' }, t('proxyBody')),
      h('div', { class: 'field' }, h('label', { for: 'px-url' }, t('proxyUrl')), url),
      h('div', { class: 'field' }, h('label', { for: 'px-token' }, t('proxyToken')), token, h('p', { class: 'hint-text' }, t('proxyTokenNote'))),
      h('div', { class: 'actions-end' }, h('button', { class: 'btn primary', type: 'button', onClick: () => { prefs.proxyUrl = url.value.trim(); proxyToken = token.value; saveToken(proxyToken); save(); dlg.close(); } }, t('save')))
    )
  );
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
};

const renderMain = () => {
  let main = document.querySelector('main');
  if (!main) {
    main = h('main');
    app.append(main);
  }
  clear(main);
  main.append(state.stage === 'intake' ? renderIntake() : state.stage === 'busy' ? renderBusy() : renderWork());
  if (state.stage === 'work') renderInspector();
  if (state.stage === 'busy') updateProgress();
};

const renderAll = () => {
  clear(app);
  app.append(renderBar());
  renderMain();
};

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (prefs.theme === 'system') refreshTiles();
});

applyCorners();
renderAll();
window.__studio = { state, client, prefs };
const loadJson = (url) => fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
Promise.all([loadJson('./catalogue.json'), loadJson('./extras.json'), loadJson('./fihrist.json')])
  .then(([data, extrasData, fihristData]) => {
    const scan = data ? scanJson(data) : null;
    if (scan && scan.kind === 'launcher') {
      const extras = extrasToTargets(extrasData);
      state.catalogue = { data, extras, count: mergeTargets(scan.targets, extras).length };
    }
    if (isFihrist(fihristData)) state.fihrist = { data: fihristData, count: scanJson(fihristData).count };
    if ((state.catalogue || state.fihrist) && state.stage === 'intake') renderMain();
  })
  .catch(() => {});
listProjects().then((list) => {
  state.projects = list;
  if (state.stage === 'intake') renderMain();
});
