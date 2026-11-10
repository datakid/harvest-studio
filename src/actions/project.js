import { state, prefs, client, save, history, mem, proxySettings, emit } from '../store.js';
import { t } from '../i18n.js';
import { DEFAULT_SEED } from '../../core/tints.js';
import { cleanPalette } from '../../core/palettes.js';
import { listProjects, saveProject, loadProject, newId } from '../projects.js';
import { confirmStartOver } from '../ui/dialogs.js';
import { decodeRecord, recordPayload } from '../model.js';
import { applyColours } from './colour.js';

export let saveTimer = 0;

export const snapshot = () => ({
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

export const writeProject = async () => {
  const imaged = [...state.records.values()].filter((r) => r.hasImage);
  const meta = { id: state.projectId, name: state.projectName, updatedAt: Date.now(), count: imaged.length, dots: imaged.slice(0, 8).map((r) => (r.tint && r.tint[0]) || '#8c95b6') };
  if (await saveProject(meta, snapshot())) {
    state.unsaved = false;
    state.projects = await listProjects();
    window.__studio.saved = (window.__studio.saved || 0) + 1;
  }
};

export const scheduleSave = () => {
  if (state.stage !== 'work' || !state.projectId) return;
  state.unsaved = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeProject, 700);
};

export const defaultName = () => t('projectDefault', { n: [...state.records.values()].filter((r) => r.hasImage).length });

export const adopt = (result, nameOf) => {
  state.items = new Map(result.items.map((i) => [i.key, { ...i, name: nameOf(i.key) || i.key }]));
  state.records = new Map();
  for (const r of result.records) state.records.set(r.key, decodeRecord(r, state.items.get(r.key)));
  for (const item of result.items) if (!state.records.has(item.key)) state.records.set(item.key, { key: item.key, appId: item.key, status: 'notfound', hasImage: false, name: nameOf(item.key) || item.key, base: null, tint: null, locked: false, trace: null });
  state.order = [...state.records.keys()].sort();
};

export const enterWork = (primed = false) => {
  state.selected = state.order.find((k) => state.records.get(k).hasImage) || null;
  state.stage = 'work';
  state.bloom = true;
  state.dirty = true;
  mem.launcherBuild = null;
  history.clear();
  state.projectId = newId();
  state.projectName = defaultName();
  if (!primed) applyColours();
  else scheduleSave();
  emit('main');
};

export const openProject = async (meta) => {
  const payload = await loadProject(meta.id);
  if (!payload) {
    state.error = t('projectOpenError');
    emit('main');
    return;
  }
  state.error = null;
  state.stage = 'busy';
  state.busyKeys = null;
  state.ghosts = payload.records.length;
  state.progress = { done: 0, total: 1, phase: 'fetch' };
  emit('main');
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
    mem.launcherBuild = null;
    history.clear();
    state.projectId = meta.id;
    state.projectName = meta.name;
    emit('all');
  } catch (e) {
    state.stage = 'intake';
    state.error = t('projectOpenError') + ': ' + (e.message || e);
    emit('main');
  }
};

export const startOver = async () => {
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
  emit('main');
  await saving;
  if (state.stage === 'intake') emit('main');
};
