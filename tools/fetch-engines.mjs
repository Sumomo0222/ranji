// 把识别引擎的大文件准备到 static/ 下（这些文件不进 git，可随时重新生成）：
//   - MobileCLIP-S0 fp16 视觉模型：从 hf-mirror 下载，并校验 sha256
//   - ONNX Runtime Web 的 wasm 运行时：来自 node_modules/onnxruntime-web
//   - Tesseract.js 的 worker、核心与中英文语言包：来自 node_modules 与 npm 镜像
//   node tools/fetch-engines.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATIC = path.join(ROOT, 'static');
const TMP = path.join(ROOT, '.scratch/engines-tmp');
const MODEL_URL = 'https://hf-mirror.com/Xenova/mobileclip_s0/resolve/757d59c9c6870a76a4b0306f05f5061bca15c39f';
const MODEL_SHA256 = '22b1d36ecc6837e8205aee05003440a25e1c1ee0c7e2945dbb9dd597211c59dc';
const ORT_LICENSE = `onnxruntime-web — MIT License

Copyright (c) Microsoft Corporation. All rights reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const need = (file, check) => {
  const p = path.join(STATIC, file);
  if (!fs.existsSync(p)) return true;
  try {
    return check ? !check(fs.readFileSync(p)) : false;
  } catch (err) {
    return true;
  }
};
const put = (file, buf) => {
  fs.mkdirSync(path.dirname(path.join(STATIC, file)), { recursive: true });
  fs.writeFileSync(path.join(STATIC, file), buf);
  console.log(`  ${file}  ${(buf.length / 1048576).toFixed(2)} MB`);
};
const npmMajor = (pkg) => JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', pkg, 'package.json'), 'utf8')).version;

console.log('识别引擎文件 → static/');
if (need('models/mobileclip/vision_model_fp16.onnx', (b) => sha256(b) === MODEL_SHA256)) {
  // 先找本机已有的副本（评测工具的缓存），没有再从镜像下载（断点续传，镜像有时很慢）
  const local = path.join(ROOT, 'tools/clip/cache/hf/onnx/vision_model_fp16.onnx');
  if (fs.existsSync(local) && sha256(fs.readFileSync(local)) === MODEL_SHA256) {
    put('models/mobileclip/vision_model_fp16.onnx', fs.readFileSync(local));
  } else {
    fs.mkdirSync(TMP, { recursive: true });
    const tgz = path.join(TMP, 'vision_model_fp16.onnx');
    execSync(`curl -s -L --fail -C - --retry 8 --retry-delay 5 --retry-all-errors -m 3600 "${MODEL_URL}/onnx/vision_model_fp16.onnx" -o "${tgz}"`, { stdio: 'inherit' });
    const buf = fs.readFileSync(tgz);
    if (sha256(buf) !== MODEL_SHA256) throw new Error('视觉模型下载后 sha256 不匹配，请重试');
    put('models/mobileclip/vision_model_fp16.onnx', buf);
  }
} else console.log('  视觉模型已存在且校验通过');
if (need('models/mobileclip/LICENSE.txt')) {
  const cached = path.join(ROOT, 'tools/clip/cache/hf/LICENSE');
  put('models/mobileclip/LICENSE.txt', fs.existsSync(cached) ? fs.readFileSync(cached) : execSync(`curl -s -L --fail --retry 3 -m 60 "${MODEL_URL}/LICENSE"`, { encoding: 'utf8' }));
}

const ortVer = npmMajor('onnxruntime-web');
for (const f of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
  if (need(`vendor/ort/${f}`)) put(`vendor/ort/${f}`, fs.readFileSync(path.join(ROOT, 'node_modules/onnxruntime-web/dist', f)));
}
if (need('vendor/ort/LICENSE.txt')) put('vendor/ort/LICENSE.txt', ORT_LICENSE);
console.log(`  onnxruntime-web ${ortVer}`);

const tessVer = npmMajor('tesseract.js');
if (need('vendor/ocr/worker.min.js')) put('vendor/ocr/worker.min.js', fs.readFileSync(path.join(ROOT, 'node_modules/tesseract.js/dist/worker.min.js')));
if (need('vendor/ocr/tesseract-core-simd-lstm.wasm.js')) put('vendor/ocr/tesseract-core-simd-lstm.wasm.js', fs.readFileSync(path.join(ROOT, 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js')));
if (need('vendor/ocr/LICENSE.txt')) {
  const core = fs.readFileSync(path.join(ROOT, 'node_modules/tesseract.js-core/LICENSE'), 'utf8');
  put('vendor/ocr/LICENSE.txt', `tesseract.js ${tessVer} 与 tesseract.js-core — Apache License 2.0\nhttps://github.com/naptha/tesseract.js\n\n语言数据（@tesseract.js-data，tessdata 的整数化版本）同样遵循 Apache License 2.0。\n\n==== tesseract.js-core LICENSE ====\n\n${core}`);
}
for (const lang of ['chi_sim', 'eng']) {
  if (!need(`vendor/ocr/lang/${lang}.traineddata.gz`)) continue;
  fs.mkdirSync(TMP, { recursive: true });
  const inner = `package/4.0.0_best_int/${lang}.traineddata.gz`;
  // 依次尝试：本机评测工具的缓存 → npm 镜像 → 官方源。压缩包名不带作用域前缀。
  const candidates = [
    path.join(ROOT, `tools/ocr/.cache/langdata/tesseract.js-data-${lang}-1.0.0.tgz`),
    `https://registry.npmmirror.com/@tesseract.js-data/${lang}/-/${lang}-1.0.0.tgz`,
    `https://registry.npmjs.org/@tesseract.js-data/${lang}/-/${lang}-1.0.0.tgz`,
  ];
  let data = null;
  for (const src of candidates) {
    try {
      const tgz = src.startsWith('http') ? path.join(TMP, `${lang}.tgz`) : src;
      if (src.startsWith('http')) execSync(`curl -s -L --fail --retry 5 --retry-delay 3 --retry-all-errors -m 900 "${src}" -o "${tgz}"`);
      if (!fs.existsSync(tgz)) continue;
      execSync(`tar -xzf "${tgz}" -C "${TMP}" "${inner}"`);
      data = fs.readFileSync(path.join(TMP, inner));
      break;
    } catch (err) {
      /* 换下一个来源 */
    }
  }
  if (!data) throw new Error(`语言包 ${lang} 下载失败，请检查网络后重试`);
  put(`vendor/ocr/lang/${lang}.traineddata.gz`, data);
}
console.log(`  tesseract.js ${tessVer}（chi_sim + eng）`);
fs.rmSync(TMP, { recursive: true, force: true });
console.log('完成。文本向量 static/models/mobileclip/text_embeds.* 已随仓库提交，无需重新生成。');
