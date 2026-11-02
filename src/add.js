const hostOf = (url) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
};

export const sameSite = (a, b) => {
  const x = hostOf(a);
  const y = hostOf(b);
  if (!x || !y) return true;
  return x === y;
};

export const classify = (targets, existing) => {
  const taken = new Set(existing.keys());
  const fresh = [];
  const same = [];
  const renamed = [];
  for (const t of targets) {
    if (!existing.has(t.key)) {
      taken.add(t.key);
      fresh.push(t);
    } else if (sameSite(existing.get(t.key), t.url)) same.push(t);
    else {
      let n = 2;
      while (taken.has(t.key + '-' + n)) n++;
      const key = t.key + '-' + n;
      taken.add(key);
      const next = { ...t, key, appId: key, name: (t.name || t.key) + ' ' + n };
      renamed.push({ from: t.key, to: key });
      fresh.push(next);
    }
  }
  return { fresh, same, renamed };
};

export const keepBoth = (targets, existing) => {
  const taken = new Set(existing.keys());
  return targets.map((t) => {
    let n = 2;
    while (taken.has(t.key + '-' + n)) n++;
    const key = t.key + '-' + n;
    taken.add(key);
    return { ...t, key, appId: key, name: (t.name || t.key) + ' ' + n };
  });
};

export const notPresent = (targets, existing) => targets.filter((t) => !existing.has(t.key));
