import dnsPromises from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { headScanner, HEAD_LIMIT } from '../core/head.js';
import { netlifyProtection, headersReader } from '../core/protection.js';

export const LIMITS = Object.freeze({ maxBytes: 512 * 1024, timeoutMs: 8000, maxRedirects: 3, ports: [80, 443, 8080, 8443] });

const SHARED_SUFFIXES = new Set(['netlify.app', 'vercel.app', 'github.io', 'pages.dev', 'web.app', 'firebaseapp.com', 'herokuapp.com', 'onrender.com', 'fly.dev', 'workers.dev', 'surge.sh', 'glitch.me', 'repl.co', 'azurewebsites.net', 'appspot.com', 'cloudfront.net', 'amazonaws.com', 'blogspot.com', 'wixsite.com', 'gitlab.io', 'netlify.com']);
const TWO_PART_SUFFIXES = new Set(['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.jp', 'co.nz', 'co.za', 'com.br', 'com.eg', 'gov.eg', 'edu.eg', 'org.eg', 'com.sa', 'com.tr', 'co.in', 'co.il', 'com.mx', 'com.cn', 'com.hk', 'com.sg']);

export const registrableDomain = (host) => {
  const name = String(host).toLowerCase().replace(/\.$/, '');
  if (net.isIP(name)) return name;
  const labels = name.split('.');
  if (labels.length <= 2) return name;
  const tail = labels.slice(-2).join('.');
  return SHARED_SUFFIXES.has(tail) || TWO_PART_SUFFIXES.has(tail) ? labels.slice(-3).join('.') : tail;
};

const readKnownHosts = () => {
  try {
    const raw = JSON.parse(fs.readFileSync(new URL('./known-hosts.json', import.meta.url), 'utf8'));
    return { hosts: Array.isArray(raw.hosts) ? raw.hosts : [], cdn: Array.isArray(raw.cdn) ? raw.cdn : [] };
  } catch {
    return { hosts: [], cdn: [] };
  }
};
const ALLOWED_TYPES = [/^text\/html\b/i, /^application\/xhtml\+xml\b/i, /^image\//i, /^application\/json\b/i, /^application\/manifest\+json\b/i, /^application\/octet-stream\b/i, /^text\/plain\b/i];
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

const v4Blocked = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4]
];

const v4ToInt = (ip) => ip.split('.').reduce((n, p) => n * 256 + Number(p), 0);
const inV4 = (ip, base, bits) => {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((v4ToInt(ip) & mask) >>> 0) === ((v4ToInt(base) & mask) >>> 0);
};

const expandV6 = (ip) => {
  let s = ip.toLowerCase().split('%')[0];
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (tail) {
    const n = v4ToInt(tail[1]);
    s = s.slice(0, tail.index) + ((n >>> 16) & 0xffff).toString(16) + ':' + (n & 0xffff).toString(16);
  }
  const [head, rest] = s.split('::');
  const a = head ? head.split(':') : [];
  const b = rest === undefined ? [] : rest ? rest.split(':') : [];
  const fill = rest === undefined ? 0 : 8 - a.length - b.length;
  return [...a, ...Array(Math.max(0, fill)).fill('0'), ...b].map((h) => parseInt(h || '0', 16));
};

const v4FromWords = (hi, lo) => [hi >> 8, hi & 255, lo >> 8, lo & 255].join('.');

export const isPrivateAddress = (ip) => {
  if (net.isIPv4(ip)) return v4Blocked.some(([base, bits]) => inV4(ip, base, bits));
  if (!net.isIPv6(ip)) return true;
  const w = expandV6(ip);
  if (w.every((x) => x === 0)) return true;
  if (w.slice(0, 7).every((x) => x === 0) && w[7] === 1) return true;
  if ((w[0] & 0xfe00) === 0xfc00) return true;
  if ((w[0] & 0xffc0) === 0xfe80) return true;
  if ((w[0] & 0xffc0) === 0xfec0) return true;
  if ((w[0] & 0xff00) === 0xff00) return true;
  if (w[0] === 0x2001 && w[1] === 0x0db8) return true;
  if (w.slice(0, 5).every((x) => x === 0) && w[5] === 0xffff) return isPrivateAddress(v4FromWords(w[6], w[7]));
  if (w.slice(0, 6).every((x) => x === 0)) return isPrivateAddress(v4FromWords(w[6], w[7]));
  if (w[0] === 0x0064 && w[1] === 0xff9b) return isPrivateAddress(v4FromWords(w[6], w[7]));
  if (w[0] === 0x2002) return isPrivateAddress(v4FromWords(w[1], w[2]));
  return false;
};

