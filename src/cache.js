const DB = 'hs:cache';
const STORE = 'entries';
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const CACHE_LIMIT_BYTES = 50 * 1024 * 1024;

let opened = null;

const open = () =>
  (opened ||= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        const store = db.createObjectStore(STORE, { keyPath: 'key' });
        store.createIndex('used', 'used');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  }));

const run = async (mode, fn) => {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      const out = fn(store);
      tx.oncomplete = () => resolve(out && 'result' in out ? out.result : out);
      tx.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
};

export const cacheGet = (key) => run('readonly', (store) => store.get(key));

const trim = async () => {
  const db = await open();
  if (!db) return;
  await new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const seen = [];
      const cursor = store.index('used').openCursor();
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (c) {
          seen.push({ key: c.value.key, size: c.value.size || 0 });
          c.continue();
          return;
        }
        let total = seen.reduce((n, e) => n + e.size, 0);
        for (const e of seen) {
          if (total <= CACHE_LIMIT_BYTES) break;
          store.delete(e.key);
          total -= e.size;
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
};

export const cachePut = async (entry) => {
  const now = Date.now();
  await run('readwrite', (store) => store.put({ ...entry, at: now, used: now, size: entry.bytes.byteLength }));
  await trim();
};

export const cacheTouch = async (entry) => {
  await run('readwrite', (store) => store.put({ ...entry, at: Date.now(), used: Date.now() }));
};

export const cacheFresh = (entry, now = Date.now()) => !!entry && now - entry.at < CACHE_TTL_MS;
