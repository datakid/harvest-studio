import { parentPort } from 'node:worker_threads';
import './node-runtime.mjs';
import { localCompute } from '../core/pipeline.js';
import { handleCompute } from '../core/workpool.js';
import { errText } from '../core/index.js';

const run = handleCompute(localCompute);

parentPort.on('message', async ({ id, type, payload }) => {
  try {
    parentPort.postMessage({ id, value: await run(type, payload) });
  } catch (e) {
    parentPort.postMessage({ id, error: errText(e) });
  }
});
parentPort.postMessage({ ready: true });
