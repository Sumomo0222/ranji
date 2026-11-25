// 打印某次 OCR 结果经版面解析后的单元格，便于排查。
//   node tools/ocr/debug-cells.mjs <results.json> <sample.png> [...]
import fs from 'node:fs';
import { parseScreenshot } from '../../src/core/screenshot-parse.js';
const [file, ...names] = process.argv.slice(2);
const d = JSON.parse(fs.readFileSync(file, 'utf8'));
for (const f of names) {
  const r = d[f];
  const p = parseScreenshot(r.ocr.passes, { width: 1170, height: 2532 });
  console.log('===', f, '| inverted', r.ocr.inverted.join(','));
  for (const c of p.cells) console.log(`   [${c.row}] ${JSON.stringify(c.text)} conf ${c.confidence}  y ${c.bbox.y0}-${c.bbox.y1}  x ${c.bbox.x0}-${c.bbox.x1}`);
  console.log('   ->', ['type', 'kcal', 'minutes', 'distanceKm', 'steps'].map((k) => `${k}=${p[k] == null ? '—' : typeof p[k] === 'object' ? `${p[k].value}(${p[k].why})` : p[k]}`).join('  '));
}
