import { loadPrefs, savePrefs, loadToken } from './prefs.js';
import { setLang } from './i18n.js';
import { createClient } from './worker-client.js';
import { DEFAULT_SEED } from '../core/tints.js';
import { createHistory } from './history.js';

export const prefs = loadPrefs();
setLang(prefs.lang);

export const client = createClient();

export const net = { token: loadToken(), builtIn: false };

const proxyReady = fetch('/api/fetch?probe=1')
  .then((r) => (r.ok ? r.json() : null))
  .then((d) => {
    net.builtIn = !!(d && d.ok && d.mode === 'public');
  })
  .catch(() => {});

export const proxySettings = async () => {
  await proxyReady;
  if (prefs.proxyUrl) return { proxyUrl: prefs.proxyUrl, proxyToken: net.token };
  return { proxyUrl: net.builtIn ? '/api/fetch' : '', proxyToken: '' };
};

export const freshPending = () => ({ urlText: '', files: [], jsons: [], bundle: { manifest: null, files: new Map() } });

export const state = {
  stage: 'intake',
  pending: freshPending(),
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
  sel: new Set(),
  anchor: null,
  view: { q: '', group: 'all', smart: null, sort: 'name' },
  compare: false,
  seed: DEFAULT_SEED,
  target: 'v3',
  progress: null,
  error: null,
  errorProxy: false,
  bloom: false,
  dirty: true,
  unsaved: false,
  adding: 0,
  chain: Promise.resolve(),
  ghosts: 0
};

export const ui = { harmonyKind: 'analogous', harmonyBase: null, paletteName: '', tab: 'look', railOpen: false };

export const mem = { launcherBuild: null };

export const history = createHistory(100);

export const app = document.getElementById('app');

export const save = () => savePrefs(prefs);

const subs = new Map();

export const on = (topic, fn) => {
  if (!subs.has(topic)) subs.set(topic, new Set());
  subs.get(topic).add(fn);
  return () => subs.get(topic).delete(fn);
};

export const emit = (topic, payload) => {
  const set = subs.get(topic);
  if (set) for (const fn of [...set]) fn(payload);
};
