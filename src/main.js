import { h, clear, icon } from './dom.js';
import { t, setLang, getLang } from './i18n.js';
import { loadPrefs, savePrefs, loadToken, saveToken } from './prefs.js';
import { createClient } from './worker-client.js';
import { recolour, randomSeed, setManualColour, effectiveTheme, tileColours, requiredPatch } from './colour.js';
import { filesFromDrop, isJsonFile, isImageFile, readJsonFile, rescan, buildTargets, pendingCount, parseUrls } from './inputs.js';
import { tintFromOklch } from '../core/color.js';
import { DEFAULT_SEED } from '../core/tints.js';
import { PRESETS, HARMONIES, harmony, cleanPalette } from '../core/palettes.js';
import { listProjects, saveProject, loadProject, removeProject, newId } from './projects.js';

const prefs = loadPrefs();
setLang(prefs.lang);
const client = createClient();
let proxyToken = loadToken();

const state = {
  stage: 'intake',
  pending: { urlText: '', files: [], jsons: [], bundle: { manifest: null, files: new Map() } },
  projects: [],
  projectId: null,
  projectName: '',
  cell: null,
  records: new Map(),
  order: [],
  items: new Map(),
  selected: null,
  seed: DEFAULT_SEED,
  progress: null,
  error: null,
  bloom: false,
  dirty: true,
  ghosts: 0
};

const app = document.getElementById('app');
const save = () => savePrefs(prefs);

const toast = (message) => {
  document.querySelectorAll('.toast').forEach((n) => n.remove());
  const el = h('div', { class: 'toast', role: 'status' }, h('div', null, message));
  document.body.append(el);
  setTimeout(() => el.remove(), 3200);
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

const tile = (rec, { size = 60, mask = null, tint = null } = {}) => {
  const col = tileColours(tint || (rec && rec.tint), { colors: prefs.colors, theme: theme() });
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
  if (r.trace && r.trace.accepted) rec.mask = 'url("data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="black" d="' + r.trace.d + '"/></svg>') + '")';
  else if (r.glyph) rec.mask = 'url(' + URL.createObjectURL(new Blob([r.glyph], { type: 'image/png' })) + ')';
  delete rec.favicon;
  delete rec.glyph;
  return rec;
};

const applyColours = () => {
  const res = recolour(state.records, { mode: prefs.mode, seed: state.seed, monoColor: prefs.monoColor, monoVary: prefs.monoVary, spread: prefs.spread, paletteColors: prefs.paletteColors, paletteVary: prefs.paletteVary });
  scheduleSave();
  return res;
};

let saveTimer = 0;

const snapshot = () => ({
  seed: state.seed,
  cell: state.cell,
  selected: state.selected,
  settings: { mode: prefs.mode, monoColor: prefs.monoColor, monoVary: prefs.monoVary, spread: prefs.spread, paletteColors: prefs.paletteColors, paletteVary: prefs.paletteVary },
  items: [...state.items.values()].map((i) => ({ key: i.key, name: i.name, status: i.status, source: i.source || null, error: i.error || null, attempts: i.attempts || [] })),
  records: [...state.records.values()].map((r) => ({ key: r.key, appId: r.appId, status: r.status, base: r.base || null, tint: r.tint || null, sourceTint: r.sourceTint || null, locked: !!r.locked, hash: r.hash || null, trace: r.trace || null, favicon: (r.raw && r.raw.favicon) || null, glyph: (r.raw && r.raw.glyph) || null }))
});

const scheduleSave = () => {
  if (state.stage !== 'work' || !state.projectId) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const imaged = [...state.records.values()].filter((r) => r.hasImage);
    const meta = { id: state.projectId, name: state.projectName, updatedAt: Date.now(), count: imaged.length, dots: imaged.slice(0, 8).map((r) => (r.tint && r.tint[0]) || '#8c95b6') };
    if (await saveProject(meta, snapshot())) {
      state.projects = await listProjects();
      window.__studio.saved = (window.__studio.saved || 0) + 1;
    }
  }, 700);
};

const defaultName = () => t('projectDefault', { n: [...state.records.values()].filter((r) => r.hasImage).length });

