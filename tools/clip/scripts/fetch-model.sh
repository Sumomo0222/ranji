#!/bin/bash
# Downloads the pinned Xenova/mobileclip_s0 files from the hf-mirror.com mirror into tools/clip/cache/hf/
set -u
REV=757d59c9c6870a76a4b0306f05f5061bca15c39f
BASE="https://hf-mirror.com/Xenova/mobileclip_s0/resolve/$REV"
DEST="$(cd "$(dirname "$0")/.." && pwd)/cache/hf"
mkdir -p "$DEST/onnx"
for f in onnx/vision_model_quantized.onnx onnx/text_model.onnx tokenizer.json tokenizer_config.json preprocessor_config.json config.json LICENSE README.md; do
  mkdir -p "$DEST/$(dirname "$f")"
  if [ -s "$DEST/$f" ]; then echo "have $f"; continue; fi
  echo "fetch $f"
  curl -sS -L --retry 5 --retry-delay 3 -m 1800 -o "$DEST/$f.part" "$BASE/$f" && mv "$DEST/$f.part" "$DEST/$f" || { echo "FAILED $f"; exit 1; }
done
echo DONE
