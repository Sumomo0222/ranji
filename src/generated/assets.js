// 站点内较重的资源清单（路径与字节数）。由 tools/build.mjs 在构建时按 static/ 目录的实际文件生成，请勿手改。
export const ASSETS = {
  ortWasm: { file: 'vendor/ort/ort-wasm-simd-threaded.wasm', size: 14848852 },
  visionModel: { file: 'models/mobileclip/vision_model_fp16.onnx', size: 22876479 },
  textEmbeds: { file: 'models/mobileclip/text_embeds.bin', size: 189440 },
  textEmbedsMeta: { file: 'models/mobileclip/text_embeds.json', size: 3577 },
  ocrWorker: { file: 'vendor/ocr/worker.min.js', size: 111307 },
  ocrCore: { file: 'vendor/ocr/tesseract-core-simd-lstm.wasm.js', size: 3899472 },
  ocrLangZh: { file: 'vendor/ocr/lang/chi_sim.traineddata.gz', size: 1718768 },
  ocrLangEn: { file: 'vendor/ocr/lang/eng.traineddata.gz', size: 2952873 },
};

/** 资源地址：相对打包文件所在目录解析，站点挂在子路径下也能用 */
export const assetURL = (file) => new URL('../' + file, import.meta.url).href;

export const ENGINE_BYTES = {
  vision: ASSETS.ortWasm.size + ASSETS.visionModel.size + ASSETS.textEmbeds.size + ASSETS.textEmbedsMeta.size,
  ocr: ASSETS.ocrWorker.size + ASSETS.ocrCore.size + ASSETS.ocrLangZh.size + ASSETS.ocrLangEn.size,
};

/** 下载时的传输量估计（字节），只在界面里展示用 */
export const ENGINE_TRANSFER = { vision: 26906390, ocr: 6161927 };
