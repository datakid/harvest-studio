import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
let failed = 0;
for (const file of ['launcher.mjs', 'proxy.mjs', 'sources.mjs', 'ico.mjs', 'catalogue.mjs', 'head.mjs', 'only.mjs', 'discover.mjs', 'svgtext.mjs', 'icoexport.mjs', 'protocols.mjs', 'speed.mjs', 'known.mjs', 'accent.mjs', 'stall.mjs', 'stall-ui.mjs', 'fihrist.mjs', 'ui.mjs', 'features.mjs', 'nocomments.mjs', 'netlify.mjs', 'background.mjs', 'pins.mjs', 'pin-ui.mjs', 'links-read.mjs', 'trace.mjs', 'corners.mjs', 'lowres.mjs']) {
  console.log('== ' + file);
  const r = spawnSync(process.execPath, [path.join(here, file)], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
process.exit(failed ? 1 : 0);
