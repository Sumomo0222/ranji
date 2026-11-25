// 离线预计算：用 fp32 文本编码器把「食物识别词 × 提示模板」和「非食物对照词」编码成单位向量。
// 结果写入 tools/clip/out/text-embeds-raw.json，之后由 build-embeds.mjs 选定模板并打包成站点用的文件。
//   node tools/clip/embed-text.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ROOT, loadTextStack } from './scripts/tfjs-setup.mjs';
import { normalize } from './scripts/lib/math.mjs';
import { SETTINGS, render, foodPhrases } from './scripts/lib/prompts.mjs';
import { NEGATIVE_PROMPTS } from '../../src/data/foods.js';

const templates = [...new Set(Object.values(SETTINGS).flat())];
const phrases = [...new Set(foodPhrases().flatMap((f) => f.phrases))];
const texts = [...new Set([...phrases.flatMap((p) => templates.map((t) => render(t, p))), ...NEGATIVE_PROMPTS])];
console.log(`${phrases.length} phrases × ${templates.length} templates + ${NEGATIVE_PROMPTS.length} negatives = ${texts.length} prompts`);

const { tokenizer, textModel } = await loadTextStack();
const dim = 512;
const vectors = new Map();
const batch = 24;
const t0 = performance.now();
for (let i = 0; i < texts.length; i += batch) {
  const slice = texts.slice(i, i + batch);
  const inputs = tokenizer(slice, { padding: 'max_length', truncation: true });
  const { text_embeds } = await textModel(inputs);
  if (text_embeds.dims[1] !== dim) throw new Error(`unexpected embedding dim ${text_embeds.dims[1]}`);
  for (let r = 0; r < slice.length; r++) {
    const row = text_embeds.data.subarray(r * dim, (r + 1) * dim);
    vectors.set(slice[r], Array.from(normalize(row), (x) => +x.toFixed(6)));
  }
  if (i % 480 === 0) console.log(`  ${i}/${texts.length}  ${((performance.now() - t0) / 1000).toFixed(1)}s`);
}
console.log(`encoded ${vectors.size} prompts in ${((performance.now() - t0) / 1000).toFixed(1)}s`);

mkdirSync(path.join(ROOT, 'out'), { recursive: true });
writeFileSync(path.join(ROOT, 'out/text-embeds-raw.json'), JSON.stringify({ dim, templates, phrases, negatives: NEGATIVE_PROMPTS, vectors: Object.fromEntries(vectors) }));
console.log('wrote out/text-embeds-raw.json');
