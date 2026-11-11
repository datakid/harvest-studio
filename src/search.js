const norm = (s) =>
  String(s)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/ـ/g, '')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632));

const wordsOf = (s) => norm(s).split(/[^\p{L}\p{N}#]+/u).filter(Boolean);

const A = new Int32Array(66);
const B = new Int32Array(66);

const dist = (a, b, max) => {
  const n = a.length;
  const m = b.length;
  if (Math.abs(n - m) > max) return max + 1;
  if (m > 64 || n > 64) return max + 1;
  let prev = A;
  let row = B;
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    row[0] = i;
    let low = i;
    const c = a.charCodeAt(i - 1);
    for (let j = 1; j <= m; j++) {
      const sub = prev[j - 1] + (c === b.charCodeAt(j - 1) ? 0 : 1);
      const v = Math.min(prev[j] + 1, row[j - 1] + 1, sub);
      row[j] = v;
      if (v < low) low = v;
    }
    if (low > max) return max + 1;
    const swap = prev;
    prev = row;
    row = swap;
  }
  return prev[m];
};

const subseq = (tok, s) => {
  let i = 0;
  for (const c of s) if (c === tok[i] && ++i === tok.length) return true;
  return false;
};

const exact = (tok, w) => (w === tok ? 100 : w.startsWith(tok) ? 90 - Math.min(20, w.length - tok.length) : tok.length > 1 && w.includes(tok) ? 60 : 0);

const fuzzy = (tok, w) => {
  const max = tok.length < 5 ? 1 : 2;
  if (w.length < tok.length - max) return 0;
  const d = Math.min(dist(tok, w, max), w.length > tok.length ? dist(tok, w.slice(0, tok.length), max) : max + 1);
  return d <= max ? 55 - d * 12 : 0;
};

const BUCKETS = {
  red: ['red', 'احمر'],
  orange: ['orange', 'برتقالي'],
  yellow: ['yellow', 'gold', 'اصفر'],
  green: ['green', 'اخضر'],
  teal: ['teal', 'cyan', 'turquoise', 'فيروزي'],
  blue: ['blue', 'ازرق'],
  purple: ['purple', 'violet', 'بنفسجي'],
  pink: ['pink', 'وردي'],
  brown: ['brown', 'بني'],
  grey: ['grey', 'gray', 'رمادي'],
  black: ['black', 'اسود'],
  white: ['white', 'ابيض']
};

const bucketOf = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const hi = Math.max(r, g, b);
  const lo = Math.min(r, g, b);
  const l = (hi + lo) / 2;
  const d = hi - lo;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (l > 0.88) return 'white';
  if (l < 0.14) return 'black';
  if (s < 0.14) return 'grey';
  let h = hi === r ? ((g - b) / d) % 6 : hi === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (h >= 15 && h < 45 && l < 0.4) return 'brown';
  return h < 15 || h >= 345 ? 'red' : h < 45 ? 'orange' : h < 70 ? 'yellow' : h < 160 ? 'green' : h < 195 ? 'teal' : h < 255 ? 'blue' : h < 300 ? 'purple' : 'pink';
};

const WEIGHTS = { name: 1, key: 0.9, terms: 0.8, url: 0.8, group: 0.5, colour: 0.6 };

const cache = new Map();

const fieldsOf = (d) => {
  const sig = [d.name, d.key, d.url, d.group, d.tint, d.terms.length].join('\u0001');
  const hit = cache.get(d.key);
  if (hit && hit.sig === sig) return hit.fields;
  const bucket = bucketOf(d.tint);
  const fields = [
    ['name', wordsOf(d.name)],
    ['key', wordsOf(d.key)],
    ['terms', [...new Set(d.terms.flatMap(wordsOf))]],
    ['url', wordsOf(d.url)],
    ['group', wordsOf(d.group)],
    ['colour', bucket ? [...BUCKETS[bucket].map(norm), String(d.tint).toLowerCase()] : []]
  ].map(([k, words]) => ({ w: WEIGHTS[k], words }));
  const joined = norm(d.name + d.key).replace(/[^\p{L}\p{N}]+/gu, '');
  const entry = { fields, joined };
  cache.set(d.key, { sig, fields: entry });
  return entry;
};

const best = (tok, entry) => {
  let top = 0;
  for (const f of entry.fields) for (const w of f.words) {
    const v = exact(tok, w) * f.w;
    if (v > top) top = v;
  }
  if (top || tok.length < 3) return top;
  for (const f of entry.fields) for (const w of f.words) {
    const v = fuzzy(tok, w) * f.w;
    if (v > top) top = v;
  }
  return top || (subseq(tok, entry.joined) ? 20 : 0);
};

export const rank = (docs, query) => {
  const toks = wordsOf(query).filter((w) => w !== '#');
  if (!toks.length) return docs.map((d) => d.key);
  const out = [];
  for (const d of docs) {
    const entry = fieldsOf(d);
    let total = 0;
    for (const tok of toks) {
      const s = best(tok, entry);
      if (!s) {
        total = -1;
        break;
      }
      total += s;
    }
    if (total >= 0) out.push([total, d]);
  }
  return out.sort((a, b) => b[0] - a[0] || (a[1].name < b[1].name ? -1 : a[1].name > b[1].name ? 1 : 0)).map((x) => x[1].key);
};
