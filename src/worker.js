import {
  configureRuntime,
  runHarvest,
  processTarget,
  analyzeIcon,
  rerender,
  cleanAdjust,
  traceGlyphAuto,
  tintV4,
  readPrevious,
  decodeImage,
  pixelHash,
  encodePng,
  buildLauncherExport,
  buildCustomExport,
  buildFaviconPack,
  zipFiles,
  stableStringify,
  siteReports,
  readHead,
  urlIdentity,
  netlifyProtection,
  headersReader,
  errText,
  DEFAULT_CELL
} from '../core/index.js';
import { cacheGet, cachePut, cacheTouch, cacheFresh } from './cache.js';

const FETCH_TIMEOUT = 20000;
let wasmBase = './wasm/';
let shippedPins = null;
configureRuntime({
  wasmSource: async (id) => {
    const res = await fetch(wasmBase + id + '.wasm');
    if (!res.ok) throw new Error('could not load ' + id + '.wasm');
    return res.arrayBuffer();
  },
  fontSource: async () => {
    const res = await fetch(wasmBase.replace(/wasm\/$/, '') + 'fonts/readex-pro-text.ttf');
    if (!res.ok) throw new Error('could not load the text font');
    return res.arrayBuffer();
  }
});

let records = new Map();
let lastReport = null;
let knownIndex = null;
let knownUrls = null;
let settings = { proxyUrl: '', proxyToken: '' };
let revalidate = false;

const makeIo = () => ({
  fetchBytes: async (url, options = {}) => {
    if (!settings.proxyUrl) {
      let res;
      try {
        res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(FETCH_TIMEOUT) });
      } catch (err) {
        if (err && err.name === 'TimeoutError') {
          const e = new Error('timed out after ' + FETCH_TIMEOUT / 1000 + ' seconds');
          e.timeout = true;
          throw e;
        }
        const e = new Error('needs the fetch proxy: this site does not allow direct browser access');
        e.fatal = true;
        throw e;
      }
      const bytes = options.head && res.body ? await readHead(res.body) : new Uint8Array(await res.arrayBuffer());
      return { ok: res.ok, status: res.status, url: res.url || url, bytes, mitigated: null, protection: netlifyProtection(res.status, headersReader(res.headers)) };
    }
    const target = settings.proxyUrl + (settings.proxyUrl.includes('?') ? '&' : '?') + 'url=' + encodeURIComponent(url) + (options.head ? '&mode=head' : '');
    const cacheKey = url + (options.head ? '#head' : '');
    const hit = await cacheGet(cacheKey);
    const served = (entry) => ({ ok: true, status: entry.status, url: entry.url, bytes: entry.bytes, mitigated: null, protection: null, cached: true });
    if (hit && !revalidate && cacheFresh(hit)) {
      cacheTouch(hit);
      return served(hit);
    }
    const conditional = {};
    if (hit && hit.etag) conditional['if-none-match'] = hit.etag;
    else if (hit && hit.lastModified) conditional['if-modified-since'] = hit.lastModified;
    let res;
    try {
      res = await fetch(target, { headers: { ...(settings.proxyToken ? { 'x-studio-token': settings.proxyToken } : {}), ...conditional }, signal: AbortSignal.timeout(FETCH_TIMEOUT) });
    } catch (err) {
      if (err && err.name === 'TimeoutError') {
        const e = new Error('the proxy did not answer within ' + FETCH_TIMEOUT / 1000 + ' seconds');
        e.timeout = true;
        throw e;
      }
      const e = new Error('could not reach the proxy');
      e.fatal = true;
      throw e;
    }
    if (res.status === 401) {
      const e = new Error(settings.proxyToken ? 'the proxy rejected the access token' : 'the proxy needs an access token for this site, and serves only the known sites without one; add a proxy address and access token in Settings');
      e.fatal = true;
      throw e;
    }
    if (res.status === 429 && !res.headers.get('x-upstream-status')) {
      const e = new Error('the proxy rate limit was reached, wait ' + (res.headers.get('retry-after') || 'a minute') + ' seconds and run again');
      e.fatal = true;
      throw e;
    }
    if (!res.headers.get('x-upstream-status')) {
      let why = 'HTTP ' + res.status;
      try {
        why = (await res.json()).error || why;
      } catch {}
      const e = new Error('proxy: ' + why);
      if (res.status === 504) e.timeout = true;
      throw e;
    }
    const upstream = Number(res.headers.get('x-upstream-status')) || res.status;
    if (upstream === 304 && hit) {
      cacheTouch(hit);
      return served(hit);
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const out = { ok: upstream >= 200 && upstream < 300, status: upstream, url: res.headers.get('x-upstream-url') || url, bytes, mitigated: res.headers.get('x-vercel-mitigated'), protection: res.headers.get('x-upstream-protection') };
    if (out.ok && !out.mitigated && !out.protection && bytes.length) {
      cachePut({ key: cacheKey, status: upstream, url: out.url, etag: res.headers.get('x-upstream-etag') || null, lastModified: res.headers.get('x-upstream-last-modified') || null, bytes });
    }
    return out;
  },
  readLocal: async () => null,
  readKnown: async (key, url) => {
    const base = wasmBase.replace(/wasm\/$/, '') + 'known/';
    knownIndex ||= fetch(base + 'index.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    knownUrls ||= fetch(base + 'urls.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    const file = (await knownIndex)[key] || (url && (await knownUrls)[urlIdentity(url)]);
    if (!file) return null;
    const res = await fetch(base + file);
    return res.ok ? { bytes: new Uint8Array(await res.arrayBuffer()), file: 'known/' + file } : null;
  },
  readOverride: async () => {
    throw new Error('overrides are not available in the browser');
  },
  readOutput: async () => null
});

