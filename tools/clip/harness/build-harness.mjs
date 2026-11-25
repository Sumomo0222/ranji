// 评测用入口：把 onnxruntime-web（仅 wasm 后端的构建）打包成一个 ES 模块，供 harness/page.html 加载。
//   node tools/clip/build-harness.mjs
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
await build({
  entryPoints: [path.join(here, 'entry.js')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  minify: false,
  outfile: path.join(here, 'out/ort.mjs'),
  logLevel: 'warning',
});
console.log('harness bundle ->', path.join(here, 'out/ort.mjs'));
