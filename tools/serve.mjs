// 本地静态服务器：把指定目录挂在 /ranji/ 子路径下（与 GitHub Pages 一致），不发任何跨域隔离头。
// 供截图、端到端测试使用。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const MIME = {
  html: 'text/html; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  wasm: 'application/wasm',
  json: 'application/json',
  webmanifest: 'application/manifest+json',
  onnx: 'application/octet-stream',
  gz: 'application/gzip',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  woff2: 'font/woff2',
  txt: 'text/plain; charset=utf-8',
  ics: 'text/calendar; charset=utf-8',
};

/** @returns {Promise<{origin:string, close:Function, requests:Array}>} */
export function startServer(rootDir, { prefix = '/ranji/', headers = {} } = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const relPath = decodeURIComponent(url.pathname.slice(prefix.length));
    let file = path.resolve(rootDir, relPath || 'index.html');
    if (!url.pathname.startsWith(prefix) || !file.startsWith(path.resolve(rootDir))) {
      res.writeHead(403).end('forbidden');
      return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) {
      requests.push({ url: req.url, status: 404 });
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found');
      return;
    }
    const ext = path.extname(file).slice(1);
    requests.push({ url: req.url, status: 200 });
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store', ...headers });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        origin: `http://127.0.0.1:${server.address().port}`,
        url: `http://127.0.0.1:${server.address().port}${prefix}`,
        requests,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}
