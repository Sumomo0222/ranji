// 构建：打包脚本与样式（内容哈希文件名）、生成离线缓存清单、把静态资源汇总到 docs/。
//   node tools/build.mjs
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const STATIC = path.join(ROOT, 'static');
const OUT = path.join(ROOT, 'docs');

// 较重的识别引擎文件：不进首屏，首次用到时再下载并缓存
const ENGINE_FILES = {
  ortWasm: 'vendor/ort/ort-wasm-simd-threaded.wasm',
  visionModel: 'models/mobileclip/vision_model_fp16.onnx',
  textEmbeds: 'models/mobileclip/text_embeds.bin',
  textEmbedsMeta: 'models/mobileclip/text_embeds.json',
  ocrWorker: 'vendor/ocr/worker.min.js',
  ocrCore: 'vendor/ocr/tesseract-core-simd-lstm.wasm.js',
  ocrLangZh: 'vendor/ocr/lang/chi_sim.traineddata.gz',
  ocrLangEn: 'vendor/ocr/lang/eng.traineddata.gz',
};

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
const rel = (p) => path.relative(OUT, p).split(path.sep).join('/');
const hash = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 10);
const kb = (p) => (fs.statSync(p).size / 1024).toFixed(0) + ' KB';

// 1) 资源清单：按 static/ 里的真实文件生成
const missing = Object.values(ENGINE_FILES).filter((f) => !fs.existsSync(path.join(STATIC, f)));
if (missing.length) {
  console.error('缺少识别引擎文件：\n  ' + missing.join('\n  ') + '\n请先完成 tools/clip 与 tools/ocr 下的准备步骤。');
  process.exit(1);
}
// 网络传输量估计：可压缩类型按 gzip 后的大小计（GitHub Pages 对 js / wasm 启用 gzip）
const transfer = Object.fromEntries(
  Object.entries(ENGINE_FILES).map(([key, file]) => {
    const buf = fs.readFileSync(path.join(STATIC, file));
    return [key, /\.(wasm|mjs|js)$/.test(file) ? gzipSync(buf, { level: 6 }).length : buf.length];
  }),
);
const TRANSFER = {
  vision: transfer.ortWasm + transfer.visionModel + transfer.textEmbeds + transfer.textEmbedsMeta,
  ocr: transfer.ocrWorker + transfer.ocrCore + transfer.ocrLangZh + transfer.ocrLangEn,
};
fs.mkdirSync(path.join(SRC, 'generated'), { recursive: true });
fs.writeFileSync(
  path.join(SRC, 'generated/assets.js'),
  `// 站点内较重的资源清单（路径与字节数）。由 tools/build.mjs 在构建时按 static/ 目录的实际文件生成，请勿手改。
export const ASSETS = {
${Object.entries(ENGINE_FILES)
  .map(([key, file]) => `  ${key}: { file: '${file}', size: ${fs.statSync(path.join(STATIC, file)).size} },`)
  .join('\n')}
};

/** 资源地址：相对打包文件所在目录解析，站点挂在子路径下也能用 */
export const assetURL = (file) => new URL('../' + file, import.meta.url).href;

export const ENGINE_BYTES = {
  vision: ASSETS.ortWasm.size + ASSETS.visionModel.size + ASSETS.textEmbeds.size + ASSETS.textEmbedsMeta.size,
  ocr: ASSETS.ocrWorker.size + ASSETS.ocrCore.size + ASSETS.ocrLangZh.size + ASSETS.ocrLangEn.size,
};

/** 下载时的传输量估计（字节），只在界面里展示用 */
export const ENGINE_TRANSFER = { vision: ${TRANSFER.vision}, ocr: ${TRANSFER.ocr} };
`,
);

// 2) 清空并重建 docs/
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// 3) 脚本与样式
const js = await build({
  entryPoints: [path.join(SRC, 'main.js')],
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2020'],
  minify: true,
  legalComments: 'none',
  outdir: path.join(OUT, 'assets'),
  entryNames: 'app-[hash]',
  chunkNames: 'chunk-[hash]',
  metafile: true,
  logLevel: 'warning',
});
await build({ entryPoints: [path.join(SRC, 'styles/app.css')], bundle: true, minify: true, outfile: path.join(OUT, 'assets/.app.css'), logLevel: 'warning' });
const cssBuf = fs.readFileSync(path.join(OUT, 'assets/.app.css'));
const cssHash = hash(cssBuf);
const cssName = `app.${cssHash}.css`;
fs.renameSync(path.join(OUT, 'assets/.app.css'), path.join(OUT, 'assets', cssName));

const jsFiles = Object.keys(js.metafile.outputs).map((f) => path.resolve(ROOT, f));
const mainBundle = jsFiles.find((f) => /\/app-[\w]+\.js$/.test(f));
const jsHash = mainBundle.match(/app-([\w]+)\.js$/)[1];

// 4) 页面、清单
const html = fs
  .readFileSync(path.join(SRC, 'index.html'), 'utf8')
  .replace('{{css}}', cssHash)
  .replace('{{js}}', jsHash);
fs.writeFileSync(path.join(OUT, 'index.html'), html);

fs.writeFileSync(
  path.join(OUT, 'manifest.webmanifest'),
  JSON.stringify(
    {
      name: '燃记 · 健身与饮食管理',
      short_name: '燃记',
      description: '记录每日饮食与运动，拍照估算热量，自动生成每周健身报告。',
      start_url: './',
      scope: './',
      display: 'standalone',
      orientation: 'portrait',
      background_color: '#f3efe6',
      theme_color: '#f3efe6',
      lang: 'zh-CN',
      icons: [
        { src: './icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: './icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: './icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    null,
    2,
  ) + '\n',
);
fs.writeFileSync(path.join(OUT, 'robots.txt'), 'User-agent: *\nAllow: /\n');
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

// 5) 静态资源原样拷贝
const staticFiles = walk(STATIC);
for (const f of staticFiles) {
  const dest = path.join(OUT, path.relative(STATIC, f));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(f, dest);
}

// 6) Service Worker：首屏需要的文件进预缓存，引擎文件用到时再缓存
const version = hash(cssHash + jsHash);
const isEngine = new Set(Object.values(ENGINE_FILES));
const isPrecached = (file) => !isEngine.has(file) && !/\.(txt|md)$/i.test(file) && !/LICENSE/i.test(file);
const precache = [...new Set(['index.html', 'manifest.webmanifest', ...jsFiles.map(rel), `assets/${cssName}`, ...staticFiles.map((f) => path.relative(STATIC, f).split(path.sep).join('/')).filter(isPrecached)])];
fs.writeFileSync(
  path.join(OUT, 'sw.js'),
  fs.readFileSync(path.join(SRC, 'sw.js'), 'utf8').replace('{{version}}', version).replace('{{precache}}', JSON.stringify(precache)),
);

console.log(`build ${version}`);
console.log('  index.html');
for (const f of [path.join(OUT, 'assets', cssName), ...jsFiles]) console.log(`  ${rel(f)} (${kb(f)})`);
console.log(`  ${precache.length} 个预缓存文件；引擎文件 ${Object.values(ENGINE_FILES).length} 个按需缓存`);
