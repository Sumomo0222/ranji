// 图片处理：解码、按最长边缩放、转 JPEG，用于控制存储体积与上传识别时的体积。
async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (err) {
      /* 部分浏览器不支持该选项，退到 <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function fitSize(w, h, max) {
  const k = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

function draw(src, w, h, sw, sh) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, sw, sh, 0, 0, w, h);
  return canvas;
}

/**
 * 把用户选的图片压成一张可保存的照片。
 * 返回 { full, thumb, w, h }：full 最长边 fullMax，thumb 最长边 thumbMax，均为 JPEG Blob。
 */
export async function compressPhoto(file, { fullMax = 1280, thumbMax = 420, quality = 0.84 } = {}) {
  const src = await decode(file);
  const sw = src.width || src.naturalWidth;
  const sh = src.height || src.naturalHeight;
  const fullSize = fitSize(sw, sh, fullMax);
  const thumbSize = fitSize(sw, sh, thumbMax);
  const full = await canvasToBlob(draw(src, fullSize.w, fullSize.h, sw, sh), quality);
  const thumb = await canvasToBlob(draw(src, thumbSize.w, thumbSize.h, sw, sh), 0.78);
  if (src.close) src.close();
  return { full, thumb, w: fullSize.w, h: fullSize.h };
}

export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export function dataURLToBlob(dataUrl) {
  const [head, b64] = String(dataUrl).split(',');
  const mime = /data:([^;]+)/.exec(head)?.[1] || 'image/jpeg';
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: mime });
}

/** 为图片生成一个体积很小的占位底色（模糊主色），用在图片加载前 */
export async function dominantColor(file) {
  try {
    const src = await decode(file);
    const w = src.width || src.naturalWidth;
    const h = src.height || src.naturalHeight;
    const canvas = draw(src, 8, 8, w, h);
    const d = canvas.getContext('2d').getImageData(0, 0, 8, 8).data;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) {
      r += d[i];
      g += d[i + 1];
      b += d[i + 2];
    }
    const n = d.length / 4;
    if (src.close) src.close();
    return `rgb(${Math.round(r / n)} ${Math.round(g / n)} ${Math.round(b / n)})`;
  } catch (err) {
    return 'rgb(220 214 200)';
  }
}
