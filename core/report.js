const fileSafe = (key) => String(key).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '').slice(0, 80) || 'site';

const bundledCopy = (item) => (item.flags || []).includes('stale-source') || (item.attempts || []).some((a) => a.status === 'used' && /shipped/.test(a.reason || ''));

const outcomeOf = (item) => {
  if (item.status === 'notfound' || item.status === 'blocked') return item.status;
  if (bundledCopy(item)) return 'bundled';
  return item.status === 'stale' ? 'stale' : item.status === 'default' ? 'default' : 'live';
};

const reasonOf = (item) => {
  if (item.error) return item.error;
  const bad = (item.attempts || []).find((a) => a.status === 'failed' || a.status === 'blocked' || a.status === 'rejected');
  if (bundledCopy(item) && bad) return bad.reason;
  if (item.status === 'notfound' || item.status === 'blocked' || item.status === 'default') return bad ? bad.reason : item.why || null;
  return null;
};

export const siteReports = (items, { prefix = 'reports/', generatedAt = null } = {}) => {
  const files = {};
  const used = new Set();
  const index = [];
  for (const item of items) {
    let name = fileSafe(item.key);
    for (let n = 2; used.has(name); n++) name = fileSafe(item.key) + '-' + n;
    used.add(name);
    const outcome = outcomeOf(item);
    const reason = reasonOf(item);
    const failures = (item.attempts || []).filter((a) => a.status !== 'used');
    const doc = {
      key: item.key,
      url: item.url || null,
      status: item.status,
      outcome,
      reason,
      source: item.source || null,
      error: item.error || null,
      flags: item.flags || [],
      glyph: item.glyph || null,
      trace: item.trace || null,
      tint: item.tint || null,
      why: item.why || null,
      failures,
      attempts: item.attempts || []
    };
    files[prefix + name + '.json'] = doc;
    index.push({ key: item.key, file: name + '.json', status: item.status, outcome, reason, attempts: doc.attempts.length, failed: failures.length });
  }
  files[prefix + '_index.json'] = { generatedAt, total: items.length, outcomes: index.reduce((m, r) => ((m[r.outcome] = (m[r.outcome] || 0) + 1), m), {}), sites: index };
  return files;
};
