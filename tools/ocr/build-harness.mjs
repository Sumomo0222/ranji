// OCR 评测入口：把 tesseract.js 打包成 ES 模块，供 harness/page.html 使用。
//   node tools/ocr/build-harness.mjs
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
await build({
  entryPoints: [path.join(here, 'harness/entry.js')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  minify: false,
  outfile: path.join(here, 'harness/out/tesseract.mjs'),
  logLevel: 'warning',
});
console.log('harness bundle ->', path.join(here, 'harness/out/tesseract.mjs'));
