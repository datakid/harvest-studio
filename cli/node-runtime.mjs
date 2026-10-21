import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const coreDir = path.resolve(here, '../core');
const coreRequire = createRequire(path.join(coreDir, 'index.js'));

globalThis.require = coreRequire;
globalThis.__dirname = coreDir;
globalThis.__filename = path.join(coreDir, 'index.js');

const { configureRuntime, WASM_FILES } = await import('../core/runtime.js');

configureRuntime({
  wasmSource: async (id) => {
    const spec = WASM_FILES[id];
    if (!spec) throw new Error('unknown wasm id ' + id);
    return readFile(coreRequire.resolve(spec));
  },
  fontSource: () => readFile(path.resolve(here, '../node_modules/@expo-google-fonts/readex-pro/400Regular/ReadexPro_400Regular.ttf'))
});

export { coreDir };
