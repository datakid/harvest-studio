import { sha256, text, errText, pool, canonicalJson } from './runtime.js';
import { sniff, EXT_BY_NAME } from './decode.js';
import { normalize, gate, highFrequencyShare, chromaticColours, opaqueShare } from './pixels.js';
import { imageToLab, extractGradient, extractAccent, hexToLab, isHex } from './color.js';
import { extractGlyph, traceGlyph } from './glyph.js';
import { dHash, detectDefaults, DHASH_MAX, DELTA_E_MAX, MIN_OTHER_APPS } from './dedupe.js';
import { readLinks, readMetas, readBaseHref, candidateGroups, loadHref } from './discover.js';
import { applyMode, guardContrast, separateTints, MIN_TINT_SEP, DEFAULT_SEED } from './tints.js';
import { unpackAtlas, DEFAULT_CELL } from './atlas.js';
import { buildLauncherExport, buildLegacyExport, stableStringify } from './profiles.js';
import { decodeImage } from './decode.js';
import { KEY_RE, buildTargets, extrasToTargets, mergeTargets } from './targets.js';
import { PROTECTION_NETLIFY, NETLIFY_PROTECTED_MESSAGE } from './protection.js';

export const BLOCK_STATUS = new Set([401, 403, 429]);
export const CHALLENGE_RE = /security checkpoint|just a moment|attention required|authentication required|vercel\.com\/sso-api|_vercel\/(jwt|sso)|cf-chl|challenge-platform|x-vercel-challenge|checking your browser/i;
export const RASTER_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'svg', 'avif', 'jxl'];

const short = (href) => (href && href.startsWith('data:') ? href.slice(0, 60) : href);

const PHOTO_SHARE = 0.4;

const hasSvgLink = (links) => links.some((l) => l.rel.includes('icon') && (/svg/i.test(l.type || '') || /\.svg(?:[?#]|$)/i.test(l.href || '')));

const isRichSvg = (img) => {
  if (chromaticColours(img) >= 2) return true;
  const share = opaqueShare(img);
  return share >= 0.04 && share <= 0.92;
};

export const TARGET_TIMEOUT_MS = 30000;
export const TIMEOUT_RETRY_MS = 1500;
export const ICON_RETRY_MS = 500;
const TICK_MS = 2500;

const pause = (io, ms) => (io.sleep ? io.sleep(ms) : new Promise((r) => setTimeout(r, ms)));

export const fetchRetry = async (io, url, options, hooks = {}) => {
  let last;
  for (let i = 0; i < 2; i++) {
    try {
      return await io.fetchBytes(url, options);
    } catch (e) {
      last = e;
      if (e && e.fatal) throw e;
      if (i < 1) {
        if (e && e.timeout) {
          if (hooks.onTimeout) hooks.onTimeout(e);
          await pause(io, hooks.timeoutDelayMs === undefined ? TIMEOUT_RETRY_MS : hooks.timeoutDelayMs);
        } else await pause(io, 500);
      }
    }
  }
  throw last;
};

const hostOf = (href) => {
  try {
    return new URL(href).host;
  } catch {
    return null;
  }
};

const gaveUp = (t, ms) => ({
  key: t.key,
  url: t.url || null,
  status: 'notfound',
  source: null,
  error: 'gave up after ' + Math.round(ms / 1000) + ' seconds',
  image: null,
  fa: false,
  attempts: [{ type: 'page', href: short(t.url || t.key), status: 'failed', reason: 'gave up after ' + Math.round(ms / 1000) + ' seconds' }]
});

const withDeadline = (t, run, ms) =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(gaveUp(t, ms)), ms);
    run.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(gaveUp(t, ms));
      }
    );
  });

export const pixelHash = (img) => sha256(img.data);

const finishFrom = async (bytes, source, result) => {
  const ext = sniff(bytes);
  if (!ext) throw new Error('not an image');
  const { img, srcWidth, original } = await normalize(bytes, ext);
  const bad = gate(img, srcWidth);
  if (bad) throw new Error(bad);
  result.image = img;
  result.original = original;
  result.source = source;
};

export const STALE_SOURCE = 'stale-source';

const useKnown = async (io, r) => {
  let hit;
  try {
    hit = await io.readKnown(r.key, r.url);
  } catch {
    hit = null;
  }
  if (!hit) return;
  const source = { type: 'bundled', href: hit.file };
  try {
    await finishFrom(hit.bytes, source, r);
    r.status = 'found';
    r.error = null;
    r.flags = [...(r.flags || []), STALE_SOURCE];
    r.attempts.push({ ...source, status: 'used', reason: 'live fetch failed, using the copy shipped with the app' });
  } catch (e) {
    r.attempts.push({ ...source, status: 'failed', reason: errText(e) });
  }
};