const pngOf = async (img) => (img ? encodePng(img, { optimise: false }) : null);

const serialise = async (rec) => {
  const favicon = await pngOf(rec.image);
  const glyph = rec.glyphImage ? await pngOf(rec.glyphImage) : null;
  const payload = {
    key: rec.key,
    appId: rec.appId,
    status: rec.status,
    base: rec.base || null,
    tint: rec.tint || null,
    sourceTint: rec.sourceTint || null,
    locked: !!rec.locked,
    groupId: rec.groupId || null,
    tight: !!rec.tight,
    contrast: rec.contrast || null,
    colour: rec.colour ? { share: rec.colour.share } : null,
    hash: rec.hash || null,
    hasOriginal: !!rec.original,
    adjust: rec.adjust || null,
    trace: rec.trace ? { accepted: rec.trace.accepted, d: rec.trace.d, ...(rec.trace.layers ? { layers: rec.trace.layers } : {}), bytes: rec.trace.bytes, iou: rec.trace.iou, reason: rec.trace.reason } : null,
    favicon,
    glyph
  };
  return payload;
};

let reportItems = new Map();
const reusePool = new Map();

const mapLimit = async (items, n, fn) => {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
};

const addSiteReports = (files, now) => {
  const docs = siteReports(lastReport.items, { generatedAt: now });
  for (const [name, doc] of Object.entries(docs)) files[name] = new TextEncoder().encode(stableStringify(doc));
};

const summarise = () => {
  const items = [...reportItems.values()];
  const count = (status) => items.filter((i) => i.status === status).length;
  return { total: items.length, found: count('found'), override: count('override'), stale: count('stale'), blocked: count('blocked'), default: count('default'), notfound: count('notfound') };
};

