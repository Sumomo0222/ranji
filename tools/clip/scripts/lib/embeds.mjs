// 读取离线预计算的文本向量，按模板设置合成「每个食物一个单位向量」。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SETTINGS, render, foodPhrases } from './prompts.mjs';

const LIB = path.dirname(fileURLToPath(import.meta.url));

export function loadRaw() {
  return JSON.parse(readFileSync(path.join(LIB, '../../out/text-embeds-raw.json'), 'utf8'));
}

function normalize(a) {
  let n = 0;
  for (const x of a) n += x * x;
  n = Math.sqrt(n) || 1;
  return a.map((x) => x / n);
}

function meanNormalized(vectors) {
  const dim = vectors[0].length;
  const out = new Float64Array(dim);
  for (const v of vectors) for (let i = 0; i < dim; i++) out[i] += v[i];
  return normalize(Array.from(out));
}

/** @returns {{ foods: {id:string, zh:string, embed:number[]}[], negatives: {id:string, prompt:string, embed:number[]}[] }} */
export function classEmbeds(raw, setting = 'B') {
  const templates = SETTINGS[setting];
  const vec = raw.vectors;
  const foods = foodPhrases().map(({ id, zh, phrases }) => {
    const vs = [];
    for (const p of phrases) for (const t of templates) {
      const v = vec[render(t, p)];
      if (!v) throw new Error(`missing embedding for "${render(t, p)}"`);
      vs.push(v);
    }
    return { id, zh, embed: meanNormalized(vs) };
  });
  const negatives = raw.negatives.map((prompt, i) => ({ id: `neg${String(i + 1).padStart(2, '0')}`, prompt, embed: vec[prompt] }));
  return { foods, negatives };
}

export const dot = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

export function softmax(xs) {
  const m = Math.max(...xs);
  const es = xs.map((x) => Math.exp(x - m));
  const s = es.reduce((a, b) => a + b, 0);
  return es.map((e) => e / s);
}

/** 对一张图的向量做分类：返回食物候选（按匹配度排序）与非食物对照的最好分数 */
export function classify(embed, classes, { topK = 5 } = {}) {
  let n = 0;
  for (const x of embed) n += x * x;
  const e = embed.map((x) => x / (Math.sqrt(n) || 1));
  const cos = classes.foods.map((f) => dot(e, f.embed));
  const probs = softmax(cos.map((c) => 100 * c));
  const order = cos.map((c, i) => i).sort((a, b) => cos[b] - cos[a]);
  const top = order.slice(0, topK).map((i) => ({ id: classes.foods[i].id, zh: classes.foods[i].zh, cos: +cos[i].toFixed(4), p: +probs[i].toFixed(4) }));
  let bestNeg = -1;
  let bestNegId = null;
  classes.negatives.forEach((g) => {
    const c = dot(e, g.embed);
    if (c > bestNeg) {
      bestNeg = c;
      bestNegId = g.id;
    }
  });
  return { top, top1: order[0] >= 0 ? classes.foods[order[0]].id : null, top1Cos: +cos[order[0]].toFixed(4), bestNegCos: +bestNeg.toFixed(4), bestNegId, cos: Array.from(cos) };
}
