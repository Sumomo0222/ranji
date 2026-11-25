// 给各个底部面板截图（先切到对应标签页，再打开面板，等动画结束）。
//   node tools/sheets.mjs
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await startServer(path.join(ROOT, 'docs'));
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const shots = [
  ['x-quick', 'home', '[data-fab]', 1100],
  ['x-goals', 'me', '[data-act="goals"]', 900],
  ['x-engines', 'me', '[data-act="engines"]', 1600],
  ['x-data', 'me', '[data-act="data"]', 1200],
  ['x-weight', 'me', '[data-act="weight"]', 900],
  ['x-about', 'me', '[data-act="about"]', 900],
];
for (const [name, tab, open, wait] of shots) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(server.url + '?demo=1', { waitUntil: 'load' });
    await page.waitForSelector('.checkin');
    if (tab !== 'home') await page.click(`.tab[data-tab="${tab}"]`);
    await page.waitForTimeout(400);
    await page.click(open);
    await page.waitForTimeout(wait);
    await page.screenshot({ path: path.join(ROOT, '.shots/e2e', `${name}.png`) });
    console.log('ok', name, errors.length ? 'ERRORS: ' + errors.join(' | ') : '');
  } catch (err) {
    console.log('FAIL', name, String(err.message).split('\n')[0]);
  }
  await ctx.close();
}
await browser.close();
await server.close();