export class ProxyError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const defaultResolve = async (host) => {
  const list = await dnsPromises.lookup(host, { all: true, verbatim: true });
  return list.map((r) => ({ address: r.address, family: r.family }));
};

const defaultRequest = ({ url, address, family, headers, timeoutMs }) =>
  new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(
      url,
      { method: 'GET', headers, timeout: timeoutMs, lookup: (_h, o, cb) => (o && o.all ? cb(null, [{ address, family }]) : cb(null, address, family)), servername: net.isIP(url.hostname) ? undefined : url.hostname },
      (res) => resolve({ status: res.statusCode, headers: res.headers, body: res, destroy: () => res.destroy() })
    );
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    req.end();
  });

const parseTarget = (raw) => {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new ProxyError(400, 'url is not valid');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ProxyError(400, 'only http and https are allowed');
  if (url.username || url.password) throw new ProxyError(400, 'credentials in the url are not allowed');
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  if (!LIMITS.ports.includes(port)) throw new ProxyError(403, 'port is not allowed');
  return url;
};

const pickAddress = async (url, resolve) => {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new ProxyError(403, 'address is not allowed');
    return { address: host, family: net.isIPv6(host) ? 6 : 4 };
  }
  if (/^localhost$|\.localhost$|\.local$|\.internal$/i.test(host)) throw new ProxyError(403, 'host is not allowed');
  let list;
  try {
    list = await resolve(host);
  } catch {
    throw new ProxyError(502, 'host could not be resolved');
  }
  if (!list || !list.length) throw new ProxyError(502, 'host could not be resolved');
  if (list.some((r) => isPrivateAddress(r.address))) throw new ProxyError(403, 'address is not allowed');
  return list[0];
};

export const fetchUpstream = async (rawUrl, { resolve = defaultResolve, request = defaultRequest, limits = LIMITS, onRedirect = null, conditional = {} } = {}) => {
  let url = parseTarget(rawUrl);
  let viaCdn = false;
  for (let hop = 0; hop <= limits.maxRedirects; hop++) {
    const { address, family } = await pickAddress(url, resolve);
    let res;
    try {
      res = await request({ url, address, family, headers: { 'user-agent': 'Mozilla/5.0 HarvestStudioFetch', accept: '*/*', 'accept-encoding': 'identity', ...conditional }, timeoutMs: limits.timeoutMs });
    } catch (e) {
      if (e && (e.code === 'ETIMEDOUT' || e.message === 'timeout')) throw new ProxyError(504, 'upstream timed out');
      throw new ProxyError(502, 'upstream request failed');
    }
    if (REDIRECTS.has(res.status) && res.headers.location) {
      if (res.destroy) res.destroy();
      if (hop === limits.maxRedirects) throw new ProxyError(502, 'too many redirects');
      let next;
      try {
        next = new URL(res.headers.location, url);
      } catch {
        throw new ProxyError(502, 'bad redirect');
      }
      url = parseTarget(next.href);
      if (onRedirect && onRedirect(url) === 'cdn') viaCdn = true;
      continue;
    }
    return { res, url, viaCdn };
  }
  throw new ProxyError(502, 'too many redirects');
};

const readHeadCapped = async (res, timeoutMs) => {
  const seen = headScanner();
  const chunks = [];
  let size = 0;
  let cut = false;
  const deadline = Date.now() + timeoutMs;
  for await (const chunk of res.body) {
    chunks.push(Buffer.from(chunk));
    size += chunk.length;
    if (seen(chunk) || size >= HEAD_LIMIT) {
      cut = true;
      if (res.destroy) res.destroy();
      break;
    }
    if (Date.now() > deadline) {
      if (res.destroy) res.destroy();
      throw new ProxyError(504, 'upstream timed out');
    }
  }
  return { body: Buffer.concat(chunks).subarray(0, HEAD_LIMIT), cut };
};

