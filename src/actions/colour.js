import { state, prefs, save, emit } from '../store.js';
import { t } from '../i18n.js';
import { recolour } from '../colour.js';
import { cleanPalette } from '../../core/palettes.js';
import { toast } from '../ui/toast.js';
import { scheduleSave } from './project.js';

export const applyColours = (only = null) => {
  const res = recolour(state.records, { mode: prefs.mode, seed: state.seed, monoColor: prefs.monoColor, monoVary: prefs.monoVary, spread: prefs.spread, paletteColors: prefs.paletteColors, paletteVary: prefs.paletteVary, only, target: state.target });
  scheduleSave();
  return res;
};

export const setPalette = (colors) => {
  const next = cleanPalette(colors);
  if (!next.length) {
    toast(t('paletteMin'));
    return;
  }
  prefs.paletteColors = next;
  save();
  applyColours();
  emit('tiles-lite');
  emit('inspector');
};
