// 食物照片识别：在浏览器本地跑 MobileCLIP-S0（ONNX Runtime Web，wasm 后端），照片不会上传。
// 流程：下载运行时与模型（仅首次，之后走缓存）→ 图片缩放裁剪成 256×256 → 图像向量 → 与预计算的文本向量比对 → 取最像的几种食物。
import { ASSETS, assetURL } from '../generated/assets.js';
import { fetchBinary } from './fetch.js';
import { FOOD_BY_ID, FOODS, NEGATIVE_PROMPTS } from '../data/foods.js';

const SIZE = 256;
let loaded = null;
let loading = null;

/** 把多步骤的进度汇总成 0–1 */
function makeProgress(steps, onProgress) {
  const total = steps.reduce((a, s) => a + s.size, 0);
  const done = Object.fromEntries(steps.map((s) => [s.key, 0]));
  return (key, bytes) => {
    done[key] = bytes;
    const sum = Object.values(done).reduce((a, b) => a + b, 0);
    onProgress?.({ ratio: Math.min(1, sum / total), loaded: sum, total, stage: key });
  };
}

async function loadOnce(onProgress) {
  const report = makeProgress(
    [
      { key: 'runtime', size: ASSETS.ortWasm.size },
      { key: 'model', size: ASSETS.visionModel.size },
      { key: 'labels', size: ASSETS.textEmbeds.size + ASSETS.textEmbedsMeta.size },
    ],
    onProgress,
  );

  onProgress?.({ ratio: 0, stage: 'runtime', text: '正在加载识别引擎' });
  const [wasm, ort] = await Promise.all([fetchBinary(assetURL(ASSETS.ortWasm.file), (n) => report('runtime', n)), import('onnxruntime-web/wasm')]);
  ort.env.wasm.wasmPaths = assetURL('vendor/ort/');
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmBinary = wasm.buffer;

  onProgress?.({ ratio: 0, stage: 'model', text: '正在下载食物识别模型' });
  const [model, meta, bin] = await Promise.all([
    fetchBinary(assetURL(ASSETS.visionModel.file), (n) => report('model', n)),
    fetch(assetURL(ASSETS.textEmbedsMeta.file)).then((r) => {
      if (!r.ok) throw new Error('标签数据下载失败');
      return r.json();
    }),
    fetchBinary(assetURL(ASSETS.textEmbeds.file), (n) => report('labels', n)),
  ]);

  onProgress?.({ ratio: 1, stage: 'init', text: '正在初始化' });
  const session = await ort.InferenceSession.create(model.buffer, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];

  // float16 小端 → float32
  const count = bin.length / 2;
  const matrix = new Float32Array(count);
  const u16 = new Uint16Array(bin.buffer, bin.byteOffset, count);
  for (let i = 0; i < count; i++) {
    const h = u16[i];
    const sign = (h & 0x8000) ? -1 : 1;
    const exp = (h >> 10) & 0x1f;
    const mant = h & 0x3ff;
    matrix[i] = exp === 0 ? sign * mant * 2 ** -24 : exp === 0x1f ? (mant ? NaN : sign * Infinity) : sign * (1 + mant / 1024) * 2 ** (exp - 15);
  }

  return { ort, session, inputName, outputName, matrix, meta, dim: meta.dim, foodCount: meta.foodCount, rows: meta.rows };
}

/** 确保引擎就位；并发调用共用同一次加载 */
export function ensureVision(onProgress) {
  if (loaded) return Promise.resolve(loaded);
  if (!loading) {
    loading = loadOnce(onProgress).then(
      (v) => {
        loaded = v;
        return v;
      },
      (err) => {
        loading = null;
        throw err;
      },
    );
  }
  return loading;
}

export const visionLoaded = () => !!loaded;