const readCapped = async (res, maxBytes, timeoutMs) => {
  const chunks = [];
  let size = 0;
  const deadline = Date.now() + timeoutMs;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > maxBytes) {
      if (res.destroy) res.destroy();
      throw new ProxyError(413, 'response is larger than ' + maxBytes + ' bytes');
    }
    chunks.push(Buffer.from(chunk));
    if (Date.now() > deadline) {
      if (res.destroy) res.destroy();
      throw new ProxyError(504, 'upstream timed out');
    }
  }
  return Buffer.concat(chunks);
};

const sameToken = (given, expected) => {
  const a = crypto.createHash('sha256').update(String(given || '')).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
};

export const DEFAULT_RATE = 1200;
const RATE_WINDOW_MS = 60000;

export const createLimiter = ({ limit, now = Date.now, windowMs = RATE_WINDOW_MS }) => {
  const windows = new Map();
  return (key) => {
    if (!limit) return { ok: true };
    const t = now();
    if (windows.size > 1000) for (const [k, w] of windows) if (t - w.start >= windowMs) windows.delete(k);
    let w = windows.get(key);
    if (!w || t - w.start >= windowMs) {
      w = { start: t, count: 0 };
      windows.set(key, w);
    }
    if (w.count >= limit) return { ok: false, retryAfter: Math.max(1, Math.ceil((w.start + windowMs - t) / 1000)) };
    w.count++;
    return { ok: true };
  };
};

export const DEFAULT_PUBLIC_RATE = 300;

const rateFrom = (env, name = 'STUDIO_RATE_LIMIT', fallback = DEFAULT_RATE) => {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
};

const cors = (res, env) => {
  res.setHeader('access-control-allow-origin', env.STUDIO_ORIGIN || '*');
  res.setHeader('access-control-allow-headers', 'x-studio-token, if-none-match, if-modified-since');
  res.setHeader('access-control-allow-methods', 'GET, OPTIONS');
  res.setHeader('access-control-expose-headers', 'x-upstream-status, x-upstream-url, x-upstream-truncated, x-upstream-protection, x-upstream-etag, x-upstream-last-modified, x-vercel-mitigated, retry-after, content-type');
  res.setHeader('vary', 'origin, x-studio-token, sec-fetch-site');
  res.setHeader('cache-control', 'no-store');
};

