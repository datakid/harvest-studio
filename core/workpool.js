export const createWorkPool = (workers) => {
  const load = new Array(workers.length).fill(0);
  const call = async (type, payload) => {
    let pick = 0;
    for (let i = 1; i < workers.length; i++) if (load[i] < load[pick]) pick = i;
    load[pick] += 1;
    try {
      return await workers[pick].call(type, payload);
    } finally {
      load[pick] -= 1;
    }
  };
  return {
    size: workers.length,
    analyze: (image) => call('analyze', { image }),
    trace: (glyph, key, options) => call('trace', { glyph, key, options }),
    close: async () => {
      await Promise.all(workers.map((w) => w.close()));
    }
  };
};

export const handleCompute = (fns) => async (type, payload) => {
  if (type === 'analyze') return fns.analyze(payload.image);
  if (type === 'trace') return fns.trace(payload.glyph, payload.key, payload.options);
  throw new Error('unknown job ' + type);
};
