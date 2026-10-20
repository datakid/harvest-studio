const DB = 'harvest-studio';
const META = 'meta';
const DATA = 'data';
const LIMIT = 12;

let dbPromise = null;

const openDb = () => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(META, { keyPath: 'id' });
        req.result.createObjectStore(DATA, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
};

const wrap = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const done = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

export const newId = () => {
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  return a[0].toString(36) + a[1].toString(36);
};

export const listProjects = async () => {
  const db = await openDb();
  if (!db) return [];
  try {
    const all = await wrap(db.transaction(META).objectStore(META).getAll());
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
};

export const saveProject = async (meta, payload) => {
  const db = await openDb();
  if (!db) return false;
  try {
    const tx = db.transaction([META, DATA], 'readwrite');
    tx.objectStore(META).put(meta);
    tx.objectStore(DATA).put({ id: meta.id, payload });
    const all = await wrap(tx.objectStore(META).getAll());
    const extra = all.sort((a, b) => b.updatedAt - a.updatedAt).slice(LIMIT);
    for (const m of extra) {
      tx.objectStore(META).delete(m.id);
      tx.objectStore(DATA).delete(m.id);
    }
    await done(tx);
    return true;
  } catch {
    return false;
  }
};

export const loadProject = async (id) => {
  const db = await openDb();
  if (!db) return null;
  try {
    const row = await wrap(db.transaction(DATA).objectStore(DATA).get(id));
    return row ? row.payload : null;
  } catch {
    return null;
  }
};

export const removeProject = async (id) => {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction([META, DATA], 'readwrite');
    tx.objectStore(META).delete(id);
    tx.objectStore(DATA).delete(id);
    await done(tx);
  } catch {}
};