/** 与参考实现一致的预处理：逐次减半缩小抗锯齿，短边缩到 256，居中裁剪，RGB 依次除以 255 */
export async function imageToTensor(source) {
  let bitmap = source;
  if (!(source instanceof ImageBitmap)) {
    bitmap = await createImageBitmap(source);
  }
  let canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  let ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  while (Math.min(canvas.width, canvas.height) / 2 >= SIZE) {
    const next = document.createElement('canvas');
    next.width = Math.max(SIZE, Math.round(canvas.width / 2));
    next.height = Math.max(SIZE, Math.round(canvas.height / 2));
    ctx = next.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, next.width, next.height);
    canvas = next;
  }
  const k = SIZE / Math.min(canvas.width, canvas.height);
  const rw = Math.max(SIZE, Math.floor(canvas.width * k + 1e-6));
  const rh = Math.max(SIZE, Math.floor(canvas.height * k + 1e-6));
  const resized = document.createElement('canvas');
  resized.width = rw;
  resized.height = rh;
  ctx = resized.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, rw, rh);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, rw, rh);
  const cropped = document.createElement('canvas');
  cropped.width = SIZE;
  cropped.height = SIZE;
  ctx = cropped.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(resized, Math.round((rw - SIZE) / 2), Math.round((rh - SIZE) / 2), SIZE, SIZE, 0, 0, SIZE, SIZE);
  const data = ctx.getImageData(0, 0, SIZE, SIZE).data;
  const plane = SIZE * SIZE;
  const out = new Float32Array(3 * plane);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    out[j] = data[i] / 255;
    out[plane + j] = data[i + 1] / 255;
    out[2 * plane + j] = data[i + 2] / 255;
  }
  return out;
}

const dot = (m, row, dim, v) => {
  let s = 0;
  const o = row * dim;
  for (let i = 0; i < dim; i++) s += m[o + i] * v[i];
  return s;
};

/**
 * 识别一张照片。
 * @returns {Promise<{top:{id:string,zh:string,cos:number,p:number}[], isFood:boolean, topCos:number, negCos:number}>}
 */
export async function recognizeFood(blob, onProgress) {
  const eng = await ensureVision(onProgress);
  onProgress?.({ ratio: 1, stage: 'run', text: '正在识别' });
  const tensor = await imageToTensor(blob);
  const feeds = { [eng.inputName]: new eng.ort.Tensor('float32', tensor, [1, 3, SIZE, SIZE]) };
  const out = await eng.session.run(feeds);
  const emb = out[eng.outputName].data;
  let norm = 0;
  for (let i = 0; i < emb.length; i++) norm += emb[i] * emb[i];
  norm = Math.sqrt(norm) || 1;
  const v = new Float32Array(emb.length);
  for (let i = 0; i < emb.length; i++) v[i] = emb[i] / norm;

  const cos = new Float32Array(eng.rows);
  for (let r = 0; r < eng.rows; r++) cos[r] = dot(eng.matrix, r, eng.dim, v);
  let best = -Infinity;
  for (let r = 0; r < eng.rows; r++) best = Math.max(best, cos[r]);
  const probs = Array.from(cos, (c) => Math.exp(100 * (c - best)));
  const sum = probs.reduce((a, b) => a + b, 0);

  const order = Array.from({ length: eng.foodCount }, (_, i) => i).sort((a, b) => cos[b] - cos[a]);
  const top = order.slice(0, 5).map((i) => {
    const food = FOOD_BY_ID[eng.meta.foodIds[i]] || FOODS[i];
    return { id: food.id, zh: food.zh, cos: cos[i], p: probs[i] / sum };
  });
  let negCos = -Infinity;
  for (let r = eng.foodCount; r < eng.rows; r++) negCos = Math.max(negCos, cos[r]);
  const t = eng.meta.thresholds || { minTopCos: 0.2, negativeMargin: 0.02, confidentCos: 0.26 };
  const topCos = top[0].cos;
  return {
    top,
    topCos,
    negCos,
    isFood: topCos >= t.minTopCos && topCos > negCos + t.negativeMargin,
    confident: topCos >= t.confidentCos,
    negatives: NEGATIVE_PROMPTS.length,
  };
}
