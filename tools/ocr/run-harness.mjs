// 在真实目标环境里验证 OCR：本地静态服务器把项目根挂在 /ranji/ 下（无特殊响应头），
// 无头 Chrome 只从同源加载 Tesseract，对 tools/ocr/samples 里的截图逐张识别，再用应用里的解析器比对期望值。
//   node tools/ocr/run-harness.mjs [--langs=chi_sim+eng] [--scale=1] [--out=ocr-results.json]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { parseScreenshot } from '../../src/core/screenshot-parse.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PREFIX = '/ranji/';
const MIME = { html: 'text/html; charset=utf-8', mjs: 'text/javascript', js: 'text/javascript', wasm: 'application/wasm', gz: 'application/gzip', png: 'image/png' };
const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => a.replace(/^--/, '').split('=')));
const langs = opt.langs || 'chi_sim+eng';
const scale = Number(opt.scale || 1);
const psm = Number(opt.psm || 3);
const quiet = 'quiet' in opt;
const scales = String(opt.scales || String(scale)).split(',').map(Number);
const prep = opt.prep || 'auto';
// --passes=orig:0.5,inv:0.5  指定多遍（预处理:缩放）；不指定时用 --scales 与 --prep
const passSpecs = opt.passes ? String(opt.passes).split(',').map((x) => { const [p, sc] = x.split(':'); return { prep: p === 'inv' ? 'auto' : 'none', scale: Number(sc) }; }) : scales.map((sc) => ({ prep, scale: sc }));
const label = passSpecs.map((x) => `${x.prep === 'none' ? 'orig' : 'inv'}:${x.scale}`).join(',');

execSync('node tools/ocr/build-harness.mjs', { cwd: ROOT, stdio: 'inherit' });

const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).slice(PREFIX.length));
  if (!req.url.startsWith(PREFIX) || !file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    console.log('404', req.url);
    return res.writeHead(404).end('not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).slice(1)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto(`${origin}${PREFIX}tools/ocr/harness/page.html`);
await page.waitForFunction(() => window.ocrReady === true, null, { timeout: 20000 });

const samplesDir = path.join(ROOT, 'tools/ocr/samples');
const expected = JSON.parse(fs.readFileSync(path.join(samplesDir, 'expected.json'), 'utf8'));
const files = Object.keys(expected);
const results = {};
let fieldsHit = 0;
let fieldsTotal = 0;
for (const file of files) {
  const b64 = fs.readFileSync(path.join(samplesDir, file)).toString('base64');
  const passes = [];
  for (const spec of passSpecs) passes.push(await page.evaluate((args) => window.runOcr(args), { b64, langs, scale: spec.scale, psm, prep: spec.prep }));
  const r = { passes, inverted: passes.map((p) => p.inverted) };
  const size = await page.evaluate(async (b) => { const bm = await createImageBitmap(await (await fetch(`data:image/png;base64,${b}`)).blob()); return [bm.width, bm.height]; }, b64);
  const parsed = parseScreenshot(passes, { width: size[0], height: size[1] });
  const exp = expected[file];
  const check = (name, got, want, tol = 0.51) => {
    fieldsTotal += want == null ? 0 : 1;
    const ok = want == null ? got == null : got != null && (typeof want === 'number' ? Math.abs(got - want) <= tol : got === want);
    if (ok && want != null) fieldsHit += 1;
    return `${name} ${ok ? '✓' : '✗'}(${got ?? '—'}${ok ? '' : ` want ${want}`})`;
  };
  const summary = [check('type', parsed.type, exp.type), check('min', parsed.minutes?.value, exp.minutes), check('kcal', parsed.kcal?.value, exp.kcal), check('km', parsed.distanceKm?.value, exp.distanceKm, 0.011), check('steps', parsed.steps?.value, exp.steps)].join('  ');
  results[file] = { langs, scale, ocr: r, parsed, expected: exp, summary };
  console.log(`\n=== ${file}  [${langs} ${label} psm ${psm}]  rec ${passes.map((p) => p.tRec).join('+')} ms · conf ${passes.map((p) => p.confidence).join('/')} · inverted ${r.inverted.join('/')}`);
  if (!quiet) console.log(parsed.cells.map((c) => `  [${c.row}] ${c.text}{${c.confidence}}`).join('\n'));
  console.log('  ' + summary + '   ' + ['kcal', 'minutes', 'distanceKm', 'steps'].map((f) => `${f}=${parsed[f] ? `${parsed[f].value}(${parsed[f].why})` : '—'}`).join(' '));
}
console.log(`\nFIELDS: ${fieldsHit}/${fieldsTotal} correct  (langs=${langs}, passes=${label}, psm ${psm})`);
if (errors.length) console.log('Console errors:\n' + errors.join('\n'));
fs.writeFileSync(path.join(ROOT, 'tools/ocr', opt.out || 'ocr-results.json'), JSON.stringify(results, null, 1));
await browser.close();
server.close();
