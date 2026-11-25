import * as ort from 'onnxruntime-web/wasm';

// 与线上一致：同源、子路径、无跨域隔离头。page.html 位于 /ranji/tools/clip/harness/，运行时文件在 /ranji/static/vendor/ort/。
ort.env.wasm.wasmPaths = new URL('../../../static/vendor/ort/', location.href).href;
ort.env.wasm.numThreads = 1;

const SIZE = 256;

/** 与线上一致的预处理：逐次减半缩小以抗锯齿，短边缩到 256，居中裁剪，RGB 依次除以 255 排成 CHW */
export async function imageToTensor(bytes) {
  const bmp = await createImageBitmap(new Blob([bytes]));
  let canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  let ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  while (Math.min(canvas.width, canvas.height) / 2 >= SIZE) {
    const next = document.createElement('canvas');
    next.width = Math.round(canvas.width / 2);
    next.height = Math.round(canvas.height / 2);
    ctx = next.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, next.width, next.height);
    canvas = next;
  }
  // 与 PIL 的几何规则一致：短边缩到 256，长边向下取整，居中裁剪的偏移四舍五入
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

let session = null;
let inputName = 'pixel_values';

window.loadModel = async (url) => {
  const t0 = performance.now();
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  const tFetch = performance.now() - t0;
  session = await ort.InferenceSession.create(buf, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  inputName = session.inputNames[0];
  return { bytes: buf.byteLength, fetchMs: Math.round(tFetch), createMs: Math.round(performance.now() - t0 - tFetch), inputs: session.inputNames, outputs: session.outputNames };
};

window.embedImage = async (b64) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const t0 = performance.now();
  const tensor = await imageToTensor(bytes);
  const tPre = performance.now() - t0;
  const feeds = { [inputName]: new ort.Tensor('float32', tensor, [1, 3, SIZE, SIZE]) };
  const t1 = performance.now();
  const out = await session.run(feeds);
  const tRun = performance.now() - t1;
  const emb = out[session.outputNames[0]].data;
  return { embed: Array.from(emb), preMs: Math.round(tPre), runMs: Math.round(tRun) };
};

window.harnessTensor = async (b64) => imageToTensor(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
window.ortReady = true;
window.ortInfo = { version: ort.env?.versions?.web ?? null };
