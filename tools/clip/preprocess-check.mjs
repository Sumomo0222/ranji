// 预处理一致性检查：把浏览器 harness 里「canvas 逐次减半 + 居中裁剪」得到的像素张量导出，
// 与 Transformers.js 处理器（sharp 缩放）得到的张量分别送进同一个 fp32 视觉模型，比较图像向量的余弦相似度。
//   node tools/clip/preprocess-check.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { tf, ROOT, PROJECT, loadVisionStack } from './scripts/tfjs-setup.mjs';
import { cosine } from './scripts/lib/math.mjs';
import { loadRaw, classEmbeds, classify } from './scripts/lib/embeds.mjs';

const PREFIX = '/ranji/';
const MIME = { html: 'text/html; charset=utf-8', mjs: 'text/javascript', wasm: 'application/wasm', onnx: 'application/octet-stream' };
const server = http.createServer((req, res) => {
  const file = path.join(PROJECT, decodeURIComponent(req.url.split('?')[0]).slice(PREFIX.length));
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).slice(1)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage();
await page.goto(`${origin}${PREFIX}tools/clip/harness/page.html`);
await page.waitForFunction(() => window.ortReady === true);

const images = ['food/rice_1.jpg', 'food/kungpao_1.jpg', 'food/pizza_1.jpg', 'food/banana_1.jpg', 'nonfood/dog_1.jpg'];
const mine = [];
for (const rel of images) {
  const b64 = fs.readFileSync(path.join(ROOT, 'test-images', rel)).toString('base64');
  mine.push({ rel, tensor: await page.evaluate(async (b) => Array.from(await window.harnessTensor(b)), b64) });
}
await browser.close();
server.close();

const { processor, visionModel } = await loadVisionStack('fp32');
const classes = classEmbeds(loadRaw(), 'B');
for (const { rel, tensor } of mine) {
  const image = await tf.RawImage.read(path.join(ROOT, 'test-images', rel));
  const ref = (await processor(image)).pixel_values;
  const run = (data) => visionModel({ pixel_values: new tf.Tensor('float32', data, [1, 3, 256, 256]) }).then((o) => o.image_embeds.data);
  const [a, b] = [await run(ref.data), await run(tensor)];
  let maxAbs = 0;
  for (let i = 0; i < tensor.length; i++) maxAbs = Math.max(maxAbs, Math.abs(tensor[i] - ref.data[i]));
  const ca = classify(Array.from(a), classes, { topK: 1 });
  const cb = classify(Array.from(b), classes, { topK: 1 });
  console.log(`${rel.padEnd(22)} ${image.width}x${image.height} → cosine(browser canvas, reference processor) = ${cosine(a, b).toFixed(5)} | top1 reference: ${ca.top[0].zh} ${ca.top[0].p} | top1 browser: ${cb.top[0].zh} ${cb.top[0].p} | ${ca.top[0].id === cb.top[0].id ? 'SAME' : 'DIFF'}`);
}
