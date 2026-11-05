const hostKey = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
};

export const createLimiter = ({ total = 8, perHost = 2 } = {}) => {
  const queue = [];
  const byHost = new Map();
  let active = 0;
  const stats = { peak: 0, peakHost: 0 };

  const pump = () => {
    for (let i = 0; i < queue.length && active < total; ) {
      const job = queue[i];
      if ((byHost.get(job.host) || 0) >= perHost) {
        i++;
        continue;
      }
      queue.splice(i, 1);
      active++;
      byHost.set(job.host, (byHost.get(job.host) || 0) + 1);
      stats.peak = Math.max(stats.peak, active);
      stats.peakHost = Math.max(stats.peakHost, byHost.get(job.host));
      Promise.resolve()
        .then(job.fn)
        .then(job.resolve, job.reject)
        .finally(() => {
          active--;
          byHost.set(job.host, byHost.get(job.host) - 1);
          pump();
        });
    }
  };

  return {
    stats,
    run: (url, fn) =>
      new Promise((resolve, reject) => {
        queue.push({ host: hostKey(url), fn, resolve, reject });
        pump();
      })
  };
};
