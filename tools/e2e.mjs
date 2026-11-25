// 端到端测试：在模拟手机的无头 Chrome 里走一遍真实流程。
//   node tools/e2e.mjs [--only=名称片段] [--headed] [--live]
//   --live：不启动本地服务器，直接对线上地址跑（识别引擎会从线上下载）
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, '.shots/e2e');
const opt = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
fs.mkdirSync(SHOTS, { recursive: true });

const LIVE = 'live' in opt;
const server = LIVE ? { url: 'https://sumomo0222.github.io/ranji/', requests: [], close: async () => {} } : await startServer(path.join(ROOT, 'docs'));
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: !('headed' in opt) });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', acceptDownloads: true });
const page = await ctx.newPage();
// 无头环境里 navigator.share 会挂起不返回；统一走「下载长图」分支
await ctx.addInitScript(() => {
  Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
  Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
});

let pageErrors = [];
const allErrors = [];
page.on('pageerror', (e) => pageErrors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  // 资源加载失败由上面的 response 监听以精确的 URL 报告，这里不再按文字匹配
  if (/favicon/.test(t)) return;
  // Tesseract 的整型语言包会报一批无害的参数告警
  if (/^(Warning: Parameter not found|Estimating resolution as)/.test(t)) return;
  pageErrors.push(`console.error: ${t}`);
});
page.on('requestfailed', (r) => pageErrors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
// 任何 4xx / 5xx 响应都算失败（只放过浏览器自己去要的 /favicon.ico）
page.on('response', (r) => {
  if (r.status() < 400 || new URL(r.url()).pathname === '/favicon.ico') return;
  pageErrors.push(`HTTP ${r.status()} ${r.url()}`);
});

const results = [];
let failed = 0;
const today = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

let stepNo = 0;
async function step(name, fn) {
  stepNo++;
  if (opt.only && !name.includes(opt.only)) return;
  pageErrors = [];
  const t0 = Date.now();
  let timer;
  let line;
  try {
    // 每步限时，避免某个等待没有超时而卡住整个流程
    await Promise.race([fn(), new Promise((_, reject) => (timer = setTimeout(() => reject(new Error('步骤超时（150 秒）')), 150000)))]);
    await page.waitForTimeout(250);
    if (pageErrors.length) throw new Error(pageErrors.join('\n'));
    line = `  ✔ ${name} (${Date.now() - t0} ms)`;
  } catch (err) {
    failed++;
    const shot = path.join(SHOTS, `FAIL-${String(stepNo).padStart(2, '0')}.png`);
    await page.screenshot({ path: shot }).catch(() => {});
    line = `  ✖ ${name}\n      ${String(err.message || err).split('\n').join('\n      ')}\n      截图：${path.relative(ROOT, shot)}`;
    if (pageErrors.length) allErrors.push(`[${name}] ${pageErrors.join(' | ')}`);
  } finally {
    clearTimeout(timer);
  }
  results.push(line);
  console.log(line);
}

const settle = (ms = 350) => page.waitForTimeout(ms);
const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
const top = () => page.locator('.panel').last();
const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('ranji.v1') || 'null'));
const n0 = (v) => Math.round(v).toLocaleString('zh-CN');
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const noPanel = () => page.waitForFunction(() => !document.querySelector('.panel'), null, { timeout: 5000 });

async function chooseFile(clickSelector, file) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 8000 }), page.locator(clickSelector).first().click()]);
  await chooser.setFiles(file);
}

const sum = (s, type) => s.entries.filter((e) => e.type === type && e.date === today).reduce((a, e) => a + e.kcal, 0);

page.setDefaultTimeout(LIVE ? 60000 : 30000);
await page.goto(server.url + '?demo=1', { waitUntil: 'load', timeout: 90000 });
await page.waitForSelector('.checkin', { timeout: 10000 });

await step('首页：示例数据渲染', async () => {
  expect((await page.textContent('.sheet-title')).includes('今日打卡'), '缺少打卡卡片');
  expect(await page.locator('.mealgroup').count() === 2, '餐次分组数量不对');
  await shot('01-home');
});

await step('打卡：盖章并记入状态', async () => {
  const before = await state();
  expect(!before.checkins[today], '今天不应已打卡');
  await page.click('[data-act="checkin"]');
  await page.waitForSelector('.stamp', { timeout: 4000 });
  await settle(500); // 本地存储是延迟写入的
  const after = await state();
  expect(after.checkins[today]?.at, '打卡没有写入');
  expect((await page.textContent('.checkin-foot')).includes('连续'), '缺少连续天数');
  await settle(900);
  await shot('02-stamped');
});

