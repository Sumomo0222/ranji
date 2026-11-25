// 离线缓存：先缓存页面骨架，较重的识别引擎文件在首次使用时缓存；之后断网也能打开。
const CACHE = 'ranji-f920e8d3fd';
const PRECACHE = ["index.html","manifest.webmanifest","assets/chunk-RI5Y5CVX.js","assets/chunk-YWGHLPL2.js","assets/app-YMZ7TCKP.js","assets/chunk-4W64T2HX.js","assets/chunk-KUZXBRJN.js","assets/chunk-YIK4CGDH.js","assets/chunk-FY6NQKVE.js","assets/chunk-4KUQ3LJT.js","assets/chunk-7O67DETB.js","assets/chunk-MI7J6KMD.js","assets/chunk-RCCYROMV.js","assets/chunk-SLXKKKRS.js","assets/chunk-3EXR5KWZ.js","assets/chunk-4PH5DLVN.js","assets/chunk-6BWAJPTJ.js","assets/chunk-DQJAMBFT.js","assets/chunk-PWJPVLUS.js","assets/chunk-MG3LHTER.js","assets/chunk-NRJFKZEI.js","assets/chunk-IUE6Y6OC.js","assets/chunk-NCAWPVFF.js","assets/chunk-GXNDVKMA.js","assets/app.fddd2af31d.css","fonts/fonts.css","fonts/newsreader-latin-400-italic.woff2","fonts/newsreader-latin-400-normal.woff2","fonts/newsreader-latin-500-italic.woff2","fonts/oswald-latin-500-normal.woff2","fonts/oswald-latin-600-normal.woff2","icons/icon-180.png","icons/icon-192.png","icons/icon-512.png","icons/icon-64.png","icons/icon.svg","icons/maskable-512.png","paper.css","textures/paper.png","vendor/ort/ort-wasm-simd-threaded.mjs"];
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