const runBatch = async (p, post) => {
  revalidate = !!p.fresh;
  const targets = p.targets.map((t) => ({ ...t }));
  shippedPins ||= fetch(wasmBase.replace(/wasm\/$/, '') + 'source-pins.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  const pins = { ...(await shippedPins), ...(p.pins || {}) };
  const result = await runHarvest(
    { targets, overrides: {}, pins, adjust: p.adjust || {} },
    {
      profile: 'launcher',
      seed: p.seed,
      mode: p.mode === 'separate' ? 'separate' : 'keep',
      target: p.target === 'v4' ? 'v4' : 'v3',
      preview: true,
      faFallback: !!p.faFallback,
      cell: p.cell || DEFAULT_CELL,
      reuse: reusePool,
      now: new Date().toISOString(),
      onProgress: (e) => post({ progress: e }),
      onTarget: async (r) => {
        if (!r.image) return;
        post({ progress: { phase: 'tile', key: r.key, favicon: await pngOf(r.image) } });
      }
    },
    makeIo()
  );
  for (const r of result.records) records.set(r.key, r);
  for (const [k, v] of result.reusable) reusePool.set(k, v);
  for (const i of result.report.items) reportItems.set(i.key, i);
  lastReport = { ...result.report, items: [...reportItems.values()].sort((a, b) => (a.key < b.key ? -1 : 1)), summary: summarise() };
  const out = await mapLimit(result.records, 4, serialise);
  const transfer = [];
  for (const r of out) {
    if (r.favicon) transfer.push(r.favicon.buffer);
    if (r.glyph) transfer.push(r.glyph.buffer);
  }
  return { value: { records: out, items: result.report.items, summary: result.report.summary, polish: result.report.polish }, transfer };
};

const restoreOne = async (r) => {
  const image = r.favicon ? (await decodeImage(r.favicon, 'png')).image : null;
  const glyphImage = r.glyph ? (await decodeImage(r.glyph, 'png')).image : null;
  const original = r.original ? (await decodeImage(r.original, 'png')).image : null;
  records.set(r.key, { key: r.key, appId: r.appId, status: r.status, image, original, glyphImage, trace: r.trace || null, base: r.base || null, tint: r.tint || null, sourceTint: r.sourceTint || null, locked: !!r.locked, hash: r.hash || null, adjust: r.adjust ? cleanAdjust(r.adjust) : null });
};

const handlers = {
  async configure(p) {
    if (p.wasmBase) wasmBase = p.wasmBase;
    settings = { ...settings, ...(p.settings || {}) };
    return { ok: true };
  },

  async harvest(p, post) {
    if (p.reset !== false) {
      records = new Map();
      reportItems = new Map();
    }
    return runBatch(p, post);
  },

  async add(p, post) {
    return runBatch(p, post);
  },

  async remove(p) {
    records.delete(p.key);
    reportItems.delete(p.key);
    return { ok: true, count: records.size };
  },

  async put(p) {
    await restoreOne(p.record);
    return { ok: true, count: records.size };
  },

  async importManifest(p) {
    const files = new Map(Object.entries(p.files || {}));
    const io = { readOutput: async (name) => (name === 'manifest.v2.json' ? new TextEncoder().encode(JSON.stringify(p.manifest)) : files.get(name) || null) };
    const { prev, cell, seed } = await readPrevious([], io);
    records = new Map();
    const items = [];
    const out = [];
    for (const [key, v] of [...prev.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const appId = key.split('--')[0];
      const hasImage = !!v.image;
      const rec = {
        key,
        appId,
        status: hasImage ? v.status || 'found' : 'notfound',
        image: v.image || null,
        glyphImage: v.glyphImage || null,
        trace: v.trace ? { ...v.trace, bytes: v.trace.d.length } : null,
        base: v.sourceTint || v.tint || null,
        tint: v.tint || null,
        sourceTint: v.sourceTint || null,
        locked: !!v.locked,
        hash: v.hash || null
      };
      records.set(key, rec);
      items.push({ key, status: rec.status, source: { type: 'manifest', href: '' }, error: hasImage ? null : 'not in the atlas' });
      out.push(await serialise(rec));
    }
    const transfer = [];
    for (const r of out) {
      if (r.favicon) transfer.push(r.favicon.buffer);
      if (r.glyph) transfer.push(r.glyph.buffer);
    }
    return { value: { records: out, items, seed: seed || null, cell: cell || DEFAULT_CELL, v4: [...prev.values()].some((v) => v.v4) }, transfer };
  },

  async originals() {
    const out = {};
    for (const [key, rec] of records) if (rec.original) out[key] = await pngOf(rec.original);
    return out;
  },

  async restore(p) {
    records = new Map();
    reportItems = new Map();
    for (const r of p.records) await restoreOne(r);
    return { ok: true, count: records.size };
  },

  async adjust(p) {
    const rec = records.get(p.key);
    if (!rec) throw new Error('unknown icon');
    const out = await rerender(rec, p.adjust, { target: p.target === 'v4' ? 'v4' : 'v3' });
    const next = { ...rec, image: out.image, glyphImage: out.glyphImage, trace: out.trace, adjust: Object.keys(out.adjust).length ? out.adjust : null };
    next.hash = await pixelHash(out.image);
    records.set(p.key, next);
    const payload = await serialise(next);
    const transfer = [];
    if (payload.favicon) transfer.push(payload.favicon.buffer);
    if (payload.glyph) transfer.push(payload.glyph.buffer);
    return { value: payload, transfer };
  },

  async replace(p) {
    const { key, appId, bytes, fileName } = p;
    const target = { key, appId, bytes, fileName };
    const r = await processTarget(target, { io: makeIo(), overrides: {}, local: false });
    if (!r.image) throw new Error(r.error || 'not a usable image');
    const launcherTarget = p.target === 'v4' ? 'v4' : 'v3';
    const analysis = await analyzeIcon(r.image, { target: launcherTarget });
    const found = analysis.gradient || analysis.accent;
    const tint = launcherTarget === 'v4' && Array.isArray(found) ? tintV4(found[0]) : found;
    const prev = records.get(key) || { key, appId };
    const rec = {
      ...prev,
      key,
      appId,
      status: 'override',
      image: r.image,
      original: r.original || null,
      hash: await pixelHash(r.image),
      base: tint,
      sourceTint: tint,
      tint,
      tintRole: 'brand',
      glyphImage: analysis.glyph,
      trace: analysis.glyph ? await traceGlyphAuto(analysis.glyph, key) : null,
      locked: false
    };
    records.set(key, rec);
    const out = await serialise(rec);
    const transfer = [];
    if (out.favicon) transfer.push(out.favicon.buffer);
    if (out.glyph) transfer.push(out.glyph.buffer);
    return { value: out, transfer };
  },

  async build(p) {
    const only = Array.isArray(p.keys) && p.kind !== 'launcher' ? new Set(p.keys) : null;
    const patched = [...records.values()].map((r) => ({ ...r, ...(p.patches[r.key] || {}) })).filter((r) => (!only || only.has(r.key)) && (p.kind === 'pack' || p.kind === 'packs' || !(r.adjust && r.adjust.exclude)));
    const sorted = patched.sort((a, b) => (a.key < b.key ? -1 : 1));
    const now = new Date().toISOString();
    if (p.kind === 'launcher') {
      const exp = await buildLauncherExport(sorted, { cell: p.cell || DEFAULT_CELL, generatedAt: now, seed: p.seed, target: p.target === 'v4' ? 'v4' : 'v3' });
      if (lastReport) exp.files['harvest-report.json'] = new TextEncoder().encode(stableStringify({ ...lastReport, atlas: { cell: lastReport.atlas.cell, cellDefaulted: lastReport.atlas.cellDefaulted, ...exp.stats }, gate: { ok: exp.gate.ok, failures: exp.gate.failures }, generatedAt: now, note: 'Written by the Studio from the last harvest; edits made afterwards are not reflected.' }));
      if (lastReport) addSiteReports(exp.files, now);
      const zip = zipFiles(exp.files, 'icons/');
      return { value: { gate: exp.gate, stats: exp.stats, zip, files: Object.keys(exp.files) }, transfer: [zip.buffer] };
    }
    if (p.kind === 'report') {
      if (!lastReport) throw new Error('nothing harvested yet');
      const files = {};
      files['harvest-report.json'] = new TextEncoder().encode(stableStringify({ ...lastReport, generatedAt: now }));
      addSiteReports(files, now);
      const zip = zipFiles(files, 'report/');
      return { value: { zip, files: Object.keys(files) }, transfer: [zip.buffer] };
    }
    if (p.kind === 'pack') {
      const rec = sorted.find((r) => r.key === p.key) || sorted.find((r) => r.image);
      const pack = await buildFaviconPack(rec, { name: p.name || rec.key, background: p.background || '#ffffff', themeColor: p.themeColor || null });
      return { value: { zip: pack.zip, head: pack.head, files: Object.keys(pack.files) }, transfer: [pack.zip.buffer] };
    }
    if (p.kind === 'packs') {
      const files = {};
      for (const rec of sorted.filter((r) => r.image)) {
        const pack = await buildFaviconPack(rec, { name: p.names && p.names[rec.key] ? p.names[rec.key] : rec.key, background: p.background || '#ffffff', themeColor: p.themeColor || null });
        for (const [name, bytes] of Object.entries(pack.files)) files[rec.key + '/' + name] = bytes;
      }
      const zip = zipFiles(files, '');
      return { value: { zip, files: Object.keys(files) }, transfer: [zip.buffer] };
    }
    const exp = await buildCustomExport(sorted, { formats: p.formats, sizes: p.sizes, quality: p.quality || 90, lossless: !!p.lossless });
    return { value: { zip: exp.zip, files: Object.keys(exp.files) }, transfer: [exp.zip.buffer] };
  }
};

self.onmessage = async (event) => {
  const { id, type, payload } = event.data;
  const post = (extra, transfer = []) => self.postMessage({ id, ...extra }, transfer);
  try {
    const out = await handlers[type](payload || {}, (e) => post(e));
    const value = out && out.value !== undefined ? out.value : out;
    post({ done: true, value }, out && out.transfer ? out.transfer : []);
  } catch (e) {
    post({ done: true, error: errText(e) });
  }
};