await step('饮食：食物库搜索并记录', async () => {
  await page.click('[data-fab]');
  await top().waitFor();
  expect(await top().locator('.tile').count() === 4, '快捷添加应有四个入口');
  await shot('03-quick-add');
  await top().locator('[data-go="food-lib"]').click();
  await top().locator('[name="q"]').fill('鸡胸');
  await page.waitForFunction(() => document.querySelectorAll('.panel .foodrow').length >= 1);
  const rows = await top().locator('.foodrow').count();
  expect(rows >= 1 && rows <= 3, `搜索「鸡胸」应只有一两条，实际 ${rows}`);
  await top().locator('.foodrow').first().click();
  await top().locator('[name="name"]').waitFor();
  expect((await top().locator('[name="name"]').inputValue()) === '鸡胸肉', '食物名不对');
  const kcal = Number(await top().locator('[name="kcal"]').inputValue());
  expect(kcal > 200 && kcal < 270, `默认份量的热量应在 236 左右，实际 ${kcal}`);
  await shot('04-food-form');
  await top().locator('[data-act="save"]').click();
  await noPanel();
  const s = await state();
  const e = s.entries.find((x) => x.name === '鸡胸肉' && x.date === today);
  expect(e && e.kcal === kcal, '记录没有保存或热量不一致');
});

await step('饮食：按份量调整并手动修正', async () => {
  await page.locator('.entry', { hasText: '鸡胸肉' }).first().click();
  await top().locator('[name="grams"]').waitFor();
  await top().locator('[data-units="2"]').click();
  expect(Number(await top().locator('[name="kcal"]').inputValue()) > 400, '两份的热量应翻倍');
  await top().locator('[name="kcal"]').fill('400');
  await top().locator('[data-act="save"]').click();
  await noPanel();
  const e = (await state()).entries.find((x) => x.name === '鸡胸肉' && x.date === today);
  expect(e.kcal === 400, '修正后的热量没有保存');
  expect(e.portion === '2块', `份量文字应为「2块」，实际「${e.portion}」`);
});

await step('饮食：手动填写', async () => {
  await page.click('[data-act="add-food"][data-meal="snack"]');
  await top().locator('[data-act="manual"]').click();
  await top().locator('[name="name"]').fill('苹果');
  await top().locator('[name="kcal"]').fill('95');
  await top().locator('[name="carbs"]').fill('25');
  await top().locator('[data-act="save"]').click();
  await noPanel();
  const e = (await state()).entries.find((x) => x.name === '苹果' && x.date === today);
  expect(e && e.kcal === 95 && e.meal === 'snack' && e.carbs === 25, '手动记录没有保存');
});

await step('饮食：拍照识别（本地模型）', async () => {
  await page.click('[data-fab]');
  await top().waitFor();
  await chooseFile('.panel [data-go="food-photo"]', path.join(ROOT, 'tools/clip/test-images/food/rice_1.jpg'));
  await top().locator('.cand').first().waitFor({ timeout: 90000 });
  const first = await top().locator('.cand .cand-name').first().textContent();
  expect(first.includes('米饭'), `首位候选应为米饭，实际「${first}」`);
  expect(await top().locator('.cand').count() === 5, '应有五个候选');
  await shot('05-food-candidates');
  await top().locator('.cand').first().click();
  await top().locator('[data-act="save"]').click();
  await noPanel();
  const e = (await state()).entries.find((x) => x.source === 'photo' && x.date === today);
  expect(e && e.foodId === 'rice' && e.photoId, '拍照记录没有保存');
  expect(e.ai?.p > 0.9, `米饭的匹配度应高于 90%，实际 ${e.ai?.p}`);
  await page.waitForFunction(() => document.querySelectorAll('.thumb.is-photo img').length >= 1, null, { timeout: 8000 });
});

await step('饮食：非食物照片给出提示而不是乱猜', async () => {
  await page.click('[data-fab]');
  await top().waitFor();
  await chooseFile('.panel [data-go="food-photo"]', path.join(ROOT, 'tools/clip/test-images/nonfood/dog_1.jpg'));
  await top().locator('.notice').waitFor({ timeout: 60000 });
  expect((await top().textContent()).includes('没有认出'), '应提示没认出食物');
  await top().locator('.panel-close').click();
});

await step('运动：截图识别时长、距离与消耗', async () => {
  await page.click('[data-act="add-exercise"]');
  await top().waitFor();
  await shot('06-exercise-choose');
  await chooseFile('.panel [data-act="shot"]', path.join(ROOT, 'tools/ocr/samples/huawei.png'));
  await top().locator('.detected').waitFor({ timeout: 90000 });
  await shot('07-ocr-result');
  expect(Number(await top().locator('[name="minutes"]').count()) === 0, '应先展示识别结果');
  await top().locator('[data-act="apply"]').click();
  await top().locator('[name="minutes"]').waitFor();
  expect(await top().locator('[name="minutes"]').inputValue() === '40', '时长应为 40');
  expect(await top().locator('[name="kcal"]').inputValue() === '356', '消耗应为 356');
  expect(await top().locator('[name="distanceKm"]').inputValue() === '6', '距离应为 6');
  await shot('08-exercise-form');
  await top().locator('[data-act="save"]').click();
  await noPanel();
  const e = (await state()).entries.find((x) => x.type === 'exercise' && x.source === 'ocr' && x.date === today);
  expect(e && e.minutes === 40 && e.kcal === 356 && e.shotId, '截图识别的运动没有保存');
});

