export const createClient = () => {
  let n = 0;
  let worker = null;
  const pending = new Map();
  const onmessage = (event) => {
    const { id, done, error, value, progress } = event.data;
    const p = pending.get(id);
    if (!p) return;
    if (progress) {
      if (p.onProgress) p.onProgress(progress);
      return;
    }
    if (done) {
      pending.delete(id);
      if (error) p.reject(new Error(error));
      else p.resolve(value);
    }
  };
  const onerror = (event) => {
    for (const p of pending.values()) p.reject(new Error(event.message || 'worker failed'));
    pending.clear();
  };
  const start = () => {
    if (!worker) {
      worker = new Worker('/worker.js', { type: 'module' });
      worker.onmessage = onmessage;
      worker.onerror = onerror;
    }
    return worker;
  };
  const call = (type, payload, { transfer = [], onProgress } = {}) =>
    new Promise((resolve, reject) => {
      const id = ++n;
      pending.set(id, { resolve, reject, onProgress });
      start().postMessage({ id, type, payload }, transfer);
    });
  return { call, warm: start };
};
