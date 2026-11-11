import '../cli/node-runtime.mjs';
import { existsSync, readdirSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const studioDir = path.resolve(here, '..');
export const fixturesDir = path.join(here, 'fixtures');

export const AWAITING_ICONS = ['quinon', 'typing-practice--platen', 'typing-practice--tarq'];

export const fixtureTargets = async () => {
  const names = (await fs.readdir(fixturesDir)).filter((f) => f.endsWith('.png')).sort();
  return names.map((f) => {
    const key = f.replace(/\.png$/, '');
    return { key, appId: key.split('--')[0], variantId: key.includes('--') ? key.split('--')[1] : null, url: null };
  });
};

export const localIo = (overrides = {}) => ({
  readLocal: async (key) => {
    try {
      return { bytes: new Uint8Array(await fs.readFile(path.join(fixturesDir, key + '.png'))), file: key + '.png' };
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  },
  readOverride: async () => {
    throw new Error('no overrides in tests');
  },
  readOutput: async () => null,
  fetchBytes: async () => {
    throw new Error('network is not available in tests');
  },
  ...overrides
});

export const NOW = '2026-01-01T00:00:00.000Z';

let passed = 0;
let failed = 0;
export const check = (name, fn) =>
  Promise.resolve()
    .then(fn)
    .then(
      () => {
        passed++;
        console.log('PASS  ' + name);
      },
      (e) => {
        failed++;
        console.log('FAIL  ' + name + '\n      ' + (e && e.message ? e.message : e));
      }
    );
export const finish = () => {
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
};

export const invoke = async (handler, { path: requestPath, headers = {}, method = 'GET' } = {}) => {
  const out = { headers: {}, status: 0, text: '' };
  const res = {
    statusCode: 0,
    setHeader: (k, v) => (out.headers[k.toLowerCase()] = v),
    end: (b) => {
      out.status = res.statusCode;
      out.text = Buffer.from(b || '').toString('utf8');
    }
  };
  await handler({ method, url: requestPath, headers }, res);
  return out;
};

export const chromiumPath = () => {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (!existsSync(root)) return undefined;
  const dirs = readdirSync(root).filter((d) => d.startsWith('chromium-')).sort().reverse();
  return dirs.flatMap((d) => ['chrome-linux64', 'chrome-linux'].map((s) => path.join(root, d, s, 'chrome'))).find((p) => existsSync(p));
};
