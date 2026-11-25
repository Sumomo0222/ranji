// Browser-style preprocessing for MobileCLIP-S0 (Xenova/mobileclip_s0). Dependency-free; runs in the browser and in Node.
//
// It reproduces CLIPImageProcessor with
//   size.shortest_edge = 256, do_center_crop (256x256), do_rescale (1/255), do_normalize = false, RGB output:
//   1. decode to RGB(A) 8-bit (the browser honours EXIF orientation for <img>/createImageBitmap, like sharp's auto-orient)
//   2. resize so the shortest edge is 256, keeping the aspect ratio
//        scale      = max(256 / W, 256 / H)            (images smaller than 256 are UP-scaled)
//        newWidth   = floor(round2(W * scale))          (round2 = toFixed(2), same as Transformers.js)
//        newHeight  = floor(round2(H * scale))
//   3. centre crop 256x256 at (floor((newWidth-256)/2), floor((newHeight-256)/2))
//   4. /255 -> float32, HWC -> CHW  =>  Float32Array(3*256*256): R plane, G plane, B plane
//
// The resize is a separable, area-weighted triangle filter. This is "bilinear" the way Pillow, libvips/sharp and
// every serious image library implement it: when shrinking, the kernel is widened so that it covers the source
// pixels (anti-aliased). `filter: 'naive'` selects the textbook 2x2-tap bilinear interpolation instead; it aliases
// badly on big downscales and exists only for comparison.

export const SIZE = 256;

/**
 * 1-D resampling coefficients for one axis.
 * Output pixel i is src[offset[i] + k] * weights[start[i] + k] for k in [0, count[i]); weights sum to 1.
 * @param {number} inSize
 * @param {number} outSize
 * @param {'triangle'|'naive'} [filter]
 * @returns {{ start: Int32Array, offset: Int32Array, count: Int32Array, weights: Float32Array }}
 */
export function buildCoeffs(inSize, outSize, filter = 'triangle') {
  const scale = inSize / outSize; // > 1 when shrinking
  const start = new Int32Array(outSize);
  const offset = new Int32Array(outSize);
  const count = new Int32Array(outSize);
  /** @type {number[][]} */
  const rows = new Array(outSize);
  let total = 0;
  for (let i = 0; i < outSize; i++) {
    /** @type {number[]} */
    let idx;
    /** @type {number[]} */
    let w;
    if (filter === 'naive') {
      const center = (i + 0.5) * scale - 0.5;
      const j0 = Math.floor(center);
      idx = [j0, j0 + 1];
      w = [1 - (center - j0), center - j0];
    } else {
      // Pillow's precompute_coeffs() for BILINEAR: triangle kernel with support 1 (in output pixels). The kernel
      // is evaluated over a window that is `filterScale` source pixels wide: Pillow uses
      //   filterscale = scale; if (support * filterscale < 1.0) filterscale = 1.0;
      // i.e. the window widens with the scale factor when shrinking, and stays 1 pixel when enlarging.
      const filterScale = Math.max(scale, 1);
      const center = (i + 0.5) * scale;
      const jmin = Math.floor(center - filterScale + 0.5);
      const jmax = Math.floor(center + filterScale + 0.5);
      idx = [];
      w = [];
      for (let j = jmin; j < jmax; j++) {
        const wt = 1 - Math.abs((j - center + 0.5) / filterScale);
        if (wt > 0) { idx.push(j); w.push(wt); }
      }
    }
    // clamp to the image and re-normalise, so that edge pixels average the sources that do exist (as Pillow does)
    let sum = 0;
    for (let k = 0; k < idx.length; k++) {
      idx[k] = Math.min(Math.max(idx[k], 0), inSize - 1);
      sum += w[k];
    }
    start[i] = total;
    offset[i] = idx[0];
    count[i] = idx.length;
    rows[i] = w.map((x) => x / sum);
    total += idx.length;
  }
  const weights = new Float32Array(total);
  let p = 0;
  for (let i = 0; i < outSize; i++) for (let k = 0; k < rows[i].length; k++) weights[p++] = rows[i][k];
  return { start, offset, count, weights };
}