await step('运动：手动记录并按 MET 估算', async () => {
  await page.click('[data-act="add-exercise"]');
  await top().locator('[data-act="manual"]').click();
  await top().locator('[data-ex="yoga"]').click();
  await top().locator('[name="minutes"]').fill('40');
  const kcal = Number(await top().locator('[name="kcal"]').inputValue());
  expect(kcal > 80 && kcal < 130, `瑜伽 40 分钟约 106 kcal，实际 ${kcal}`);
  await top().locator('[data-act="save"]').click();
  await noPanel();
  const e = (await state()).entries.find((x) => x.name === '瑜伽' && x.date === today);
  expect(e && e.kcal === kcal, '手动运动没有保存');
});

await step('首页：收支数字与记录一致', async () => {
  const s = await state();
  const shown = (await page.textContent('.kpi--in .kpi-num')).replace(/,/g, '');
  expect(Number(shown) === sum(s, 'food'), `摄入显示 ${shown}，记录合计 ${sum(s, 'food')}`);
  const out = (await page.textContent('.kpi--out .kpi-num')).replace(/,/g, '');
  expect(Number(out) === sum(s, 'exercise'), `消耗显示 ${out}，记录合计 ${sum(s, 'exercise')}`);
  await settle(900);
  await shot('09-home-filled');
});

await step('删除一条记录', async () => {
  const before = (await state()).entries.length;
  await page.locator('.entry', { hasText: '苹果' }).first().click();
  await top().locator('[data-act="delete"]').click();
  await page.locator('.panel [data-yes]').last().click();
  await noPanel();
  expect((await state()).entries.length === before - 1, '记录没有被删除');
});

await step('趋势：三张图表与范围切换', async () => {
  await page.click('.tab[data-tab="trends"]');
  await page.waitForSelector('[data-chart="weight"] svg', { timeout: 5000 });
  expect(await page.locator('.chart svg').count() === 3, '应有三张图表');
  const avg = (await page.textContent('.statgrid')).replace(/,/g, '');
  expect(!/平均摄入0/.test(avg), '平均摄入不应为 0');
  await settle(700);
  await shot('10-trends');
  await page.click('[data-range="30"]');
  await settle(300);
  expect(await page.locator('[data-chart="energy"] .hit').count() === 30, '30 天应有 30 根柱位');
  await page.locator('.cal-d:not(.is-future)').first().click();
  await page.waitForSelector('.weekstrip');
});

await step('周报：自动生成、切换周、导出长图', async () => {
  await page.click('.tab[data-tab="report"]');
  await page.waitForSelector('.report', { timeout: 5000 });
  expect(await page.locator('.hl li').count() >= 2, '亮点太少');
  const title1 = await page.textContent('.weekswitch b');
  await settle(700);
  await shot('11-report');
  await page.click('.weekswitch [data-act="prev"]');
  await settle(300);
  expect((await page.textContent('.weekswitch b')) !== title1, '切换周后标题应变化');
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('[data-act="share"]')]);
  const file = await download.path();
  const buf = fs.readFileSync(file);
  expect(buf.readUInt32BE(16) === 1080, '长图宽度应为 1080');
  fs.copyFileSync(file, path.join(SHOTS, '12-report-image.png'));
});

await step('设置：目标、体重、提醒与日历文件', async () => {
  await page.click('.tab[data-tab="me"]');
  await page.click('[data-act="goals"]');
  await top().locator('.seg [data-val="maintain"]').click();
  await top().locator('[data-save]').click();
  await noPanel();
  expect((await state()).profile.goal === 'maintain', '目标没有保存');
  await page.click('[data-act="weight"]');
  await top().locator('[name="kg"]').fill('61.8');
  await top().locator('[data-save]').click();
  await noPanel();
  expect((await state()).weights[today] === 61.8, '体重没有保存');
  await page.click('[data-act="reminders"]');
  await top().waitFor();
  expect(await top().locator('[data-reminder]').count() === 1, '默认应有一条提醒');
  await top().locator('[data-add]').click();
  expect(await top().locator('[data-reminder]').count() === 2, '添加提醒失败');
  await shot('13-reminders');
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }), top().locator('[data-cal="download"]').click()]);
  const ics = fs.readFileSync(await download.path(), 'utf8');
  expect(ics.includes('BEGIN:VCALENDAR') && (ics.match(/BEGIN:VEVENT/g) || []).length === 2 && ics.includes('VALARM'), '日历文件内容不完整');
  await top().locator('.panel-close').click();
});

