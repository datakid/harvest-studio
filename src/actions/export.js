import { requiredPatch } from '../colour.js';
import { state, prefs, client, proxySettings } from '../store.js';
import { t } from '../i18n.js';
import { toast } from '../ui/toast.js';
import { download } from '../ui/download.js';

export const downloadReport = async (e) => {
  const b = e.currentTarget;
  b.disabled = true;
  try {
    await client.call('configure', { wasmBase: '/wasm/', settings: await proxySettings() });
    const r = await client.call('build', { patches: patches(), kind: 'report' });
    download(r.zip, 'harvest-report.zip');
  } catch (err) {
    toast(t('exportFailed', { why: err.message }));
  }
  b.disabled = false;
};

export const patches = () => Object.fromEntries([...state.records.values()].filter((r) => r.hasImage).map((r) => [r.key, { ...requiredPatch(r, prefs.mode, state.seed), adjust: r.adjust || null }]));
