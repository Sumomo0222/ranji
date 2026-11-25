// 生成仿真的运动 App 截图（390×844 CSS 像素，3 倍屏），作为 OCR 的测试样本。
//   node tools/ocr/make-samples.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'samples');
fs.mkdirSync(OUT, { recursive: true });

const font = '-apple-system, "PingFang SC", "Helvetica Neue", sans-serif';
const ring = (pct, color) => `background:conic-gradient(${color} ${pct}%, rgba(255,255,255,.12) 0);border-radius:50%;`;
const bar = (w, c) => `<span style="display:inline-block;height:8px;border-radius:4px;background:${c};width:${w}%"></span>`;

const screens = [
  ['apple_fitness', 'walk', 42, 486, 5.2, 8432, `
    <div class="phone" style="background:#000;color:#fff">
      <div class="status"><span>9:41</span><span>●●● ⚙ ▮</span></div>
      <div style="padding:22px 24px 0">
        <div style="font-size:34px;font-weight:700">户外步行</div>
        <div style="color:#8e8e93;font-size:15px;margin-top:2px">今天 上午 7:32</div>
      </div>
      <div style="display:flex;justify-content:center;margin:28px 0 10px">
        <div style="width:210px;height:210px;${ring(72, '#a4f44a')};display:grid;place-items:center">
          <div style="width:170px;height:170px;border-radius:50%;background:#000;display:grid;place-items:center;text-align:center">
            <div><div style="font-size:56px;font-weight:600;line-height:1">486</div><div style="color:#a4f44a;font-size:15px;margin-top:4px">千卡</div><div style="color:#8e8e93;font-size:13px">活动能量</div></div>
          </div>
        </div>
      </div>
      <div style="padding:0 24px">
        ${[['锻炼', '42分钟', '#fb5b5b'], ['步数', '8,432', '#f7b32b'], ['距离', '5.2千米', '#4fd8e8']].map(([k, v, c]) => `
        <div style="display:flex;align-items:center;gap:14px;padding:14px 0;border-bottom:1px solid #1c1c1e">
          <span style="width:30px;height:30px;border-radius:8px;${ring(60, c)}"></span>
          <span style="flex:1;color:#8e8e93;font-size:17px">${k}</span><span style="font-size:22px;font-weight:600">${v}</span>
        </div>`).join('')}
        <div style="display:flex;justify-content:space-between;margin-top:18px;color:#8e8e93;font-size:15px"><span>总时长</span><span style="color:#fff">42:18</span></div>
        <div style="display:flex;justify-content:space-between;margin-top:10px;color:#8e8e93;font-size:15px"><span>平均配速</span><span style="color:#fff">8'02"/公里</span></div>
      </div>`],
  ['keep_run', 'run', 32, 386, 5.21, null, `
    <div class="phone" style="background:#f6f6f8;color:#111">
      <div class="status"><span>20:15</span><span>▮▮▮</span></div>
      <div style="padding:14px 22px 0;color:#888;font-size:13px">11月24日 · 户外跑</div>
      <div style="padding:8px 22px 0;font-size:60px;font-weight:800;letter-spacing:-.02em">5.21<span style="font-size:18px;font-weight:500;margin-left:6px;color:#666">公里</span></div>
      <div style="margin:18px 22px 0;background:#fff;border-radius:18px;padding:6px 0">
        ${[['总时长', '32:05'], ['消耗', '386千卡'], ['配速', "6'09\""], ['步频', '170 步/分钟'], ['平均心率', '145 次/分钟']].map(([k, v], i) => `
        <div style="display:flex;justify-content:space-between;padding:${i ? 12 : 16}px 20px;font-size:16px;border-bottom:${i === 4 ? 0 : '1px solid #eee'}"><span style="color:#777">${k}</span><b>${v}</b></div>`).join('')}
      </div>
      <div style="margin:16px 22px 0;background:#ffe812;border-radius:14px;padding:14px 18px;font-size:14px;color:#222">跑得漂亮！本周已累计 18.6 公里</div>`],
  ['strava', 'run', 28, 386, 5.21, null, `
    <div class="phone" style="background:#171717;color:#fff">
      <div class="status"><span>6:48</span><span>▲ ▮</span></div>
      <div style="padding:18px 22px 0;display:flex;justify-content:space-between;align-items:center"><span style="color:#fc4c02;font-weight:700;font-size:18px">STRAVA</span><span style="color:#999;font-size:13px">Tue, Nov 24</span></div>
      <div style="padding:26px 22px 0;font-size:36px;font-weight:700">Morning Run</div>
      <div style="padding:8px 22px 0;color:#999;font-size:15px">Sunrise Park Loop · Running</div>
      <div style="display:flex;gap:26px;padding:30px 22px 0">
        ${[['Distance', '5.21', 'km'], ['Time', '28:06', ''], ['Energy', '386', 'kcal']].map(([k, v, u]) => `<div><div style="color:#999;font-size:12px">${k}</div><div style="font-size:40px;font-weight:700">${v}<span style="font-size:14px;font-weight:400;margin-left:3px">${u}</span></div></div>`).join('')}
      </div>
      <div style="margin:28px 22px 0;height:120px;background:#242424;border-radius:12px;display:flex;align-items:flex-end;gap:3px;padding:10px">${Array.from({ length: 28 }, (_, i) => `<span style="flex:1;height:${30 + Math.round(Math.sin(i * 0.7) * 20 + 30)}%;background:#fc4c02;border-radius:2px"></span>`).join('')}</div>
      <div style="padding:16px 22px;color:#999;font-size:14px">Avg Heart Rate <b style="color:#fff">145 bpm</b> · Avg Pace <b style="color:#fff">5'24"/mi</b> · Elev 64 m</div>`],
  ['huawei', 'run', 40, 356, 6.0, null, `
    <div class="phone" style="background:#fff;color:#111">
      <div class="status"><span>08:05</span><span>●● ▮</span></div>
      <div style="padding:16px 22px 0;display:flex;justify-content:space-between;align-items:center"><span style="font-size:15px;color:#888">‹</span><span style="font-size:16px;font-weight:600">运动记录</span><span style="font-size:24px;color:#888">⋯</span></div>
      <div style="padding:22px 22px 0;font-size:30px;font-weight:700">跑步机</div>
      <div style="padding:4px 22px 0;color:#888;font-size:14px">今天 07:12 · 有氧耐力</div>
      <div style="margin:20px 22px 0;display:grid;grid-template-columns:1fr 1fr;gap:12px">
        ${[['时长', '40:12'], ['热量', '356千卡'], ['距离', '6.0公里'], ['平均配速', "6'42\""]].map(([k, v]) => `<div style="background:#f5f6f8;border-radius:14px;padding:16px"><div style="color:#888;font-size:13px">${k}</div><div style="font-size:30px;font-weight:700;margin-top:4px">${v}</div></div>`).join('')}
      </div>
      <div style="padding:20px 22px;color:#888;font-size:14px">平均心率 <b style="color:#111">152 次/分钟</b> · 步频 <b style="color:#111">164</b></div>
      <div style="margin:0 22px;height:90px;display:flex;align-items:flex-end;gap:2px">${Array.from({ length: 40 }, (_, i) => `<span style="flex:1;height:${35 + ((i * 37) % 55)}%;background:#4a7cf7;border-radius:2px"></span>`).join('')}</div>`],
  ['wechat_steps', 'walk', null, null, null, 8432, `
    <div class="phone" style="background:#ededed;color:#111">
      <div class="status"><span>21:30</span><span>▮▮▮</span></div>
      <div style="background:#fff;padding:12px 18px;text-align:center;font-size:17px;border-bottom:1px solid #d9d9d9">微信运动</div>
      <div style="background:#fff;margin-top:10px;padding:30px 0;text-align:center">
        <div style="color:#888;font-size:15px">今天步数</div>
        <div style="font-size:76px;font-weight:600;margin-top:4px">8,432<span style="font-size:20px;color:#888;margin-left:4px">步</span></div>
        <div style="color:#888;font-size:13px;margin-top:4px">超过了 92% 的朋友</div>
      </div>
      <div style="background:#fff;margin-top:10px;padding:6px 18px;font-size:16px">
        <div style="display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px solid #eee"><span>排行榜</span><span>›</span></div>
        <div style="display:flex;justify-content:space-between;padding:12px 0"><span>步数排行榜</span><span>›</span></div>
      </div>`],
  ['gym', 'strength', 60, 320, null, null, `
    <div class="phone" style="background:#101418;color:#fff">
      <div class="status"><span>18:30</span><span>▮</span></div>
      <div style="padding:20px 24px 0;color:#8a94a6;font-size:14px">11月24日 · 傍晚</div>
      <div style="padding:6px 24px 0;font-size:40px;font-weight:800">力量训练</div>
      <div style="padding:6px 24px 0;color:#8a94a6;font-size:15px">8 个动作 · 12 组</div>
      <div style="display:flex;gap:14px;margin:30px 24px 0">
        ${[['60', '分钟'], ['320', '千卡'], ['4,280', 'kg 总容量']].map(([v, u]) => `<div style="flex:1;background:#1b2129;border-radius:16px;padding:16px 0;text-align:center"><div style="font-size:34px;font-weight:700">${v}</div><div style="color:#8a94a6;font-size:13px">${u}</div></div>`).join('')}
      </div>
      <div style="margin:24px 24px 0;background:#1b2129;border-radius:16px;padding:4px 18px;font-size:16px">
        ${[['深蹲', '5 组 × 8'], ['卧推', '4 组 × 10'], ['硬拉', '3 组 × 5']].map(([k, v]) => `<div style="display:flex;justify-content:space-between;padding:13px 0;border-bottom:1px solid #262d37"><span>${k}</span><span style="color:#8a94a6">${v}</span></div>`).join('')}
      </div>`],
  ['decoy', 'indoor_cycle', 45, 412, null, null, `
    <div class="phone" style="background:#fff;color:#111">
      <div class="status"><span>18:30</span><span>▮▮▮</span></div>
      <div style="padding:14px 22px 0;color:#888;font-size:14px">11月24日 周一</div>
      <div style="padding:6px 22px 0;font-size:34px;font-weight:700">动感单车</div>
      <div style="margin:24px 22px 0;text-align:center">
        <div style="font-size:80px;font-weight:200">45:00</div><div style="color:#888;font-size:15px">骑行时长</div>
      </div>
      <div style="display:flex;justify-content:space-around;margin:26px 22px 0;text-align:center">
        ${[['412', '千卡'], ['92', '踏频'], ['8', '阻力'], ['18.4', 'km/h']].map(([v, u]) => `<div><div style="font-size:30px;font-weight:600">${v}</div><div style="color:#888;font-size:13px">${u}</div></div>`).join('')}
      </div>`],
  ['swim', 'swim', 35, 420, 1.2, null, `
    <div class="phone" style="background:linear-gradient(#0b3d63,#06263d);color:#fff">
      <div class="status"><span>07:55</span><span>▮▮▮</span></div>
      <div style="padding:20px 24px 0;color:#9cc7e6;font-size:14px">游泳池 · 自由泳</div>
      <div style="padding:6px 24px 0;font-size:42px;font-weight:800">游泳</div>
      <div style="padding:30px 24px 0;font-size:72px;font-weight:700">1.2<span style="font-size:22px;font-weight:400;margin-left:6px">公里</span></div>
      <div style="display:flex;gap:36px;padding:26px 24px 0">
        ${[['35:20', '用时'], ['420千卡', '消耗'], ['24', '趟数']].map(([v, u]) => `<div><div style="font-size:36px;font-weight:700">${v}</div><div style="color:#9cc7e6;font-size:14px">${u}</div></div>`).join('')}
      </div>`],
  ['garmin', 'run', 39, 512, 6.42, null, `
    <div class="phone" style="background:#111;color:#9df542">
      <div class="status"><span>07:15</span><span>▮</span></div>
      <div style="padding:16px 22px 0;font-size:13px;color:#888">Mon 24 Nov 2026 07:15</div>
      <div style="padding:6px 22px 0;font-size:34px;font-weight:700;color:#fff">Running</div>
      <div style="padding:4px 22px 0;font-size:14px;color:#888">Road Running · Outdoor</div>
      <div style="padding:26px 22px 0;display:grid;grid-template-columns:1fr 1fr;gap:14px">
        ${[['Distance', '6.42 km'], ['Time', '38:51'], ['Calories', '512 kcal'], ['Avg Pace', "6'03\" /km"], ['Avg HR', '158 bpm'], ['Avg Speed', '9.9 km/h']].map(([k, v]) => `<div style="background:#1c1c1c;border-radius:12px;padding:12px 14px"><div style="font-size:11px;color:#888">${k}</div><div style="font-size:26px;font-weight:700;margin-top:2px;color:#fff">${v}</div></div>`).join('')}
      </div>`],
];

const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 430, height: 884 }, deviceScaleFactor: 3, locale: 'zh-CN' });
const page = await ctx.newPage();
const expected = {};
for (const [name, type, minutes, kcal, distanceKm, steps, body] of screens) {
  await page.setContent(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
    body{margin:0;padding:20px;background:#555;font-family:${font};-webkit-font-smoothing:antialiased}
    .phone{width:390px;height:844px;overflow:hidden;border-radius:0;box-sizing:border-box}
    .status{display:flex;justify-content:space-between;padding:14px 26px 0;font-size:14px;font-weight:600}
  </style></head><body>${body}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(120);
  await page.locator('.phone').screenshot({ path: path.join(OUT, `${name}.png`) });
  expected[`${name}.png`] = { type, minutes, kcal, distanceKm, steps };
}
await browser.close();
fs.writeFileSync(path.join(OUT, 'expected.json'), JSON.stringify(expected, null, 2));
console.log(`wrote ${screens.length} screenshots to tools/ocr/samples`);
