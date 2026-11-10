import { requiredPatch } from '../colour.js';
import { state, prefs, client, proxySettings } from '../store.js';
import { t } from '../i18n.js';
import { toast } from '../ui/toast.js';
import { download } from '../ui/download.js';

export const downloadReport = async () => {
  try {
    await client.call('configure', { wasmBase: '/wasm/', settings: await proxySettings() });
    const r = await client.call('build', { patches: patches(), kind: 'report' });
    download(r.zip, 'harvest-report.zip');
  } catch (err) {
    toast(t('exportError', { why: err.message }));
  }
};

export const patches = () => Object.fromEntries([...state.records.values()].filter((r) => r.hasImage).map((r) => [r.key, { ...requiredPatch(r, prefs.mode, state.seed), adjust: r.adjust || null }]));

export const runBuild = async (kind, payload = {}) => {
  await client.call('configure', { wasmBase: '/wasm/', settings: await proxySettings() });
  return client.call('build', { patches: patches(), target: state.target, seed: state.seed, cell: state.cell || undefined, ...payload, kind });
};

export const HEAD_TAGS = '<link rel="icon" href="/favicon.ico" sizes="48x48">\n<link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32">\n<link rel="icon" href="/icon-192.png" type="image/png" sizes="192x192">\n<link rel="apple-touch-icon" href="/apple-touch-icon.png">\n<link rel="manifest" href="/site.webmanifest">';
