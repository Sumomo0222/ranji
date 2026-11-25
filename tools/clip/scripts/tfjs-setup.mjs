// Shared setup for the OFFLINE reference pipeline (Transformers.js v4 in Node, onnxruntime-node CPU EP).
// All model files are read from tools/clip/cache/hf (downloaded from hf-mirror.com at the pinned revision).
// Network access is disabled on purpose: env.allowRemoteModels = false makes any missing file a hard error.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as tf from '@huggingface/transformers';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');            // tools/clip
export const PROJECT = path.resolve(ROOT, '../..');                                              // project root
export const MODEL_ID = 'Xenova/mobileclip_s0';
export const REVISION = '757d59c9c6870a76a4b0306f05f5061bca15c39f';

tf.env.allowRemoteModels = false;
tf.env.allowLocalModels = true;
tf.env.localModelPath = path.join(ROOT, 'cache', 'tfjs-local') + path.sep; // layout: <localModelPath>/Xenova/mobileclip_s0/<file>
tf.env.useBrowserCache = false;

export { tf };

export async function loadTextStack() {
  const tokenizer = await tf.AutoTokenizer.from_pretrained(MODEL_ID, { revision: REVISION, local_files_only: true });
  // fp32 text encoder (never the int8 text model)
  const textModel = await tf.CLIPTextModelWithProjection.from_pretrained(MODEL_ID, {
    revision: REVISION, local_files_only: true, dtype: 'fp32', device: 'cpu',
  });
  return { tokenizer, textModel };
}

export async function loadVisionStack(dtype = 'q8') {
  const processor = await tf.AutoProcessor.from_pretrained(MODEL_ID, { revision: REVISION, local_files_only: true });
  const visionModel = await tf.CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, {
    revision: REVISION, local_files_only: true, dtype, device: 'cpu',
  });
  return { processor, visionModel };
}