export const processTarget = async (t, ctx) => {
  const { io, overrides = {}, pins = {}, local = false } = ctx;
  const result = { key: t.key, url: t.url || null, status: 'notfound', source: null, error: null, image: null, fa: false, attempts: [] };
  if (!KEY_RE.test(t.key)) {
    result.error = 'key is not safe for a file name';
    return result;
  }
  try {
    const ov = overrides[t.key];
    if (ov && typeof ov === 'object' && ov.use === 'fa') {
      result.status = 'override';
      result.fa = true;
      result.source = { type: 'override', href: 'fa' };
      return result;
    }
    if (typeof ov === 'string' && ov) {
      await finishFrom(await io.readOverride(ov), { type: 'override', href: ov }, result);
      result.status = 'override';
      return result;
    }
    if (t.bytes) {
      await finishFrom(t.bytes, { type: 'file', href: t.fileName || t.key }, result);
      result.status = 'found';
      return result;
    }
    if (t.iconHref && !local) {
      try {
        const bytes = await loadHref(t.iconHref, { fetchBytes: (u) => fetchRetry(io, u) });
        await finishFrom(bytes, { type: 'icon-field', href: short(t.iconHref) }, result);
        result.status = 'found';
        return result;
      } catch (e) {
        if (!t.url) {
          result.error = errText(e);
          return result;
        }
      }
    }
    if (local) {
      const found = await io.readLocal(t.key);
      if (!found) {
        result.error = 'no file for this key in the source folder';
        return result;
      }
      await finishFrom(found.bytes, { type: 'local', href: found.file }, result);
      result.status = 'found';
      return result;
    }
  } catch (e) {
    result.error = errText(e);
    return result;
  }
  const pin = pins[t.key];
  if (pin && typeof pin.href === 'string' && pin.href) {
    const at = { type: 'pinned', href: short(pin.href) };
    const timeouts = [];
    try {
      const bytes = await loadHref(pin.href, { fetchBytes: (u) => fetchRetry(io, u, undefined, { timeoutDelayMs: ICON_RETRY_MS, onTimeout: (e) => timeouts.push(e) }) });
      if (!bytes || !bytes.length) throw new Error('empty');
      await finishFrom(bytes, at, result);
      result.status = 'found';
      result.attempts.push({ ...at, status: 'used', reason: 'pinned source' });
      return result;
    } catch (e) {
      result.attempts.push({ ...at, status: 'failed', reason: 'pinned source failed: ' + errText(e) });
      result.image = null;
      result.source = null;
    }
  }
  if (!t.url) {
    result.error = 'no url';
    return result;
  }

  const errors = [];
  let html = '';
  let pageOk = false;
  let pageDown = false;
  let base = t.url;
  const pageTimeouts = [];
  const noteRetries = (list, at) => {
    for (const e of list.splice(0)) result.attempts.push({ ...at, status: 'failed', reason: errText(e) });
  };
  const pageAt = { type: 'page', href: short(t.url) };
  try {
    const res = await fetchRetry(io, t.url, { head: true }, { timeoutDelayMs: TIMEOUT_RETRY_MS, onTimeout: (e) => pageTimeouts.push(e) });
    base = res.url || t.url;
    const retried = pageTimeouts.length > 0;
    noteRetries(pageTimeouts, pageAt);
    if (BLOCK_STATUS.has(res.status) || res.mitigated === 'challenge' || res.protection) {
      const netlify = res.protection === PROTECTION_NETLIFY;
      result.status = 'blocked';
      result.protected = netlify;
      result.error = netlify ? NETLIFY_PROTECTED_MESSAGE : 'HTTP ' + res.status + ' challenge or protection page';
      result.attempts.push({ ...pageAt, status: 'blocked', reason: result.error });
      return result;
    }
    if (retried) result.attempts.push({ ...pageAt, status: 'used', reason: 'retry after timeout' });
    html = text(res.bytes);
    pageOk = res.ok;
  } catch (e) {
    pageDown = true;
    const retried = pageTimeouts.length > 0;
    errors.push('page: ' + errText(e));
    noteRetries(pageTimeouts, pageAt);
    result.attempts.push({ ...pageAt, status: 'failed', reason: retried ? 'retry after timeout: ' + errText(e) : errText(e) });
  }
  base = readBaseHref(html, base);
  const pageHost = hostOf(base);
  const links = readLinks(html);
  if (html && !links.length && CHALLENGE_RE.test(html)) {
    result.status = 'blocked';
    result.error = 'challenge page without icon links';
    result.attempts.push({ type: 'page', href: short(t.url), status: 'blocked', reason: result.error });
    return result;
  }
  const fetchIo = { fetchBytes: (u) => fetchRetry(io, u), attempt: (a) => result.attempts.push(a) };
  let lastBad = null;
  const tried = new Set();
  let held = null;
  const accept = (found) => {
    result.attempts.push({ ...found.at, status: 'used', reason: found.reason });
    result.source = found.at;
    result.image = found.img;
    result.original = found.original;
    result.status = 'found';
    return result;
  };
  for (const group of candidateGroups(links, base, errors, fetchIo, readMetas(html), { probe: pageOk })) {
    for (const c of await group()) {
      if (tried.has(c.href)) continue;
      if (held && c.type !== 'svg') continue;
      tried.add(c.href);
      const at = { type: c.type, href: short(c.href) };
      if (pageDown && pageHost && hostOf(c.href) === pageHost) {
        result.attempts.push({ ...at, status: 'failed', reason: 'skipped, the site did not answer' });
        continue;
      }
      const timeouts = [];
      const candidateIo = { fetchBytes: (u) => fetchRetry(io, u, undefined, { timeoutDelayMs: ICON_RETRY_MS, onTimeout: (e) => timeouts.push(e) }) };
      try {
        const bytes = await loadHref(c.href, candidateIo);
        if (!bytes || !bytes.length) throw new Error('empty');
        const ext = sniff(bytes);
        if (!ext) throw new Error('not an image');
        const { img, srcWidth, original, ratio } = await normalize(bytes, ext);
        if (c.square && Math.abs(ratio - 1) > 0.1) throw new Error('not square');
        const bad = gate(img, srcWidth);
        const retried = timeouts.length > 0;
        noteRetries(timeouts, at);
        if (bad) {
          lastBad = { bad, source: at };
          errors.push(c.type + ': ' + bad);
          result.attempts.push({ ...at, status: 'rejected', reason: bad });
          continue;
        }
        if (held) {
          if (isRichSvg(img)) {
            result.attempts.push({ ...held.at, status: 'rejected', reason: held.why });
            return accept({ at, img, original, reason: 'preferred svg over jpeg touch icon' });
          }
          result.attempts.push({ ...at, status: 'rejected', reason: 'plain svg, kept the touch icon' });
          continue;
        }
        const reason = retried ? 'retry after timeout' : null;
        if (c.type === 'apple-touch-icon' && (ext === 'jpg' || highFrequencyShare(img) > PHOTO_SHARE) && hasSvgLink(links)) {
          held = { at, img, original, reason, why: ext === 'jpg' ? 'jpeg touch icon' : 'photographic touch icon' };
          continue;
        }
        return accept({ at, img, original, reason });
      } catch (e) {
        const retried = timeouts.length > 0;
        noteRetries(timeouts, at);
        errors.push(c.type + ': ' + errText(e));
        result.attempts.push({ ...at, status: 'failed', reason: retried ? 'retry after timeout: ' + errText(e) : errText(e) });
      }
    }
  }
  if (held) return accept(held);
  if (lastBad) result.source = lastBad.source;
  result.error = errors.slice(-3).join('; ') || 'no icon found';
  return result;
};