/**
 * Separable resize of packed 8-bit pixels (`channels` interleaved samples per pixel) to an 8-bit RGB result.
 * Pass 1 keeps float32 precision; only the final result is rounded to bytes (round-to-nearest, clamped), like Pillow/sharp.
 * @param {Uint8Array|Uint8ClampedArray} src
 * @param {number} width
 * @param {number} height
 * @param {number} channels  3 (RGB) or 4 (RGBA, alpha ignored)
 * @param {number} outW
 * @param {number} outH
 * @param {'triangle'|'naive'} [filter]
 * @returns {{ data: Uint8ClampedArray, width: number, height: number }}  3 channels per pixel
 */
export function resizeToRgb(src, width, height, channels, outW, outH, filter = 'triangle') {
  const nc = Math.min(channels, 3);
  const cx = buildCoeffs(width, outW, filter);
  const cy = buildCoeffs(height, outH, filter);
  // pass 1: horizontal, src (width x height) -> tmp (outW x height)
  const tmp = new Float32Array(outW * height * nc);
  for (let y = 0; y < height; y++) {
    const rowIn = y * width * channels;
    const rowOut = y * outW * nc;
    for (let x = 0; x < outW; x++) {
      const n = cx.count[x];
      const wp = cx.start[x];
      const o = rowOut + x * nc;
      for (let c = 0; c < nc; c++) {
        let acc = 0;
        let q = wp;
        let p = rowIn + cx.offset[x] * channels + c;
        for (let k = 0; k < n; k++, q++, p += channels) acc += src[p] * cx.weights[q];
        tmp[o + c] = acc;
      }
    }
  }
  // pass 2: vertical, tmp (outW x height) -> out (outW x outH)
  const out = new Uint8ClampedArray(outW * outH * nc);
  const rowLen = outW * nc;
  for (let y = 0; y < outH; y++) {
    const n = cy.count[y];
    const wp = cy.start[y];
    const rowOut = y * rowLen;
    for (let x = 0; x < rowLen; x++) {
      let acc = 0;
      let q = wp;
      let p = cy.offset[y] * rowLen + x;
      for (let k = 0; k < n; k++, q++, p += rowLen) acc += tmp[p] * cy.weights[q];
      out[rowOut + x] = acc; // Uint8ClampedArray rounds to nearest and clamps to 0..255
    }
  }
  return { data: out, width: outW, height: outH };
}

/**
 * Full preprocessing. `src` is interleaved RGB (channels=3) or RGBA (channels=4, alpha ignored) 8-bit data.
 * @param {Uint8Array|Uint8ClampedArray} src
 * @param {number} width
 * @param {number} height
 * @param {{ channels?: number, filter?: 'triangle'|'naive' }} [options]
 * @returns {Float32Array} 3*256*256 floats in CHW order (R plane, G plane, B plane), values in [0, 1]
 */
export function preprocessToTensor(src, width, height, { channels = 4, filter = 'triangle' } = {}) {
  if (src.length < width * height * channels) throw new Error(`preprocess: expected ${width * height * channels} samples, got ${src.length}`);
  const scale = Math.max(SIZE / width, SIZE / height);
  const newW = Math.floor(Number((width * scale).toFixed(2)));
  const newH = Math.floor(Number((height * scale).toFixed(2)));
  const resized = newW === width && newH === height
    ? { data: src, width, height, channels }
    : { ...resizeToRgb(src, width, height, channels, newW, newH, filter), channels: Math.min(channels, 3) };
  const c = resized.channels;
  const left = Math.floor((resized.width - SIZE) / 2);
  const top = Math.floor((resized.height - SIZE) / 2);
  const out = new Float32Array(3 * SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    const rowIn = (top + y) * resized.width * c + left * c;
    const rowR = y * SIZE;
    const rowG = SIZE * SIZE + y * SIZE;
    const rowB = 2 * SIZE * SIZE + y * SIZE;
    for (let x = 0; x < SIZE; x++) {
      const p = rowIn + x * c;
      out[rowR + x] = resized.data[p] / 255;
      out[rowG + x] = resized.data[p + 1] / 255;
      out[rowB + x] = resized.data[p + 2] / 255;
    }
  }
  return out;
}
