// 生成两样东西：
//   1) src/ui/lucide.js —— 应用用到的 lucide 图标（ISC 许可）内联 SVG 路径
//   2) static/icons/* —— 应用图标（朱砂印章「燃」）的 PNG 与 SVG
// 用法：node tools/gen-icons.mjs [--preview]
// 需要 lucide-static 的解包目录（默认 .scratch/lucide/package），缺失时会自动从 npm 镜像下载。
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LUCIDE_VERSION = '1.79.0';

export const ICON_NAMES = [
  // 导航
  'notebook-pen', 'chart-column', 'notebook-text', 'user-round',
  // 通用操作
  'plus', 'x', 'check', 'check-check', 'minus', 'search', 'chevron-left', 'chevron-right', 'chevron-down', 'arrow-left', 'arrow-right', 'arrow-up-right', 'pencil', 'trash-2', 'camera', 'image-plus', 'image', 'scan-line', 'sparkles', 'download', 'upload', 'share-2', 'copy', 'refresh-cw', 'info', 'triangle-alert', 'external-link', 'history', 'list', 'eye', 'loader-circle', 'badge-check', 'circle-check', 'target', 'scale', 'ruler',
  // 提醒与日历
  'bell', 'bell-ring', 'calendar-plus', 'calendar-check', 'calendar-days', 'alarm-clock', 'clock', 'stamp',
  // 饮食
  'utensils', 'wheat', 'beef', 'soup', 'apple', 'cup-soda', 'milk', 'candy', 'egg', 'drumstick', 'droplet', 'sunrise', 'sun', 'moon', 'cookie', 'coffee',
  // 运动
  'dumbbell', 'flame', 'heart-pulse', 'footprints', 'person-standing', 'bike', 'waves', 'flower-2', 'orbit', 'volleyball', 'kayak', 'music', 'mountain', 'activity', 'gauge', 'biceps-flexed', 'timer', 'weight', 'trending-up', 'trending-down', 'trophy', 'medal',
  // 设置与数据
  'settings', 'sliders-horizontal', 'database', 'cpu', 'shield-check', 'file-json', 'smartphone', 'zap', 'leaf', 'moon-star', 'contrast', 'languages',
];

async function lucideDir() {
  const dir = path.join(root, '.scratch/lucide/package');
  if (!fs.existsSync(path.join(dir, 'icons'))) {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    const tgz = path.join(root, '.scratch/lucide/lucide.tgz');
    execSync(`curl -s -L "https://registry.npmmirror.com/lucide-static/-/lucide-static-${LUCIDE_VERSION}.tgz" -o "${tgz}"`, { stdio: 'inherit' });
    execSync(`mkdir -p "${dir}" && tar -xzf "${tgz}" -C "${path.dirname(dir)}"`);
  }
  return path.join(dir, 'icons');
}

async function writeLucideModule() {
  const dir = await lucideDir();
  const out = [];
  for (const name of ICON_NAMES) {
    const file = path.join(dir, `${name}.svg`);
    if (!fs.existsSync(file)) throw new Error(`lucide 图标不存在: ${name}`);
    const svg = fs.readFileSync(file, 'utf8');
    const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/\s+/g, ' ').trim();
    out.push(`  '${name}': '${inner.replace(/'/g, "\\'")}',`);
  }
  const src = `// 由 tools/gen-icons.mjs 生成：lucide v${LUCIDE_VERSION}（ISC License, https://lucide.dev）\n// 仅包含应用用到的图标，内联 SVG 以减少请求。\nexport const ICONS = {\n${out.join('\n')}\n};\n`;
  fs.writeFileSync(path.join(root, 'src/ui/lucide.js'), src);
  fs.mkdirSync(path.join(root, 'static/icons'), { recursive: true });
  fs.writeFileSync(path.join(root, 'static/icons/LUCIDE-LICENSE.txt'), fs.readFileSync(path.join(dir, '..', 'LICENSE')));
  return ICON_NAMES.length;
}

