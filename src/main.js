import { client, state, prefs } from './store.js';
import { scanJson } from '../core/sources.js';
import { extrasToTargets, mergeTargets, isFihrist } from '../core/targets.js';
import { listProjects } from './projects.js';
import { runHistory } from './actions/adjust.js';
import { refreshTiles } from './views/canvas.js';
import { applyCorners } from './views/workspace.js';
import { installDnd } from './views/dnd.js';
import { renderAll, renderMain } from './views/shell.js';
import './views/addbar.js';
import './views/busy.js';
import './views/inspector.js';

for (const type of ['pointerdown', 'keydown', 'dragenter', 'paste']) addEventListener(type, () => client.warm(), { once: true, capture: true });

addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== 'z') return;
  const a = document.activeElement;
  if (a && (a.tagName === 'TEXTAREA' || a.isContentEditable || (a.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes(a.type)))) return;
  e.preventDefault();
  runHistory(e.shiftKey ? 'redo' : 'undo');
});

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (prefs.theme === 'system') refreshTiles();
});

installDnd();
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
