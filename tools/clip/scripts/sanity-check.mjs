// (a) Pipeline sanity: reproduces the README example of Xenova/mobileclip_s0 (zero-shot cats / dogs / birds on cats.jpg)
// with the offline Transformers.js reference stack, for the int8 vision model that is shipped (q8) and for the fp32 one.
// It also reports the agreement between the Transformers.js processor and our own preprocessing (see lib/preprocess.mjs).
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { tf, ROOT, loadTextStack, loadVisionStack } from './tfjs-setup.mjs';
import { dot, softmax, cosine, normalize } from './lib/math.mjs';
import { preprocessToTensor } from './lib/preprocess.mjs';

const imageFile = process.argv[2] ?? path.join(ROOT, 'test-images/_sanity/cats.jpg');
const classes = ['cats', 'dogs', 'birds'];
const round = (xs, d = 6) => xs.map((x) => +x.toFixed(d));

const { tokenizer, textModel } = await loadTextStack();
const textInputs = tokenizer(classes, { padding: 'max_length', truncation: true });
const { text_embeds } = await textModel(textInputs);
const textEmb = [];
for (let i = 0; i < classes.length; i++) textEmb.push(normalize(text_embeds.data.subarray(i * text_embeds.dims[1], (i + 1) * text_embeds.dims[1])));
const rawNorm = (t, row) => Math.sqrt(dot(t.data.subarray(row * t.dims[1], (row + 1) * t.dims[1]), t.data.subarray(row * t.dims[1], (row + 1) * t.dims[1])));
console.log('text_embeds dims', text_embeds.dims, text_embeds.type, '| norm of raw rows (model output is NOT unit-norm):', [0, 1, 2].map((r) => +rawNorm(text_embeds, r).toFixed(3)).join(', '));

const image = await tf.RawImage.read(imageFile);
console.log('image', path.basename(imageFile), `${image.width}x${image.height}`, 'channels', image.channels);

const { processor } = await loadVisionStack('q8');
const imageInputs = await processor(image);
const refPixels = imageInputs.pixel_values;
console.log('processor pixel_values dims', refPixels.dims, refPixels.type);

const mine = preprocessToTensor(image.data, image.width, image.height, { channels: image.channels });
let maxAbs = 0, sumAbs = 0;
for (let i = 0; i < mine.length; i++) { const d = Math.abs(mine[i] - refPixels.data[i]); if (d > maxAbs) maxAbs = d; sumAbs += d; }
const naive = preprocessToTensor(image.data, image.width, image.height, { channels: image.channels, filter: 'naive' });
let maxAbsN = 0, sumAbsN = 0;
for (let i = 0; i < naive.length; i++) { const d = Math.abs(naive[i] - refPixels.data[i]); if (d > maxAbsN) maxAbsN = d; sumAbsN += d; }
console.log(`pixel diff vs processor (own triangle): mean abs ${(sumAbs / mine.length * 255).toFixed(3)}/255, max abs ${(maxAbs * 255).toFixed(1)}/255`);
console.log(`pixel diff vs processor (naive bilinear): mean abs ${(sumAbsN / naive.length * 255).toFixed(3)}/255, max abs ${(maxAbsN * 255).toFixed(1)}/255`);

const out = { image: path.basename(imageFile), size: [image.width, image.height], classes, runs: {} };
let lastImageEmbedMeta = null;
for (const dtype of process.argv.includes('--q8-only') ? ['q8'] : ['q8', 'fp32']) {
  const { visionModel } = await loadVisionStack(dtype);
  const run = async (pixels) => {
    const { image_embeds } = await visionModel({ pixel_values: new tf.Tensor('float32', pixels, [1, 3, 256, 256]) });
    lastImageEmbedMeta = { dims: image_embeds.dims, type: image_embeds.type, rawNorm: +Math.sqrt(dot(image_embeds.data, image_embeds.data)).toFixed(3) };
    return normalize(image_embeds.data);
  };
  const t0 = performance.now();
  const embRef = await run(refPixels.data);
  const tRef = performance.now() - t0;
  console.log(`[${dtype}] image_embeds`, JSON.stringify(lastImageEmbedMeta));
  const embMine = await run(mine);
  const embNaive = await run(naive);
  const probsOf = (e) => softmax(textEmb.map((t) => 100 * dot(e, t)));
  out.runs[dtype] = {
    ms_first_run_incl_warmup: +tRef.toFixed(1),
    processor: { probs: round(probsOf(embRef)), raw_cos: round(textEmb.map((t) => dot(embRef, t))) },
    own_preprocessing: { probs: round(probsOf(embMine)), raw_cos: round(textEmb.map((t) => dot(embMine, t))) },
    naive_bilinear: { probs: round(probsOf(embNaive)) },
    cosine_own_vs_processor: +cosine(embMine, embRef).toFixed(6),
    cosine_naive_vs_processor: +cosine(embNaive, embRef).toFixed(6),
  };
  if (dtype === 'q8') out.runs.q8.emb = { ref: Array.from(embRef), own: Array.from(embMine) };
  else {
    out.runs.fp32.emb = { ref: Array.from(embRef) };
    out.cosine_q8_vs_fp32_same_pixels = +cosine(out.runs.q8.emb.ref, embRef).toFixed(6);
    delete out.runs.q8.emb; delete out.runs.fp32.emb;
  }
  const r = out.runs[dtype];
  const order = (p) => classes.map((c, i) => `${c}=${p[i].toFixed(4)}`).join('  ');
  console.log(`[${dtype}] via Transformers.js processor : ${order(r.processor.probs)}`);
  console.log(`[${dtype}] via own preprocessing         : ${order(r.own_preprocessing.probs)}`);
  console.log(`[${dtype}] via naive bilinear            : ${order(r.naive_bilinear.probs)}`);
  console.log(`[${dtype}] cosine(own, processor)=${r.cosine_own_vs_processor}  cosine(naive, processor)=${r.cosine_naive_vs_processor}`);
}
console.log(`cosine(q8 embedding, fp32 embedding) for identical pixels = ${out.cosine_q8_vs_fp32_same_pixels}`);
mkdirSync(path.join(ROOT, 'out'), { recursive: true });
writeFileSync(path.join(ROOT, 'out/sanity.json'), JSON.stringify(out, null, 2));
