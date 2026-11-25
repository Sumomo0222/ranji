// 照片存储：IndexedDB 保存原图与缩略图，列表里只用缩略图，控制内存占用。
const DB_NAME = 'ranji-media';
const STORE = 'media';
let dbPromise = null;
const memory = new Map();
let memoryOnly = false;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('blocked'));
  }).catch((err) => {
    memoryOnly = true;
    console.warn('IndexedDB 不可用，照片只保存在内存中', err);
    return null;
  });
  return dbPromise;
}

function tx(mode, fn) {
  return open().then((db) => {
    if (!db) return fn(null);
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req?.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  });
}

export async function putMedia(record) {
  memory.set(record.id, record);
  await tx('readwrite', (store) => store && store.put(record));
}

export async function getMedia(id, kind = 'thumb') {
  if (!id) return null;
  let rec = memory.get(id);
  if (!rec) {
    rec = await tx('readonly', (store) => store && store.get(id));
    if (rec) memory.set(id, rec);
  }
  return rec?.[kind] || null;
}

export async function deleteMedia(id) {
  memory.delete(id);
  revokeURL(`${id}:thumb`);
  revokeURL(`${id}:full`);
  await tx('readwrite', (store) => store && store.delete(id));
}

export async function clearMedia() {
  memory.clear();
  for (const u of urlCache.values()) URL.revokeObjectURL(u);
  urlCache.clear();
  await tx('readwrite', (store) => store && store.clear());
}

export function isMemoryOnly() {
  return memoryOnly;
}

const urlCache = new Map();

/** 取图片的临时 URL；缩略图带缓存，原图每次查看后可单独释放 */
export async function mediaURL(id, kind = 'thumb') {
  const key = `${id}:${kind}`;
  if (urlCache.has(key)) return urlCache.get(key);
  const blob = await getMedia(id, kind);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  if (kind === 'thumb' && urlCache.size > 400) {
    for (const [k, u] of urlCache) {
      URL.revokeObjectURL(u);
      urlCache.delete(k);
      break;
    }
  }
  if (kind === 'thumb') urlCache.set(key, url);
  return url;
}

export function revokeURL(key) {
  const u = urlCache.get(key);
  if (u) URL.revokeObjectURL(u);
  urlCache.delete(key);
}