await step('设置：夜间主题', async () => {
  await page.click('.tab[data-tab="me"]');
  await page.click('[data-theme="night"]');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'night');
  await page.click('.tab[data-tab="home"]');
  await settle(900);
  await shot('14-home-night');
  await page.click('.tab[data-tab="me"]');
  await page.click('[data-theme="paper"]');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'paper');
});

await step('数据：导出、清除、导入', async () => {
  await page.click('.tab[data-tab="me"]');
  const count = (await state()).entries.length;
  await page.click('[data-act="data"]');
  await top().waitFor();
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), top().locator('[data-export]').click()]);
  const backup = path.join(ROOT, '.shots/e2e/backup.json');
  await download.saveAs(backup);
  const payload = JSON.parse(fs.readFileSync(backup, 'utf8'));
  expect(payload.app === 'ranji' && payload.state.entries.length === count, '备份内容不完整');
  expect(Object.keys(payload.media || {}).length >= 2, '备份里应包含照片和截图');
  await top().locator('[data-clear]').click();
  await page.locator('.panel [data-yes]').last().click();
  await noPanel();
  expect((await state()).entries.length === 0, '清除后不应有记录');
  await page.click('.tab[data-tab="me"]');
  await page.click('[data-act="data"]');
  await top().waitFor();
  await chooseFile('.panel [data-import]', backup);
  await page.locator('.panel [data-yes]').last().click();
  await noPanel();
  const s = await state();
  expect(s.entries.length === count, `导入后记录数应为 ${count}，实际 ${s.entries.length}`);
});

await step('刷新后数据与照片仍在', async () => {
  await page.goto(server.url, { waitUntil: 'load' });
  await page.waitForSelector('.checkin');
  await page.waitForFunction(() => document.querySelectorAll('.thumb.is-photo img').length >= 2, null, { timeout: 10000 });
  expect(await page.locator('.stamp').count() === 1, '刷新后今天仍是已打卡状态');
});

await step('离线缓存已就绪', async () => {
  const ok = await page.evaluate(async () => {
    if (!navigator.serviceWorker.ready) return 'no-sw';
    const reg = await navigator.serviceWorker.ready;
    const keys = await caches.keys();
    const cache = await caches.open(keys.find((k) => k.startsWith('ranji-')));
    const hits = await Promise.all(['models/mobileclip/vision_model_fp16.onnx', 'vendor/ocr/worker.min.js', 'vendor/ocr/lang/chi_sim.traineddata.gz', 'index.html'].map((f) => cache.match(new URL(f, location.href))));
    return { active: !!reg.active, cached: hits.filter(Boolean).length, scope: reg.scope };
  });
  expect(ok.active && ok.cached === 4, `离线缓存状态异常：${JSON.stringify(ok)}`);
});

await step('首次使用：引导流程', async () => {
  const fresh = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
  const p = await fresh.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(server.url, { waitUntil: 'load' });
  await p.waitForSelector('.panel', { timeout: 8000 });
  expect((await p.textContent('.panel')).includes('身体数据'), '应先出现引导');
  await p.screenshot({ path: path.join(SHOTS, '15-onboarding.png') });
  await p.locator('.panel [data-next]').click();
  await p.locator('.panel [data-next]').click();
  await p.locator('.panel [data-finish]').click();
  await p.waitForFunction(() => !document.querySelector('.panel'));
  const st = await p.evaluate(() => JSON.parse(localStorage.getItem('ranji.v1')));
  expect(st.onboarded === true && st.profile.weightKg > 0 && st.reminders.length === 1, '引导完成后状态不完整');
  expect(await p.locator('.entry').count() === 0, '新用户首页应为空');
  await p.screenshot({ path: path.join(SHOTS, '16-home-empty.png') });
  await fresh.close();
  expect(errs.length === 0, `引导过程报错：${errs.join(' | ')}`);
});

const failedRequests = server.requests.filter((r) => r.status >= 400 && !/favicon/.test(r.url));
await browser.close();
await server.close();

console.log(`\n${failed ? `✖ ${failed} 项失败` : '✔ 全部通过'}（共 ${results.length} 项）`);
if (allErrors.length) console.log('页面错误：\n' + allErrors.join('\n'));
if (failedRequests.length) console.log('失败的请求：\n' + failedRequests.map((r) => `${r.status} ${r.url}`).join('\n'));
process.exit(failed ? 1 : 0);