const PAPER = '#F3EFE6';
const CINNABAR = '#C8402D';

export function sealSvg({ size = 512, side = 340, font = '"Kaiti SC", "STKaiti", "Songti SC", serif', weight = 900, glyphSize = 268, style = 'solid', radius = 58 } = {}) {
  const off = (size - side) / 2;
  const ground =
    style === 'solid'
      ? `<rect x="${off}" y="${off}" width="${side}" height="${side}" rx="${radius}" fill="${CINNABAR}"/>
         <rect x="${off + 14}" y="${off + 14}" width="${side - 28}" height="${side - 28}" rx="${radius - 11}" fill="none" stroke="${PAPER}" stroke-opacity=".55" stroke-width="3"/>`
      : `<rect x="${off}" y="${off}" width="${side}" height="${side}" rx="${radius}" fill="none" stroke="${CINNABAR}" stroke-width="18"/>`;
  const ink = style === 'solid' ? '#F8F4EC' : CINNABAR;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${PAPER}"/>
  ${ground}
  <text x="${size / 2}" y="${size / 2 + glyphSize * 0.04}" text-anchor="middle" dominant-baseline="central" font-family='${font}' font-weight="${weight}" font-size="${glyphSize}" fill="${ink}">燃</text>
</svg>`;
}

async function main() {
  const count = await writeLucideModule();
  console.log(`lucide: ${count} icons -> src/ui/lucide.js`);

  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const page = await browser.newPage({ deviceScaleFactor: 1 });

  if (process.argv.includes('--preview')) {
    const fonts = [
      ['"Xingkai SC"', 700], ['"Weibei SC"', 700], ['"Baoli SC"', 400], ['"Libian SC"', 400], ['"Kaiti SC"', 900], ['"Songti SC"', 900], ['"Lantinghei SC"', 800], ['"Yuanti SC"', 700],
    ];
    const cells = [];
    for (const [style, size] of [['solid', 512], ['solid', 96], ['line', 512], ['line', 96]]) {
      for (const [font, weight] of fonts) {
        const glyphSize = style === 'solid' ? 268 : 300;
        cells.push(`<figure><img src="data:image/svg+xml,${encodeURIComponent(sealSvg({ style, font, weight, glyphSize }))}" width="${size}" height="${size}"><figcaption>${font.replace(/"/g, '')} ${weight} · ${style} ${size}</figcaption></figure>`);
      }
    }
    await page.setContent(`<body style="margin:0;padding:24px;background:#E9E3D6;display:grid;grid-template-columns:repeat(8,max-content);gap:18px;width:1180px;font:12px Menlo">${cells.join('')}<style>figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:8px}figcaption{color:#555;white-space:nowrap}</style></body>`);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(root, '.shots/seal-preview.png'), fullPage: true });
    await browser.close();
    console.log('preview -> .shots/seal-preview.png');
    return;
  }

  const icons = [
    ['icon-512.png', 512, { side: 336, glyphSize: 262 }],
    ['icon-192.png', 192, { side: 336, glyphSize: 262 }],
    ['icon-180.png', 180, { side: 336, glyphSize: 262 }],
    ['icon-64.png', 64, { side: 336, glyphSize: 262, radius: 64 }],
    ['maskable-512.png', 512, { side: 272, glyphSize: 214, radius: 48 }],
  ];
  const outDir = path.join(root, 'static/icons');
  fs.mkdirSync(outDir, { recursive: true });
  for (const [name, px, opt] of icons) {
    await page.setViewportSize({ width: px, height: px });
    await page.setContent(`<body style="margin:0">${sealSvg(opt)}</body>`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(outDir, name) });
  }
  fs.writeFileSync(path.join(outDir, 'icon.svg'), sealSvg());
  await browser.close();
  console.log('icons ->', icons.map(([n]) => n).join(', '));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