export const analyzeIcon = async (img) => {
  const n = img.width * img.height;
  const lab = imageToLab(img.data, n);
  return { gradient: extractGradient(img.data, lab, n), accent: extractAccent(img.data, lab, n), glyph: await extractGlyph(img.data, lab, img.width, img.height) };
};

const baseName = (p) => p.split('/').pop().split('?')[0];

const readSymbols = (svg) => {
  const out = new Map();
  for (const m of svg.matchAll(/<symbol id="g-([a-z0-9-]+)"[^>]*><path d="([^"]*)"\/><\/symbol>/g)) out.set(m[1], m[2]);
  return out;
};

export const readPrevious = async (targets, io) => {
  const prev = new Map();
  let cell = null;
  let seed = null;
  const tryRead = async (name) => {
    try {
      return io.readOutput ? await io.readOutput(name) : null;
    } catch {
      return null;
    }
  };
  const v2 = await tryRead('manifest.v2.json');
  if (v2) {
    try {
      const manifest = JSON.parse(text(v2));
      if (manifest && manifest.icons && typeof manifest.icons === 'object') {
        cell = manifest.atlas && Number.isInteger(manifest.atlas.cell) ? manifest.atlas.cell : null;
        const c = cell || DEFAULT_CELL;
        const favPos = {};
        const glyphPos = {};
        for (const [k, v] of Object.entries(manifest.icons)) {
          if (v && v.favicon) favPos[k] = v.favicon;
          if (v && v.glyph && v.glyph.atlas) glyphPos[k] = v.glyph.atlas;
        }
        let favs = new Map();
        let glyphs = new Map();
        let symbols = new Map();
        if (manifest.atlas) {
          const b = await tryRead(baseName(manifest.atlas.file));
          if (b) favs = await unpackAtlas(b, favPos, c);
        }
        if (manifest.glyphAtlas) {
          const b = await tryRead(baseName(manifest.glyphAtlas.file));
          if (b) glyphs = await unpackAtlas(b, glyphPos, manifest.glyphAtlas.cell || c);
        }
        if (manifest.glyphSprite) {
          const b = await tryRead(baseName(manifest.glyphSprite.file));
          if (b) symbols = readSymbols(text(b));
        }
        for (const [k, v] of Object.entries(manifest.icons)) {
          if (!v || typeof v !== 'object') continue;
          if (!seed && v.seed) seed = v.seed;
          const d = symbols.get(k);
          prev.set(k, {
            image: favs.get(k) || null,
            glyphImage: glyphs.get(k) || null,
            trace: d ? { accepted: true, d, bytes: 0, iou: 1, reason: null } : null,
            tint: v.tint || null,
            sourceTint: v.sourceTint || null,
            locked: !!v.locked,
            palette: v.palette || null,
            seed: v.seed || null,
            shape: v.shape || 'default',
            status: v.status || 'found',
            hash: v.hash || null
          });
        }
      }
    } catch {
      prev.clear();
    }
  }
  const v1 = prev.size ? null : await tryRead('manifest.json');
  if (v1) {
    try {
      const manifest = JSON.parse(text(v1));
      for (const [k, v] of Object.entries((manifest && manifest.icons) || {})) {
        if (!v || typeof v !== 'object') continue;
        let image = null;
        let glyphImage = null;
        const png = await tryRead(k + '.png');
        if (png) image = (await decodeImage(png, 'png')).image;
        const gp = await tryRead(k + '.glyph.png');
        if (gp) glyphImage = (await decodeImage(gp, 'png')).image;
        prev.set(k, { image, glyphImage, trace: null, tint: v.tint || null, sourceTint: v.sourceTint || null, locked: false, palette: null, seed: null, shape: 'default', status: v.status || 'found', hash: v.hash || null });
      }
    } catch {
      prev.clear();
    }
  }
  return { prev, cell, seed };
};

