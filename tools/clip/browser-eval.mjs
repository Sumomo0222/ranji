// 在真实目标环境里评测视觉模型：本地静态服务器把项目根挂在 /ranji/ 下，不发任何跨域隔离头，
// 无头 Chrome 只从同源加载 ORT wasm 与模型，然后对 tools/clip/test-images 里的照片逐张识别。
//   node tools/clip/browser-eval.mjs fp16=tools/clip/cache/hf/onnx/vision_model_fp16.onnx [--limit=2] [--webgpu]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { loadRaw, classEmbeds, classify } from './scripts/lib/embeds.mjs';
import { FOOD_BY_ID } from '../../src/data/foods.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PREFIX = '/ranji/';
const MIME = { html: 'text/html; charset=utf-8', mjs: 'text/javascript; charset=utf-8', js: 'text/javascript; charset=utf-8', wasm: 'application/wasm', onnx: 'application/octet-stream', json: 'application/json', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', css: 'text/css', woff2: 'font/woff2' };
const args = process.argv.slice(2);
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.replace(/^--/, '').split('=')));
const models = args.filter((a) => !a.startsWith('--')).map((a) => a.split('='));

execSync('node tools/clip/harness/build-harness.mjs', { cwd: ROOT, stdio: 'inherit' });

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).slice(PREFIX.length);
  const file = path.join(ROOT, rel);
  if (!req.url.startsWith(PREFIX) || !file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    console.log('404', req.url);
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).slice(1)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: opt.webgpu ? ['--enable-unsafe-webgpu', '--use-angle=metal', '--enable-features=Vulkan', '--use-vulkan=swiftshader'] : [],
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto(`${origin}${PREFIX}tools/clip/harness/page.html`);
await page.waitForFunction(() => window.ortReady === true, null, { timeout: 20000 });
console.log('ORT info:', JSON.stringify(await page.evaluate(() => window.ortInfo)), '| crossOriginIsolated:', await page.evaluate(() => self.crossOriginIsolated));

const raw = loadRaw();
const sets = { A: classEmbeds(raw, 'A'), B: classEmbeds(raw, 'B'), Bhalf: classEmbeds(raw, 'Bhalf'), B7: classEmbeds(raw, 'B7') };

const listDir = (d) => fs.existsSync(path.join(ROOT, d)) ? fs.readdirSync(path.join(ROOT, d)).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort().map((f) => `${d}/${f}`) : [];
const images = [...listDir('tools/clip/test-images/food'), ...listDir('tools/clip/test-images/nonfood'), ...listDir('tools/clip/test-images/extra')];
const limit = opt.limit ? Number(opt.limit) : 0;
const all = await Promise.all(images.map(async (rel) => ({ rel, b64: fs.readFileSync(path.join(ROOT, rel)).toString('base64') })));
const evalImages = limit ? all.slice(0, limit) : all;

const results = {};
for (const [name, rel] of models) {
  const t0 = Date.now();
  const info = await page.evaluate((u) => window.loadModel(u), `${origin}${PREFIX}${rel}`);
  console.log(`\n[${name}] ${rel} — ${(info.bytes / 1048576).toFixed(2)} MB, fetch ${info.fetchMs} ms, session ${info.createMs} ms, in=${info.inputs} out=${info.outputs}`);
  const rows = [];
  for (const img of evalImages) {
    const r = await page.evaluate((b) => window.embedImage(b), img.b64);
    const expected = path.basename(img.rel).replace(/\.\w+$/, '').replace(/_\d+$/, '');
    const expectedZh = FOOD_BY_ID[expected]?.zh ?? expected;
    const row = { image: img.rel, expected, expectedZh, preMs: r.preMs, runMs: r.runMs };
    for (const [k, classes] of Object.entries(sets)) {
      const c = classify(r.embed, classes);
      row[k] = { top: c.top, top1: c.top1, top1Cos: c.top1Cos, bestNegCos: c.bestNegCos, bestNegId: c.bestNegId };
    }
    rows.push(row);
    const b = row.B;
    console.log(`${img.rel.split('/').pop().padEnd(22)} exp=${expectedZh.padEnd(5)} | B: ${b.top.map((t) => `${t.zh} ${t.p}`).join(' > ')} | cos ${b.top1Cos} neg ${b.bestNegCos} | A: ${row.A.top.slice(0, 2).map((t) => t.zh).join('>')} | ${r.preMs}+${r.runMs} ms`);
  }
  results[name] = { model: rel, info, rows };
  console.log(`[${name}] total ${((Date.now() - t0) / 1000).toFixed(1)} s for ${rows.length} images`);

  for (const k of Object.keys(sets)) {
    const food = rows.filter((r) => r.image.includes('/food/') || r.image.includes('/extra/'));
    const non = rows.filter((r) => r.image.includes('/nonfood/'));
    const hit1 = food.filter((r) => r[k].top1 === r.expected).length;
    const hit3 = food.filter((r) => r[k].top.some((t) => t.id === r.expected)).length;
    const correctCos = food.filter((r) => r[k].top1 === r.expected).map((r) => r[k].top1Cos);
    const wrongCos = food.filter((r) => r[k].top1 !== r.expected).map((r) => r[k].top1Cos);
    const nonFoodBest = non.map((r) => r[k].top1Cos);
    const nonNeg = non.map((r) => r[k].bestNegCos);
    const range = (xs) => (xs.length ? `${Math.min(...xs).toFixed(3)}–${Math.max(...xs).toFixed(3)} (med ${xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)].toFixed(3)})` : 'n/a');
    console.log(`  [${k}] top1 ${hit1}/${food.length}  top3 ${hit3}/${food.length} | cos correct: ${range(correctCos)} | cos wrong: ${range(wrongCos)} | non-food best-food cos: ${range(nonFoodBest)} | non-food best-negative cos: ${range(nonNeg)}`);
  }
}
if (errors.length) console.log('\nConsole errors:\n' + errors.join('\n'));
fs.mkdirSync(path.join(ROOT, 'tools/clip/out'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'tools/clip/out/browser-eval.json'), JSON.stringify(results, null, 1));
await browser.close();
server.close();