const originOf = (value) => {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

const isSameOriginBrowser = (req, env) => {
  if (String(req.headers['sec-fetch-site'] || '').toLowerCase() !== 'same-origin') return false;
  const given = req.headers.origin || req.headers.referer;
  if (!given) return true;
  const origin = originOf(given);
  if (!origin) return false;
  const allowed = new Set();
  if (req.headers.host) {
    allowed.add('https://' + req.headers.host);
    allowed.add('http://' + req.headers.host);
  }
  if (env.STUDIO_ORIGIN && originOf(env.STUDIO_ORIGIN)) allowed.add(originOf(env.STUDIO_ORIGIN));
  return allowed.has(origin);
};

const clientKey = (req) => {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const address = forwarded || (req.socket && req.socket.remoteAddress) || 'unknown';
  return crypto.createHash('sha256').update(address).digest('hex');
};

const hostListed = (list, host) => list.has(String(host).toLowerCase());

export const createHandler = ({ resolve = defaultResolve, request = defaultRequest, env = process.env, limits = LIMITS, now = Date.now, known = readKnownHosts() } = {}) => {
  const allow = createLimiter({ limit: rateFrom(env), now });
  const allowPublic = createLimiter({ limit: rateFrom(env, 'STUDIO_PUBLIC_RATE', DEFAULT_PUBLIC_RATE), now });
  const knownHosts = new Set((known.hosts || []).map((h) => String(h).toLowerCase()));
  const cdnHosts = new Set((known.cdn || []).map((h) => String(h).toLowerCase()));
  return async (req, res) => {
    cors(res, env);
    const send = (status, body, type = 'application/json') => {
      res.statusCode = status;
      res.setHeader('content-type', type);
      res.end(type === 'application/json' ? JSON.stringify(body) : body);
    };
    try {
      if (req.method === 'OPTIONS') return send(204, '', 'text/plain');
      if (req.method !== 'GET') throw new ProxyError(405, 'use GET');
      const params = new URL(req.url, 'http://local').searchParams;
      const sameOrigin = isSameOriginBrowser(req, env);
      if (params.get('probe') === '1') return send(200, { ok: true, mode: sameOrigin && knownHosts.size ? 'public' : 'token' });
      const header = req.headers['x-studio-token'];
      const target = params.get('url');
      let tokenless = false;
      if (header === undefined && sameOrigin) {
        if (!target) throw new ProxyError(400, 'url is required');
        const first = parseTarget(target);
        if (!hostListed(knownHosts, first.hostname)) throw new ProxyError(401, 'missing or wrong access token');
        const turn = allowPublic(clientKey(req));
        if (!turn.ok) {
          res.setHeader('retry-after', String(turn.retryAfter));
          throw new ProxyError(429, 'rate limit reached, try again in ' + turn.retryAfter + ' seconds');
        }
        tokenless = true;
      } else {
        if (!env.STUDIO_TOKEN) throw new ProxyError(500, 'the proxy has no STUDIO_TOKEN configured');
        if (!sameToken(header, env.STUDIO_TOKEN)) throw new ProxyError(401, 'missing or wrong access token');
        const turn = allow(crypto.createHash('sha256').update(String(header)).digest('hex'));
        if (!turn.ok) {
          res.setHeader('retry-after', String(turn.retryAfter));
          throw new ProxyError(429, 'rate limit reached, try again in ' + turn.retryAfter + ' seconds');
        }
      }
      if (!target) throw new ProxyError(400, 'url is required');
      const origin = tokenless ? registrableDomain(parseTarget(target).hostname) : null;
      const onRedirect = tokenless
        ? (next) => {
            if (hostListed(knownHosts, next.hostname) || registrableDomain(next.hostname) === origin) return 'ok';
            if (hostListed(cdnHosts, next.hostname)) return 'cdn';
            throw new ProxyError(403, 'redirect target is not allowed');
          }
        : null;
      const conditional = {};
      const etagIn = String(req.headers['if-none-match'] || '');
      const sinceIn = String(req.headers['if-modified-since'] || '');
      if (etagIn && etagIn.length <= 256 && !/[\r\n]/.test(etagIn)) conditional['if-none-match'] = etagIn;
      if (sinceIn && sinceIn.length <= 64 && !/[\r\n]/.test(sinceIn)) conditional['if-modified-since'] = sinceIn;
      const { res: up, url, viaCdn } = await fetchUpstream(target, { resolve, request, limits, onRedirect, conditional });
      const type = String(up.headers['content-type'] || '');
      if (type && !ALLOWED_TYPES.some((re) => re.test(type))) {
        if (up.destroy) up.destroy();
        throw new ProxyError(415, 'content type ' + type.split(';')[0] + ' is not allowed');
      }
      if (viaCdn && up.status !== 304 && !/^(image\/|text\/html\b|application\/xhtml\+xml\b)/i.test(type)) {
        if (up.destroy) up.destroy();
        throw new ProxyError(403, 'redirect target is not allowed');
      }
      const wantHead = params.get('mode') === 'head' && /^(text\/html|application\/xhtml\+xml)/i.test(type);
      const read = up.status === 304 ? { body: Buffer.alloc(0), cut: false } : wantHead ? await readHeadCapped(up, limits.timeoutMs) : { body: await readCapped(up, limits.maxBytes, limits.timeoutMs), cut: false };
      if (up.status === 304 && up.destroy) up.destroy();
      const body = read.body;
      if (read.cut) res.setHeader('x-upstream-truncated', 'head');
      res.setHeader('x-upstream-status', String(up.status));
      res.setHeader('x-upstream-url', url.href);
      if (up.headers.etag) res.setHeader('x-upstream-etag', String(up.headers.etag).slice(0, 256));
      if (up.headers['last-modified']) res.setHeader('x-upstream-last-modified', String(up.headers['last-modified']).slice(0, 64));
      if (up.headers['x-vercel-mitigated']) res.setHeader('x-vercel-mitigated', String(up.headers['x-vercel-mitigated']));
      const protection = netlifyProtection(up.status, headersReader(up.headers));
      if (protection) res.setHeader('x-upstream-protection', protection);
      res.statusCode = 200;
      res.setHeader('content-type', type || 'application/octet-stream');
      if (up.status === 200 && /^image\//i.test(type)) res.setHeader('cache-control', 'private, max-age=300');
      res.end(body);
    } catch (e) {
      if (e instanceof ProxyError) return send(e.status, { error: e.message });
      return send(502, { error: 'upstream request failed' });
    }
  };
};

export default createHandler();