export const runHarvest = async (input, options = {}, io) => {
  const profile = options.profile || 'launcher';
  const legacy = profile === 'legacy-v1';
  const now = options.now || new Date().toISOString();
  const targets = input.targets;
  const overrides = input.overrides || {};
  const pins = input.pins || {};
  const launcherIds = Array.isArray(input.launcherIds) ? input.launcherIds : null;
  const validKeys = new Set(targets.map((t) => t.key));
  const progress = options.onProgress || (() => {});

  const previous = io.readOutput ? await readPrevious(targets, io) : { prev: new Map(), cell: null, seed: null };
  const cell = options.cell || previous.cell || DEFAULT_CELL;
  const cellDefaulted = !options.cell && !previous.cell;
  const seed = options.seed || previous.seed || DEFAULT_SEED;
  const local = !!options.local;

  let done = 0;
  const only = options.only ? new Set(options.only) : null;
  const limit = options.targetTimeoutMs === undefined ? (local ? 0 : TARGET_TIMEOUT_MS) : options.targetTimeoutMs;
  const inflight = new Set();
  const ticker = options.onProgress && !local ? setInterval(() => progress({ phase: 'fetch', done, total: targets.length, pending: [...inflight] }), options.tickMs || TICK_MS) : null;
  let results;
  try {
    results = await pool(targets, options.concurrency || (local ? 8 : 6), async (t) => {
      if (only && !only.has(t.key)) {
        progress({ phase: 'fetch', done: ++done, total: targets.length, key: t.key, status: 'skipped', pending: [...inflight] });
        return { key: t.key, url: t.url, status: 'skipped' };
      }
      inflight.add(t.key);
      const run = processTarget(t, { io, overrides, pins, local });
      const r = limit ? await withDeadline(t, run, limit) : await run;
      inflight.delete(t.key);
      progress({ phase: 'fetch', done: ++done, total: targets.length, key: t.key, status: r.status, pending: [...inflight] });
      return r;
    });
  } finally {
    if (ticker) clearInterval(ticker);
  }

  const records = [];
  const byKey = new Map();
  const targetOf = new Map(targets.map((t) => [t.key, t]));
  const recordOf = (r) => {
    const rec = { key: r.key, appId: targetOf.get(r.key).appId, status: r.status, checkedAt: now, hash: null, image: null, glyphImage: null, trace: null, tint: null, sourceTint: null, locked: false, palette: null, seed: null, shape: 'default' };
    return rec;
  };
  const traceQueue = [];
  for (const r of results) {
    const prev = previous.prev.get(r.key) || null;
    if (!local && !prev && io.readKnown && !r.image && !r.fa && !r.protected && r.status !== 'override' && r.status !== 'skipped') await useKnown(io, r);
    const rec = recordOf(r);
    if (r.image) {
      rec.image = r.image;
      rec.original = r.original || null;
      rec.hash = await pixelHash(r.image);
      let analysis = { gradient: null, accent: null, glyph: null };
      try {
        analysis = await analyzeIcon(r.image);
      } catch (e) {
        r.analysisError = errText(e);
      }
      const catalogue = !analysis.gradient && !legacy ? targetOf.get(r.key).catalogueTint || null : null;
      const accent = !analysis.gradient && !catalogue && !legacy ? analysis.accent : null;
      rec.base = analysis.gradient || catalogue || accent;
      rec.sourceTint = analysis.gradient || catalogue || accent;
      rec.tint = analysis.gradient || catalogue || accent;
      if (catalogue) rec.tintSource = 'catalogue';
      else if (accent) rec.tintSource = 'accent';
      rec.glyphImage = analysis.glyph;
      if (analysis.glyph && !legacy) traceQueue.push(rec);
      if (prev && prev.locked && prev.tint) {
        rec.tint = prev.tint;
        rec.locked = true;
        rec.palette = prev.palette;
        rec.shape = prev.shape || 'default';
      } else if (prev && prev.shape) rec.shape = prev.shape;
    } else if (r.fa) {
      rec.status = 'override';
    } else if (prev) {
      rec.image = prev.image;
      rec.glyphImage = prev.glyphImage;
      rec.trace = prev.trace;
      rec.hash = prev.hash;
      rec.tint = prev.tint;
      rec.sourceTint = prev.sourceTint;
      rec.locked = prev.locked;
      rec.palette = prev.palette;
      rec.seed = prev.seed;
      rec.shape = prev.shape || 'default';
      rec.status = r.status === 'skipped' ? prev.status : r.status === 'blocked' ? 'blocked' : 'stale';
      rec.kept = true;
    } else if (r.status === 'skipped') {
      continue;
    } else if (r.status === 'blocked') {
      rec.status = 'blocked';
    } else if (options.faFallback && r.status === 'notfound' && targetOf.get(r.key).faIcon) {
      rec.status = 'override';
      rec.fa = targetOf.get(r.key).faIcon;
      r.source = { type: 'fa-fallback', href: rec.fa };
    } else {
      continue;
    }
    records.push(rec);
    byKey.set(rec.key, rec);
  }

  let traced = 0;
  for (const rec of traceQueue) {
    rec.trace = await traceGlyph(rec.glyphImage, rec.key);
    progress({ phase: 'trace', done: ++traced, total: traceQueue.length, key: rec.key });
  }

  const appOf = new Map(targets.map((t) => [t.key, t.appId]));
  const entries = {};
  for (const rec of records) entries[rec.key] = rec;
  let adjusted = [];
  let groups = [];
  let tight = [];
  if (legacy) {
    for (const rec of records) if (rec.tint) rec.sourceTint = rec.sourceTint || rec.tint;
    adjusted = separateTints(entries, appOf);
  } else {
    const mode = options.mode || 'follow';
    const unlocked = new Set(records.filter((r) => !r.locked && !r.kept && r.image && (mode === 'mono' || r.tint)).map((r) => r.key));
    for (const rec of records) if (rec.tint && !rec.sourceTint) rec.sourceTint = rec.tint;
    const res = applyMode(entries, appOf, { mode, seed, color: options.monoColor, vary: options.monoVary !== false, spread: options.spread || 1, keys: unlocked });
    adjusted = res.adjusted;
    groups = res.groups;
    tight = res.tight;
    for (const rec of records) {
      if (rec.tint && mode !== 'keep' && unlocked.has(rec.key)) rec.seed = seed;
    }
  }
  const contrast = legacy ? { nudged: [], flagged: [] } : guardContrast(entries);

  const probes = [];
  for (const rec of records) {
    if (!rec.image || rec.status === 'override') continue;
    let hash64 = null;
    try {
      hash64 = await dHash(rec.glyphImage || rec.image, !!rec.glyphImage);
    } catch {
      hash64 = null;
    }
    probes.push({ key: rec.key, appId: rec.appId, hash64, lab: rec.tint && rec.tint[0] ? hexToLab(!legacy && rec.sourceTint && isHex(rec.sourceTint[0]) ? rec.sourceTint[0] : rec.tint[0]) : null });
  }
  const { flagged, palette } = detectDefaults(probes);
  const why = new Map();
  for (const [k, w] of flagged) {
    byKey.get(k).status = 'default';
    why.set(k, w);
  }

  const sorted = [...records].sort((a, b) => (a.key < b.key ? -1 : 1));
  const exported = options.preview ? { files: {}, gate: { ok: true, failures: [] }, stats: {}, replaces: null } : legacy ? await buildLegacyExport(sorted, { generatedAt: now }) : await buildLauncherExport(sorted, { cell, generatedAt: now, seed });

  const marked = new Set(sorted.filter((r) => r.image || r.fa).map((r) => r.key));
  const unused = launcherIds ? [...marked].filter((k) => !launcherIds.includes(k)).sort() : [];
  const missing = launcherIds ? launcherIds.filter((k) => !marked.has(k)).sort() : [];

  const count = (s) => results.filter((r) => (byKey.get(r.key) ? byKey.get(r.key).status : r.status) === s).length;
  const report = {
    generatedAt: now,
    profile,
    thresholds: { dHashMaxHamming: DHASH_MAX, deltaEOklabMax: DELTA_E_MAX, minOtherApps: MIN_OTHER_APPS, minTintSeparation: MIN_TINT_SEP },
    summary: {
      total: targets.length,
      found: count('found'),
      override: count('override'),
      stale: count('stale'),
      blocked: count('blocked'),
      default: count('default'),
      notfound: results.filter((r) => !byKey.has(r.key) && r.status !== 'skipped').length,
      ...(only ? { skipped: results.filter((r) => r.status === 'skipped').length } : {})
    },
    colour: { mode: legacy ? 'legacy' : options.mode || 'follow', seed: legacy ? null : seed, groups, tightGroups: tight, contrastNudged: contrast.nudged, contrastFlagged: contrast.flagged },
    atlas: { cell, cellDefaulted, ...exported.stats },
    gate: options.preview ? null : { ok: exported.gate.ok, failures: exported.gate.failures },
    unused,
    missing,
    defaults: [...flagged.keys()],
    similarPalette: [...palette.keys()],
    adjusted,
    items: results.map((r) => {
      const rec = byKey.get(r.key);
      return {
        key: r.key,
        url: r.url,
        status: rec ? rec.status : 'notfound',
        harvest: r.status,
        source: r.source,
        error: r.error,
        tint: rec ? rec.tint : null,
        glyph: rec ? (rec.trace && rec.trace.accepted ? 'symbol' : rec.glyphImage ? 'atlas' : null) : null,
        trace: rec && rec.trace ? { accepted: rec.trace.accepted, bytes: rec.trace.bytes, iou: Number((rec.trace.iou || 0).toFixed(3)), reason: rec.trace.reason } : null,
        why: why.get(r.key) || null,
        ...(r.flags && r.flags.length ? { flags: r.flags } : {}),
        ...(r.attempts && r.attempts.length ? { attempts: r.attempts } : {}),
        ...(rec && rec.tintSource ? { tintSource: rec.tintSource } : {}),
        ...(rec && rec.fa ? { fa: rec.fa } : {}),
        ...(targetOf.get(r.key).closed ? { closed: true } : {})
      };
    })
  };
  exported.files['harvest-report.json'] = new TextEncoder().encode(stableStringify(report));
  return { records: sorted, results, report, export: exported, validKeys, entries: byKey };
};

export { canonicalJson, EXT_BY_NAME, KEY_RE, buildTargets, extrasToTargets, mergeTargets };
export { buildFihristTargets, isFihrist, urlIdentity, findDuplicates, dropDuplicates } from './targets.js';
