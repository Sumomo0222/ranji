// 把离线预计算的文本向量打包成站点文件：
//   static/models/mobileclip/text_embeds.bin   float16 小端，行序 = 食物（与 foods.js 同序）在前，非食物对照词在后
//   static/models/mobileclip/text_embeds.json  维度、行序、阈值等元信息
// 同时把选定的 fp16 视觉模型复制过去并校验 sha256。
//   node tools/clip/build-embeds.mjs
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadRaw, classEmbeds } from './scripts/lib/embeds.mjs';
import { FOODS, NEGATIVE_PROMPTS } from '../../src/data/foods.js';
import { SETTINGS } from './scripts/lib/prompts.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'static/models/mobileclip');
const SETTING = 'B';
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function toF16(value) {
  const f32 = new Float32Array(1);
  const u32 = new Uint32Array(f32.buffer);
  f32[0] = value;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  let exp = (x >>> 23) & 0xff;
  let mant = x & 0x7fffff;
  if (exp === 0xff) return sign | 0x7c00 | (mant ? 0x200 : 0);
  exp = exp - 127 + 15;
  if (exp >= 0x1f) return sign | 0x7c00;
  if (exp <= 0) {
    if (exp < -10) return sign;
    mant |= 0x800000;
    const shift = 14 - exp;
    const half = 1 << (shift - 1);
    let rounded = (mant >>> shift) + ((mant & half) ? 1 : 0);
    return sign | rounded;
  }
  return sign | (exp << 10) | (mant >>> 13) + ((mant & 0x1000) ? 1 : 0);
}

mkdirSync(OUT, { recursive: true });
const { foods, negatives } = classEmbeds(loadRaw(), SETTING);
if (foods.length !== FOODS.length || negatives.length !== NEGATIVE_PROMPTS.length) throw new Error('row count mismatch');
const dim = foods[0].embed.length;
const buf = Buffer.alloc((foods.length + negatives.length) * dim * 2);
let o = 0;
for (const row of [...foods, ...negatives]) for (const v of row.embed) {
  buf.writeUInt16LE(toF16(v), o);
  o += 2;
}
writeFileSync(path.join(OUT, 'text_embeds.bin'), buf);

const meta = {
  model: 'Xenova/mobileclip_s0',
  revision: '757d59c9c6870a76a4b0306f05f5061bca15c39f',
  source: 'https://github.com/apple/ml-mobileclip',
  dim,
  dtype: 'float16-le',
  logitScale: 100,
  setting: SETTING,
  templates: SETTINGS[SETTING],
  rows: foods.length + negatives.length,
  foodCount: foods.length,
  foodIds: foods.map((f) => f.id),
  negatives: negatives.map((n, i) => ({ id: n.id, prompt: n.prompt, index: foods.length + i })),
  // 评测依据见 tools/clip/REPORT.md：非食物照片的最佳食物相似度 0.08–0.17，食物照片 ≥0.24
  thresholds: { minTopCos: 0.2, negativeMargin: 0.02, confidentCos: 0.26 },
};
writeFileSync(path.join(OUT, 'text_embeds.json'), JSON.stringify(meta));

const model = path.join(ROOT, 'tools/clip/cache/hf/onnx/vision_model_fp16.onnx');
copyFileSync(model, path.join(OUT, 'vision_model_fp16.onnx'));
copyFileSync(path.join(ROOT, 'tools/clip/cache/hf/LICENSE'), path.join(OUT, 'LICENSE.txt'));

let mirrorSha = null;
try {
  const api = execSync('curl -s -m 30 "https://hf-mirror.com/api/models/Xenova/mobileclip_s0?blobs=true"', { encoding: 'utf8' });
  const entry = JSON.parse(api).siblings.find((s) => s.rfilename === 'onnx/vision_model_fp16.onnx');
  mirrorSha = entry?.lfs?.oid ?? null;
} catch (err) {
  console.warn('无法访问镜像 API，跳过远端校验:', err.message);
}
const localSha = sha256(readFileSync(path.join(OUT, 'vision_model_fp16.onnx')));
console.log(`vision_model_fp16.onnx  ${(readFileSync(path.join(OUT, 'vision_model_fp16.onnx')).length / 1048576).toFixed(2)} MB  sha256 ${localSha}`);
console.log(`mirror lfs oid                                                    ${mirrorSha}`);
console.log(mirrorSha ? (mirrorSha === localSha ? 'sha256 OK' : 'sha256 MISMATCH') : 'sha256 not verified');
console.log(`text_embeds.bin          ${(buf.length / 1024).toFixed(0)} KB  (${foods.length} foods + ${negatives.length} negatives) × ${dim} dims, setting ${SETTING}`);
