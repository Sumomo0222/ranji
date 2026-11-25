// 离线缓存：先缓存页面骨架，较重的识别引擎文件在首次使用时缓存；之后断网也能打开。
const CACHE = 'ranji-{{version}}';
const PRECACHE = {{precache}};
const SCOPE = new URL(self.registration.scope);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((p) => new URL(p, SCOPE).href)))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('ranji-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(SCOPE.href)) return;
  event.respondWith(handle(req));
});

async function handle(req) {
  const cache = await caches.open(CACHE);
  // 页面本身每次向服务器确认是否有新版本，断网时退回缓存
  if (req.mode === 'navigate') {
    const key = new URL('index.html', SCOPE).href;
    try {
      const fresh = await fetch(req, { cache: 'no-cache' });
      if (fresh && fresh.ok) cache.put(key, fresh.clone());
      return fresh;
    } catch (err) {
      const cached = await cache.match(key);
      if (cached) return cached;
      throw err;
    }
  }
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
  return res;
}
