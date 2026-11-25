// 运动截图识别：Tesseract.js 在浏览器本地做 OCR（中英文），照片不会上传。
// 一张截图跑两到三遍（不同缩放；深色截图另做反相加粗），再把各遍的文字按位置合并，交给版面解析器。
import { ASSETS, assetURL } from '../generated/assets.js';
import { parseScreenshot } from '../core/screenshot-parse.js';

const LANGS = ['chi_sim', 'eng'];
const TARGET_WIDTHS = [585, 468];
const LOAD_STAGES = { 'loading tesseract core': 0, 'loading language traineddata': 0.45, 'initializing api': 0.85 };

let worker = null;
let loading = null;
let idleTimer = 0;

async function loadOnce(onProgress) {
  // tesseract.js 是 CommonJS 包，打包后命名导出不一定保留，这里按需取用；OEM.LSTM_ONLY 的值固定为 1
  const mod = await import('tesseract.js');
  const createWorker = mod.createWorker || mod.default?.createWorker;
  const w = await createWorker(LANGS, 1, {
    workerPath: assetURL(ASSETS.ocrWorker.file),
    corePath: assetURL(ASSETS.ocrCore.file),
    langPath: assetURL('vendor/ocr/lang'),
    cacheMethod: 'none',
    gzip: true,
    // 直接以同源脚本地址启动 worker（而不是 blob: 包装），这样它的请求会经过 Service Worker，离线时也能用
    workerBlobURL: false,
    logger: (m) => {
      const base = LOAD_STAGES[m.status];
      if (base == null || typeof m.progress !== 'number') return;
      onProgress?.({ ratio: Math.min(0.3, (base + m.progress * 0.12)), stage: 'load', text: m.status === 'loading tesseract core' ? '正在加载文字识别引擎' : m.status === 'loading language traineddata' ? '正在加载中英文识别数据' : '正在初始化' });
    },
  });
  await w.setParameters({ tessedit_pageseg_mode: '3', preserve_interword_spaces: '1' });
  return w;
}

/** 确保 OCR worker 就位；并发调用共用同一次加载 */
export function ensureOcr(onProgress) {
  if (worker) return Promise.resolve(worker);
  if (!loading) {
    loading = loadOnce(onProgress).then(
      (w) => {
        worker = w;
        scheduleIdle();
        return w;
      },
      (err) => {
        loading = null;
        throw err;
      },
    );
  }
  return loading;
}

export const ocrLoaded = () => !!worker;

/** 闲置一会儿后释放 worker 占用的内存，下次用时再加载（文件已在缓存里） */
function scheduleIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    worker?.terminate();
    worker = null;
  }, 90000);
}

const toBlob = (canvas) => new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));

/** 缩放到目标宽度，顺带算出画面平均亮度 */
function drawScaled(source, targetWidth) {
  const scale = targetWidth / source.width;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return { canvas, ctx, scale };
}

function meanLuminance(ctx) {
  const d = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height).data;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < d.length; i += 4 * 37) {
    sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    n++;
  }
  return sum / n;
}

/** 深色截图反相，并用 3×3 最小值滤波把细笔画加粗一圈——Tesseract 对「深字浅底」更稳 */
function invertAndBolden(ctx) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const src = new Uint8ClampedArray(d.length);
  for (let i = 0; i < d.length; i += 4) {
    src[i] = 255 - d[i];
    src[i + 1] = 255 - d[i + 1];
    src[i + 2] = 255 - d[i + 2];
    src[i + 3] = 255;
  }
  const tmp = new Uint8ClampedArray(src.length);
  const out = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const l = x > 0 ? i - 4 : i;
      const r = x < w - 1 ? i + 4 : i;
      for (let c = 0; c < 3; c++) tmp[i + c] = Math.min(src[l + c], src[i + c], src[r + c]);
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const u = y > 0 ? i - w * 4 : i;
      const b = y < h - 1 ? i + w * 4 : i;
      for (let c = 0; c < 3; c++) out[i + c] = Math.min(tmp[u + c], tmp[i + c], tmp[b + c]);
    }
  }
  ctx.putImageData(img, 0, 0);
}

function toPass(data, scale) {
  const words = (data.blocks ?? [])
    .flatMap((b) => (b.paragraphs ?? []).flatMap((p) => (p.lines ?? []).map((l) => l.words ?? [])))
    .flat()
    .filter((x) => x.text?.trim())
    .map((x) => ({ text: x.text, confidence: x.confidence, bbox: x.bbox }));
  return { scale, words };
}

/**
 * 识别一张运动截图。
 * @param {Blob} blob 图片
 * @param {(p:{ratio:number, stage:string, text:string}) => void} onProgress
 * @returns {Promise<object>} parseScreenshot 的结果，外加 inverted（是否按深色截图做了反相）
 */
export async function readScreenshot(blob, onProgress) {
  const w = await ensureOcr(onProgress);
  scheduleIdle();
  const source = await createImageBitmap(blob);
  const width = source.width;
  const height = source.height;

  // 第一遍按原样识别并判断明暗；深色截图再追加两遍反相加粗的结果
  const first = drawScaled(source, TARGET_WIDTHS[0]);
  const dark = meanLuminance(first.ctx) < 110;
  const plan = [{ ctx: first.ctx, scale: first.scale }];
  if (dark) {
    plan.push({ ...drawScaled(source, TARGET_WIDTHS[0]), bolden: true });
    plan.push({ ...drawScaled(source, TARGET_WIDTHS[1]), bolden: true });
  } else {
    plan.push(drawScaled(source, TARGET_WIDTHS[1]));
  }
  source.close();

  const passes = [];
  for (let i = 0; i < plan.length; i++) {
    const step = plan[i];
    onProgress?.({ ratio: 0.3 + (0.68 * i) / plan.length, stage: 'ocr', text: plan.length > 1 ? `正在识别文字 ${i + 1}/${plan.length}` : '正在识别文字' });
    if (step.bolden) invertAndBolden(step.ctx);
    const { data } = await w.recognize(await toBlob(step.ctx.canvas), {}, { text: true, blocks: true, hocr: false, tsv: false });
    passes.push(toPass(data, step.scale));
  }
  onProgress?.({ ratio: 1, stage: 'done', text: '识别完成' });
  return { ...parseScreenshot(passes, { width, height }), inverted: dark };
}
