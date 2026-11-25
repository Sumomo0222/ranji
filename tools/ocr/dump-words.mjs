// 把一次 OCR 结果按视觉行打印：每个词的文本、字高与置信度。用于人工检查识别质量。
//   node tools/ocr/dump-words.mjs [results.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const file = process.argv[2] || 'ocr-results.json';
const d = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), file), 'utf8'));
for (const [f, r] of Object.entries(d)) {
  console.log('===', f, 'conf', r.ocr.confidence, 'lines', r.ocr.lines.length, 'words', r.ocr.words.length);
  const rows = [];
  for (const w of r.ocr.words) {
    const { x0, y0, x1, y1 } = w.bbox;
    const row = rows.find((k) => Math.abs(k.y - (y0 + y1) / 2) <= (y1 - y0) * 0.7);
    if (row) { row.items.push([x0, w.text, y1 - y0, w.confidence]); row.y = (row.y + (y0 + y1) / 2) / 2; }
    else rows.push({ y: (y0 + y1) / 2, items: [[x0, w.text, y1 - y0, w.confidence]] });
  }
  for (const row of rows.sort((a, b) => a.y - b.y)) console.log('   ', row.items.sort((a, b) => a[0] - b[0]).map(([x, t, h, c]) => `${t}{${h}px ${c}}`).join('  '));
}
