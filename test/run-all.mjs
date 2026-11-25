import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { annotate } from './annotate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
let failed = 0;

const run = (file) => new Promise((resolve) => {
  const child = spawn(process.execPath, [path.join(here, file)]);
  let text = '';
  const take = (out) => (chunk) => {
    text += chunk;
    out.write(chunk);
  };
  child.stdout.on('data', take(process.stdout));
  child.stderr.on('data', take(process.stderr));
  child.on('close', (status) => resolve({ status, text }));
});

for (const file of ['parity.mjs', 'i18n.mjs', 'adjust.mjs', 'adjust-ui.mjs', 'launcher.mjs', 'proxy.mjs', 'sources.mjs', 'ico.mjs', 'catalogue.mjs', 'head.mjs', 'only.mjs', 'discover.mjs', 'svgtext.mjs', 'icoexport.mjs', 'protocols.mjs', 'speed.mjs', 'known.mjs', 'accent.mjs', 'stall.mjs', 'stall-ui.mjs', 'fihrist.mjs', 'ui.mjs', 'features.mjs', 'nocomments.mjs', 'netlify.mjs', 'background.mjs', 'pins.mjs', 'pin-ui.mjs', 'links-read.mjs', 'trace.mjs', 'corners.mjs', 'lowres.mjs', 'colour-truth.mjs', 'polish.mjs', 'polish-ui.mjs', 'additive.mjs', 'proxy-request.mjs', 'site-reports.mjs', 'perf.mjs', 'workflow.mjs', 'v4-contract.mjs', 'v4-ui.mjs', 'workspace.mjs', 'export-scope.mjs', 'search.mjs', 'faithful.mjs']) {
  console.log('== ' + file);
  const r = await run(file);
  if (r.status !== 0) {
    failed++;
    if (process.env.GITHUB_ACTIONS) for (const line of annotate(file, r.text)) console.log(line);
  }
}
process.exit(failed ? 1 : 0);
