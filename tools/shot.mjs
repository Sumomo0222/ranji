// 在无头 Chrome（系统自带 Google Chrome）里给页面截图，用于视觉检查。
//   node tools/shot.mjs <file-or-url> <out.png> [--w=390] [--h=844] [--scale=3] [--full] [--wait=600] [--sel=css] [--mobile] [--night]
//   node tools/shot.mjs serve <out.png> [--...]        把 docs/ 挂在 /ranji/ 下（与线上一致），可用 --path=/?demo=1 指定页面
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const [target, out, ...rest] = process.argv.slice(2);
// 选项形如 --key=value，只在第一个 = 处切分，value 里可以再有 =
const opt = Object.fromEntries(
  rest
    .filter((a) => a !== 'serve')
    .map((a) => {
      const i = a.indexOf('=');
      return i < 0 ? [a.replace(/^--/, ''), ''] : [a.slice(2, i), a.slice(i + 1)];
    }),
);
const mobile = 'mobile' in opt || target === 'serve';
const width = +(opt.w || 390);
const height = +(opt.h || 844);
const scale = +(opt.scale || 3);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const server = target === 'serve' ? await startServer(path.join(ROOT, 'docs')) : null;
const url = server ? server.url + String(opt.path || '/').replace(/^\/+/, '') : /^https?:/.test(target) ? target : 'file://' + path.resolve(target);

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, isMobile: mobile, hasTouch: mobile, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[console.${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => errors.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));
await page.goto(url, { waitUntil: 'load' });
if (opt.night) await page.evaluate(() => (document.documentElement.dataset.theme = 'night'));
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(+(opt.wait || 900));
if (opt.click) for (const sel of String(opt.click).split('>>')) await page.locator(sel).first().click();
if (opt.tab) {
  await page.locator(`.tab[data-tab="${opt.tab}"]`).click();
  await page.waitForTimeout(500);
}
if (opt.eval) await page.evaluate(opt.eval);
if (opt.wait2) await page.waitForTimeout(+opt.wait2);
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
if (opt.sel) await page.locator(opt.sel).first().screenshot({ path: out });
else await page.screenshot({ path: out, fullPage: 'full' in opt });
await browser.close();
if (server) await server.close();
const failed = server ? server.requests.filter((r) => r.status >= 400) : [];
console.log('saved', out, errors.length ? '\n' + errors.join('\n') : '(no console errors)', failed.length ? '\nfailed requests: ' + failed.map((r) => r.url).join(' ') : '');