const adopt = (result, nameOf) => {
  state.items = new Map(result.items.map((i) => [i.key, { ...i, name: nameOf(i.key) }]));
  state.records = new Map();
  for (const r of result.records) state.records.set(r.key, decodeRecord(r, state.items.get(r.key)));
  for (const item of result.items) if (!state.records.has(item.key)) state.records.set(item.key, { key: item.key, appId: item.key, status: 'notfound', hasImage: false, name: item.name, base: null, tint: null, locked: false, trace: null });
  state.order = [...state.records.keys()].sort();
};

const enterWork = () => {
  state.selected = state.order.find((k) => state.records.get(k).hasImage) || null;
  state.stage = 'work';
  state.bloom = true;
  state.dirty = true;
  launcherBuild = null;
  state.projectId = newId();
  state.projectName = defaultName();
  applyColours();
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
  panel.append(h('h3', null, t('scanFound', { n: s.count, label: s.kind === 'launcher' ? t('scanLauncher') : s.label }) + ' · ' + json.name));
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
  state.ghosts = Object.keys(b.manifest.data.icons).length;
  state.progress = { done: 0, total: 1, phase: 'fetch' };
  renderMain();
  try {
    const files = {};
    for (const [name, f] of b.files) files[name] = new Uint8Array(await f.arrayBuffer());
    await client.call('configure', { wasmBase: '/wasm/', settings: { proxyUrl: prefs.proxyUrl, proxyToken } });
    const result = await client.call('importManifest', { manifest: b.manifest.data, files });
    state.seed = result.seed || DEFAULT_SEED;
    state.cell = result.cell;
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
  const targets = await buildTargets(state.pending);
  state.stage = 'busy';
  state.ghosts = targets.length;
  state.progress = { done: 0, total: targets.length, phase: 'fetch' };
  renderMain();
  try {
    await client.call('configure', { wasmBase: '/wasm/', settings: { proxyUrl: prefs.proxyUrl, proxyToken } });
    state.seed = state.seed || DEFAULT_SEED;
    const result = await client.call('harvest', { targets, seed: state.seed, cell: state.cell || undefined, faFallback: prefs.faFallback }, {
      onProgress: (p) => {
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
    adopt(result, (k) => (names.get(k) || {}).name || k);
    enterWork();
    const unreached = result.items.filter((i) => i.error && /needs the fetch proxy/.test(i.error)).length;
    if (unreached) toast(t('proxyMissingSome', { n: unreached }));
  } catch (e) {
    state.stage = 'intake';
    const why = e.message || String(e);
    state.error = t('harvestFailed', { why }) + (/proxy/i.test(why) ? ' ' + t('proxyNeeded') : '');
    renderMain();
  }
};

const updateProgress = () => {
  const bar = document.querySelector('.progress i');
  const text = document.querySelector('.progress-text');
  if (!state.progress || !bar) return;
  const { done, total, phase } = state.progress;
  const share = phase === 'trace' ? 0.5 + (done / total) * 0.5 : (done / total) * 0.5;
  bar.style.width = Math.round(share * 100) + '%';
  text.textContent = t(phase === 'trace' ? 'tracing' : 'fetching', { done, total });
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
  state.ghosts = payload.records.length;
  state.progress = { done: 0, total: 1, phase: 'fetch' };
  renderMain();
  try {
    await client.call('configure', { wasmBase: '/wasm/', settings: { proxyUrl: prefs.proxyUrl, proxyToken } });
    await client.call('restore', { records: payload.records });
    Object.assign(prefs, payload.settings || {});
    prefs.paletteColors = cleanPalette(prefs.paletteColors).length ? cleanPalette(prefs.paletteColors) : ['#f0475c'];
    save();
    state.seed = payload.seed || DEFAULT_SEED;
    state.cell = payload.cell || null;
    adopt({ records: payload.records, items: payload.items }, (k) => (payload.items.find((i) => i.key === k) || {}).name || k);
    state.selected = payload.selected && state.records.has(payload.selected) ? payload.selected : null;
    state.stage = 'work';
    state.bloom = true;
    state.dirty = true;
    launcherBuild = null;
    state.projectId = meta.id;
    state.projectName = meta.name;
    applyColours();
    renderAll();
  } catch (e) {
    state.stage = 'intake';
    state.error = t('projectOpenFailed') + ': ' + (e.message || e);
    renderMain();
  }
};

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
    h('div', { class: 'stage' }, h('ul', { class: 'gallery' }, Array.from({ length: state.ghosts }, () => h('li', null, h('div', { class: 'cell' }, h('span', { class: 'tile-art ghost' }), h('span', { class: 'name' }, ' '))))))
  );

const contrastFlag = (rec) => (rec.contrast === 'flagged' ? 'bad' : rec.status === 'default' || rec.status === 'stale' || rec.status === 'blocked' ? 'warn' : null);

const cellEl = (rec, i) => {
  const flag = contrastFlag(rec);
  return h(
    'li',
    { style: { '--i': i } },
    h(
      'button',
      { class: 'cell', type: 'button', role: 'option', 'aria-selected': String(state.selected === rec.key), dataset: { key: rec.key }, 'aria-label': t('tileAria', { name: rec.name, status: t(statusKey(rec.status)) }), onClick: () => select(rec.key) },
      rec.hasImage ? tile(rec) : h('span', { class: 'tile-art ghost', style: { animation: 'none' } }),
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
  const review = [...state.records.values()].filter((r) => contrastFlag(r) || !r.hasImage).length;
  return { n: list.length, glyphs, review };
};

const renderToolbar = () => {
  const s = stats();
  return h(
    'div',
    { class: 'toolbar' },
    h('input', { class: 'proj-name', type: 'text', value: state.projectName, 'aria-label': t('projectName'), spellcheck: false, onInput: (e) => { state.projectName = e.target.value; scheduleSave(); } }),
    h('div', { class: 'stat' }, t('summary', { n: s.n, g: s.glyphs }), s.review ? h('small', null, t('review', { n: s.review })) : null),
    h('div', { class: 'spacer pv' }, h('span', null, t('previewColors')), seg(t('previewColors'), [['vivid', t('vivid')], ['muted', t('muted')]], prefs.colors, (v) => { prefs.colors = v; save(); renderMain(); })),
    h('div', { class: 'pv' }, h('span', null, t('previewCorners')), seg(t('previewCorners'), [['balanced', t('balanced')], ['soft', t('soft')], ['crisp', t('crisp')]], prefs.corners, (v) => { prefs.corners = v; applyCorners(); save(); renderMain(); })),
    h('button', { class: 'btn primary', type: 'button', onClick: openExport }, icon('download', { size: 18 }), t('export'))
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
    h('div', null, renderToolbar(), h('div', { class: 'stage' + (state.bloom ? ' bloom' : '') }, gallery), h('div', { class: 'row', style: { 'margin-top': '14px' } }, h('button', { class: 'btn quiet', type: 'button', onClick: startOver }, icon('reset', { size: 16 }), t('startOver')))),
    h('aside', { class: 'inspector', id: 'inspector' })
  );
  if (state.bloom) setTimeout(() => document.querySelectorAll('.stage.bloom').forEach((el) => el.classList.remove('bloom')), 1900);
  state.bloom = false;
  return work;
};

const startOver = () => {
  state.stage = 'intake';
  state.pending = { urlText: '', files: [], jsons: [], bundle: { manifest: null, files: new Map() } };
  state.records = new Map();
  state.projectId = null;
  state.error = null;
  renderMain();
};

const refreshTiles = () => {
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

const MODES = () => [['follow', t('modeFollow')], ['mono', t('modeMono')], ['palette', t('modePalette')], ['family', t('modeFamily')], ['keep', t('modeKeep')]];
const MODE_HINT = { follow: 'modeFollowHint', mono: 'modeMonoHint', palette: 'modePaletteHint', family: 'modeFamilyHint', keep: 'modeKeepHint' };

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

const refreshTilesOnly = () => {
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
        h('label', { class: 'picker', style: { background: pickHex } }, h('span', { class: 'sr' }, t('pickColour')), h('input', { type: 'color', value: pickHex, onInput: (e) => { setManualColour(rec, e.target.value); e.target.parentElement.style.background = e.target.value; refreshTilesOnly(); } , onChange: () => renderInspector() })),
        trioEl(rec),
        rec.locked ? h('span', { class: 'pill ok' }, t('locked')) : null
      ),
      h(
        'div',
        { class: 'row' },
        rec.locked ? h('button', { class: 'btn', type: 'button', onClick: () => { rec.locked = false; applyColours(); refreshTiles(); } }, icon('reset', { size: 16 }), t('reset')) : h('button', { class: 'btn', type: 'button', onClick: () => { rec.locked = true; renderInspector(); } }, icon('lock', { size: 16 }), t('lock')),
        h('label', { class: 'btn' }, icon('image', { size: 16 }), t('replaceImage'), h('input', { type: 'file', accept: 'image/*,.ico,.svg', class: 'sr', onChange: (e) => replaceImage(rec, e.target.files[0]) }))
      )
    );
  }
  const glyphLabel = rec.trace && rec.trace.accepted ? t('glyphSymbol', { bytes: rec.trace.bytes }) : rec.mask ? t('glyphAtlas') : t('glyphNone');
  const flags = [];
  if (rec.contrast === 'flagged') flags.push(h('span', { class: 'pill bad' }, t('contrastFlagged')));
  if (rec.contrast === 'nudged') flags.push(h('span', { class: 'pill warn' }, t('contrastNudged')));
  if (rec.tight) flags.push(h('span', { class: 'pill warn' }, t('tight')));
  const src = item.source ? (item.source.type + ' ' + (item.source.href || '')).slice(0, 120) : item.error || '-';
  panel.append(
    h(
      'dl',
      { class: 'facts' },
      h('dt', null, t('status')),
      h('dd', null, h('span', { class: 'pill' + (rec.status === 'found' || rec.status === 'override' ? ' ok' : ' warn') }, t(statusKey(rec.status))), ' ', flags),
      h('dt', null, t('glyph')),
      h('dd', null, glyphLabel),
      h('dt', null, t('source')),
      h('dd', null, rec.faviconUrl ? h('span', { class: 'favicon-chip', style: { display: 'inline-grid', 'vertical-align': 'middle', 'margin-inline-end': '8px' } }, h('img', { src: rec.faviconUrl, alt: '' })) : null, src)
    ),
    attemptsList(item.attempts)
  );
  return panel;
};

const attemptsList = (attempts) =>
  attempts && attempts.length
    ? h(
        'details',
        { class: 'attempts' },
        h('summary', null, t('attempts', { n: attempts.length })),
        h(
          'ol',
          null,
          ...attempts.map((a) =>
            h('li', null, h('span', { class: 'pill' + (a.status === 'used' ? ' ok' : ' warn') }, t('attempt' + a.status[0].toUpperCase() + a.status.slice(1))), ' ', h('b', null, a.type), ' ', h('span', { class: 'href', dir: 'ltr' }, a.href), a.reason ? h('span', { class: 'why' }, ' ' + a.reason) : null)
          )
        )
      )
    : null;

const renderInspector = () => {
  const el = document.getElementById('inspector');
  if (!el) return;
  clear(el);
  el.append(colourPanel(), selectedPanel());
};

const replaceImage = async (rec, file) => {
  if (!file) return;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const payload = await client.call('replace', { key: rec.key, appId: rec.appId, bytes, fileName: file.name });
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
    await client.call('configure', { wasmBase: '/wasm/', settings: { proxyUrl: prefs.proxyUrl, proxyToken } });
    return client.call('build', { patches: patches(), seed: state.seed, cell: state.cell || undefined, ...payload, kind: type });
  };

  const renderLauncher = async (area) => {
    area.append(h('p', { class: 'hint-text' }, t('launcherIntro')), h('p', { class: 'progress-text' }, t('building')));
    try {
      if (state.dirty || !launcherBuild) {
        launcherBuild = await run('launcher', {});
        state.dirty = false;
      }
      const b = launcherBuild;
      clear(area);
      const items = [];
      const stat = b.stats;
      const line = (ok, label, value) => h('li', null, h('span', { class: 'ic ' + (ok ? 'ok' : 'bad') }, icon(ok ? 'check' : 'close', { stroke: 2.6 })), label, h('small', null, value));
      const fails = new Set(b.gate.failures.map((f) => f.code));
      items.push(line(!fails.has('atlas-size'), 'atlas.webp (' + (stat.atlasMode || '-') + ')', stat.atlasBytes.toLocaleString() + ' / 153,600 B'));
      items.push(line(!fails.has('sprite-gzip'), 'glyphs.svg gzip', stat.spriteGzip.toLocaleString() + ' / 40,960 B'));
      items.push(line(!fails.has('symbol-size'), t('gateGlyphs', { n: stat.symbols }), stat.rejectedGlyphs ? t('gateImageOnly', { n: stat.rejectedGlyphs }) : '≤ 1,536 B'));
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
listProjects().then((list) => {
  state.projects = list;
  if (state.stage === 'intake') renderMain();
});
