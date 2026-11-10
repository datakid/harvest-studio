import { client, state, prefs } from './store.js';
import { scanJson } from '../core/sources.js';
import { extrasToTargets, mergeTargets, isFihrist } from '../core/targets.js';
import { listProjects } from './projects.js';
import { refreshArt, applyCorners } from './views/canvas.js';
import { applyTheme } from './views/settings-sheet.js';
import { installDnd } from './views/dnd.js';
import { installKeyboard } from './keyboard.js';
import { renderAll, renderMain } from './views/shell.js';

for (const type of ['pointerdown', 'keydown', 'dragenter', 'paste']) addEventListener(type, () => client.warm(), { once: true, capture: true });

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (prefs.theme === 'system') refreshArt();
});

installDnd();
installKeyboard();
applyCorners();
applyTheme();
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
