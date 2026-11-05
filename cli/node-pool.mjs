import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { createWorkPool } from '../core/workpool.js';

const spawn = () => {
  const worker = new Worker(new URL('./pool-worker.mjs', import.meta.url));
  let n = 0;
  const pending = new Map();
  worker.on('message', ({ id, value, error }) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (error) p.reject(new Error(error));
    else p.resolve(value);
  });
  worker.on('error', (e) => {
    for (const p of pending.values()) p.reject(e);
    pending.clear();
  });
  return {
    call: (type, payload) =>
      new Promise((resolve, reject) => {
        const id = ++n;
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, type, payload });
      }),
    close: () => worker.terminate()
  };
};

export const createNodePool = (size = Math.min(4, os.availableParallelism())) => createWorkPool(Array.from({ length: Math.max(1, size) }, spawn));
