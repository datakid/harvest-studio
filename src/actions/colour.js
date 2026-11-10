import { state, prefs, save, history, emit } from '../store.js';
import { t } from '../i18n.js';
import { recolour, randomSeed, setManualColour } from '../colour.js';
import { passesContrast } from '../../core/color.js';
import { cleanPalette } from '../../core/palettes.js';
import { toast, announce } from '../ui/toast.js';
import { scheduleSave } from './project.js';

export const applyColours = (only = null) => {
  const res = recolour(state.records, { mode: prefs.mode, seed: state.seed, monoColor: prefs.monoColor, monoVary: prefs.monoVary, spread: prefs.spread, paletteColors: prefs.paletteColors, paletteVary: prefs.paletteVary, only, target: state.target });
  scheduleSave();
  return res;
};

const FIELDS = ['tint', 'sourceTint', 'locked', 'contrast', 'tight', 'grouped'];
const SETTINGS = ['mode', 'monoColor', 'monoVary', 'spread', 'paletteColors', 'paletteVary'];

export const world = () => ({
  seed: state.seed,
  prefs: Object.fromEntries(SETTINGS.map((k) => [k, Array.isArray(prefs[k]) ? [...prefs[k]] : prefs[k]])),
  recs: [...state.records.values()].filter((r) => r.hasImage).map((r) => [r.key, Object.fromEntries(FIELDS.map((f) => [f, Array.isArray(r[f]) ? [...r[f]] : r[f]]))])
});

export const restoreWorld = (w) => {
  state.seed = w.seed;
  for (const k of SETTINGS) prefs[k] = Array.isArray(w.prefs[k]) ? [...w.prefs[k]] : w.prefs[k];
  save();
  for (const [key, fields] of w.recs) {
    const rec = state.records.get(key);
    if (rec) for (const f of FIELDS) rec[f] = Array.isArray(fields[f]) ? [...fields[f]] : fields[f];
  }
  state.dirty = true;
  scheduleSave();
  emit('tiles');
  emit('colour-state');
  emit('history');
};

const sig = (w) => JSON.stringify(w);

let session = null;

export const beginEdit = () => {
  if (!session) session = world();
};

export const endEdit = () => {
  if (!session) return;
  const before = session;
  session = null;
  const after = world();
  if (sig(before) === sig(after)) return;
  history.push({ label: 'colour', undo: () => restoreWorld(before), redo: () => restoreWorld(after) });
  state.dirty = true;
  emit('history');
};

export const edit = (fn) => {
  beginEdit();
  fn();
  endEdit();
};

const targets = (keys) => keys.map((k) => state.records.get(k)).filter((r) => r && r.hasImage);

export const setTintLive = (keys, hex) => {
  beginEdit();
  for (const r of targets(keys)) setManualColour(r, hex, state.target);
  state.dirty = true;
  scheduleSave();
  emit('tiles-lite');
};

export const setTint = (keys, hex) => {
  setTintLive(keys, hex);
  endEdit();
  emit('colour-state');
};

export const spreadAcross = (keys) => {
  const colours = prefs.paletteColors.length ? prefs.paletteColors : ['#f0475c'];
  edit(() => {
    targets(keys).forEach((r, i) => setManualColour(r, colours[i % colours.length], state.target));
    state.dirty = true;
    scheduleSave();
    emit('tiles-lite');
  });
  emit('colour-state');
};

export const setLocked = (keys, locked) => {
  edit(() => {
    const list = targets(keys);
    for (const r of list) r.locked = locked;
    if (!locked) applyColours();
    else scheduleSave();
    state.dirty = true;
    emit('tiles');
  });
  emit('colour-state');
};

export const setMode = (mode) => {
  edit(() => {
    prefs.mode = mode;
    save();
    applyColours();
    emit('tiles');
  });
  emit('colour-state');
};

export const setSpreadLive = (value) => {
  beginEdit();
  prefs.spread = value;
  applyColours();
  emit('tiles-lite');
};

export const settleColour = () => {
  save();
  endEdit();
  emit('colour-state');
};

export const setMono = (hex) => {
  edit(() => {
    prefs.monoColor = hex;
    save();
    applyColours();
    emit('tiles-lite');
  });
  emit('colour-state');
};

export const setMonoLive = (hex) => {
  beginEdit();
  prefs.monoColor = hex;
  applyColours();
  emit('tiles-lite');
};

export const setVary = (kind, on) => {
  edit(() => {
    prefs[kind === 'palette' ? 'paletteVary' : 'monoVary'] = on;
    save();
    applyColours();
    emit('tiles-lite');
  });
  emit('colour-state');
};

export const shuffle = () => {
  edit(() => {
    state.seed = randomSeed();
    applyColours();
    emit('tiles');
  });
  emit('colour-state');
};

export const setPalette = (colors) => {
  const next = cleanPalette(colors);
  if (!next.length) {
    toast(t('paletteMin'));
    return;
  }
  edit(() => {
    prefs.paletteColors = next;
    save();
    applyColours();
    emit('tiles-lite');
  });
  emit('colour-state');
};

export const savePalette = (name) => {
  prefs.palettes = [{ name, colors: [...prefs.paletteColors] }, ...prefs.palettes.filter((p) => p.name !== name)].slice(0, 12);
  save();
  announce(t('paletteSaved'));
  emit('colour-state');
};

export const deletePalette = (palette) => {
  prefs.palettes = prefs.palettes.filter((p) => p !== palette);
  save();
  emit('colour-state');
};

export const setStopLive = (key, index, hex) => {
  const rec = state.records.get(key);
  if (!rec || !rec.tint) return;
  beginEdit();
  const next = [...rec.tint];
  next[index] = hex;
  rec.tint = next;
  rec.locked = true;
  rec.contrast = passesContrast(next) ? null : 'flagged';
  state.dirty = true;
  scheduleSave();
  emit('tiles-lite');
};

export const setStop = (key, index, hex) => {
  setStopLive(key, index, hex);
  endEdit();
  emit('colour-state');
};

export const commitColour = () => {
  endEdit();
  emit('colour-state');
};
