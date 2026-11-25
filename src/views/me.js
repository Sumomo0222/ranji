// 我的：身体数据与目标、体重、打卡提醒、识别引擎、外观、数据备份。
import { addReminder, exportPayload, getState, logWeight, patchReminder, removeReminder, replaceState, resetState, setProfile, setSetting } from '../core/store.js';
import { GOAL_TYPES, latestWeight, targetsOf } from '../core/calc.js';
import { buildDemoState } from '../core/demo.js';
import { fmtDot, hhmm, ymd } from '../core/dates.js';
import { buildIcs, downloadText, notificationStatus, openCalendar, requestNotificationPermission } from '../core/notify.js';
import { putMedia } from '../core/db.js';
import { dataURLToBlob } from '../core/image.js';
import { ensureOcr, ocrLoaded } from '../engine/ocr.js';
import { ensureVision, visionLoaded } from '../engine/vision.js';
import { ASSETS, ENGINE_TRANSFER, assetURL } from '../generated/assets.js';
import { isCached, mb } from '../engine/fetch.js';
import { esc, icon, n0, n1 } from '../ui/dom.js';
import { confirmSheet, openSheet, toast } from '../ui/kit.js';
import { go } from '../ui/nav.js';
import { bodyFields, goalFields, preview, readBody, readGoal, wireForm } from './profile-form.js';

const WD = ['一', '二', '三', '四', '五', '六', '日'];
const THEMES = [['paper', '纸质'], ['night', '夜间'], ['auto', '自动']];

export function mountMe(container, { animate = true } = {}) {
  let ac = new AbortController();
  let first = animate;
  const render = () => {
    ac.abort();
    ac = new AbortController();
    container.innerHTML = html(first);
    container.addEventListener('click', onClick, { signal: ac.signal });
    container.addEventListener('click', onToggle, { signal: ac.signal });
    first = false;
  };

  function html(animate) {
    const s = getState();
    const p = s.profile;
    const t = targetsOf(p);
    const latest = latestWeight(s.weights);
    const enabled = s.reminders.filter((r) => r.enabled !== false);
    const reminderText = enabled.length ? enabled.map((r) => `${r.time}${r.days.length === 7 ? '' : ` · 每周${r.days.length}天`}`).join('  ') : '未开启';
    const item = (act, ic, title, sub, val) => `<button class="list-item" data-act="${act}"><i class="list-item-ic">${icon(ic)}</i><span class="list-item-main"><b>${title}</b>${sub ? `<span>${sub}</span>` : ''}</span>${val != null ? `<span class="list-item-val">${val}</span>` : ''}${icon('chevron-right')}</button>`;
    const cls = animate ? 'rise' : '';
    return `<div class="page">
      <header class="pagehead">
        <div><h1 class="pagehead-title">我的</h1><div class="pagehead-sub">Profile & settings</div></div>
        <span class="seal" style="width:36px;height:36px;font-size:25px;border-radius:10px">燃</span>
      </header>
      <section class="sheet ${cls}" style="display:flex;align-items:center;gap:14px">
        <div style="flex:1;min-width:0">
          <div class="serif" style="font-weight:700;font-size:20px">${p.name ? `你好，${esc(p.name)}` : '做好每天的记录'}</div>
          <div class="muted" style="font-size:13px;margin-top:2px">${GOAL_TYPES[p.goal] || '维持体重'} · 每日目标 <b class="num" style="font-size:15px;color:var(--ink)">${n0(t.calories)}</b> kcal · 蛋白质 <b class="num" style="font-size:15px;color:var(--ink)">${n0(t.protein)}</b> g</div>
        </div>
        <button class="btn btn-sm btn-soft" data-act="goals">编辑</button>
      </section>
      <div class="list ${cls}">
        <div class="list-title">目标与身体</div>
        ${item('goals', 'target', '身体数据与目标', `${p.heightCm || '—'} cm · ${p.weightKg || '—'} kg · ${p.age || '—'} 岁`)}
        ${item('weight', 'scale', '记录体重', latest ? `最近 ${n1(latest.kg)} kg · ${fmtDot(latest.ymd)}` : '还没有记录', p.targetWeightKg ? `目标 ${n1(p.targetWeightKg)}` : null)}
      </div>
      <div class="list ${cls}">
        <div class="list-title">提醒</div>
        ${item('reminders', 'bell', '打卡提醒时间', enabled.length ? `${enabled.length} 条提醒` : '设置每天几点提醒你打卡', reminderText)}
      </div>
      <div class="list ${cls}">
        <div class="list-title">识别引擎</div>
        ${item('engines', 'cpu', '离线识别引擎', `食物识别 ${mb(ENGINE_TRANSFER.vision)} · 截图识别 ${mb(ENGINE_TRANSFER.ocr)}`, '管理')}
      </div>
      <div class="list ${cls}">
        <div class="list-title">偏好</div>
        <div class="list-item"><i class="list-item-ic">${icon('contrast')}</i><span class="list-item-main"><b>外观</b></span><div class="seg" role="radiogroup" aria-label="外观" style="width:196px">${THEMES.map(([v, label]) => `<button role="radio" aria-checked="${(s.settings.theme || 'paper') === v}" data-theme="${v}" class="${(s.settings.theme || 'paper') === v ? 'is-on' : ''}">${label}</button>`).join('')}</div></div>
        <div class="list-item"><i class="list-item-ic">${icon('zap')}</i><span class="list-item-main"><b>触感反馈</b><span>打卡和保存时轻微震动</span></span><button class="switch ${s.settings.haptics !== false ? 'is-on' : ''}" data-setting="haptics" role="switch" aria-checked="${s.settings.haptics !== false}" aria-label="触感反馈"></button></div>
      </div>
      <div class="list ${cls}">
        <div class="list-title">数据</div>
        ${item('data', 'database', '备份、导入与清除', '所有记录只保存在这台设备的浏览器里')}
        ${!s.entries.length ? item('demo', 'sparkles', '载入示例数据', '先看看看板、趋势和周报的样子') : ''}
      </div>
      <div class="list ${cls}">
        <div class="list-title">关于</div>
        ${item('about', 'shield-check', '隐私与开源许可', '照片与截图都在本机处理，不上传')}
      </div>
      <p class="eyebrow" style="text-align:center;margin:18px 0 4px">Ranji · keep the ledger, every day</p>
    </div>`;
  }

  function onToggle(e) {
    const sw = e.target.closest('[data-setting]');
    if (sw) {
      const on = !sw.classList.contains('is-on');
      sw.classList.toggle('is-on', on);
      sw.setAttribute('aria-checked', String(on));
      setSetting(sw.dataset.setting, on);
    }
    const theme = e.target.closest('[data-theme]');
    if (theme) {
      for (const b of container.querySelectorAll('[data-theme]')) {
        b.classList.toggle('is-on', b === theme);
        b.setAttribute('aria-checked', String(b === theme));
      }
      setSetting('theme', theme.dataset.theme);
    }
  }

  function onClick(e) {
    switch (e.target.closest('[data-act]')?.dataset.act) {
      case 'goals':
        openGoalsSheet();
        break;
      case 'weight':
        openWeightSheet(ymd());
        break;
      case 'reminders':
        openRemindersSheet();
        break;
      case 'engines':
        openEnginesSheet();
        break;
      case 'data':
        openDataSheet();
        break;
      case 'about':
        openAboutSheet();
        break;
      case 'demo':
        replaceState(buildDemoState(), 'demo');
        go('home');
        toast('已载入示例数据');
        break;
      default:
    }
  }

  render();
  return { render, unmount: () => ac.abort() };
}

// ---------- 身体数据与目标 ----------
export function openGoalsSheet() {
  const sheet = openSheet({ title: '身体数据与目标', eyebrow: 'Profile & goals', tall: true });
  sheet.setBody(`<div class="form" data-form>
    <label class="field"><span class="field-label">称呼（可不填）</span><input class="input" type="text" name="name" maxlength="12" value="${esc(getState().profile.name || '')}" placeholder="怎么称呼你" autocomplete="off"></label>
    <div class="field-label" style="margin-top:4px">身体数据</div>
    ${bodyFields(getState().profile)}
    <div class="field-label" style="margin-top:8px">目标</div>
    ${goalFields(getState().profile)}
    <p class="field-hint" data-preview></p>
  </div>`);
  sheet.setFoot(`<button class="btn btn-block" data-save>保存</button>`);
  const form = sheet.body.querySelector('[data-form]');
  const refresh = () => {
    const t = preview(form);
    sheet.body.querySelector('[data-preview]').textContent = t ? `按当前设置：每天约 ${n0(t.calories)} kcal，蛋白质 ${n0(t.protein)} g、碳水 ${n0(t.carbs)} g、脂肪 ${n0(t.fat)} g。` : '填好身高、体重和年龄后，这里会显示每日目标。';
  };
  wireForm(form, refresh);
  refresh();
  sheet.panel.querySelector('[data-save]').addEventListener('click', () => {
    const name = form.querySelector('[name="name"]').value.trim();
    const patch = { ...readBody(form), ...readGoal(form), name };
    if (!patch.weightKg || !patch.heightCm || !patch.age) {
      toast('身高、体重和年龄需要填写', { type: 'warn' });
      return;
    }
    setProfile(patch);
    sheet.close();
    toast('已保存');
  });
}

// ---------- 体重 ----------
export function openWeightSheet(day = ymd()) {
  const s = getState();
  const latest = latestWeight(s.weights);
  const history = Object.keys(s.weights).sort().slice(-6).reverse();
  const sheet = openSheet({ title: '记录体重', eyebrow: 'Body weight', body: `<div class="form">
    <div class="form-row">
      <label class="field"><span class="field-label">日期</span><input class="input" type="date" name="date" value="${day}" max="${ymd()}"></label>
      <label class="field"><span class="field-label">体重</span><span class="unit-wrap"><input class="input input-num" type="number" inputmode="decimal" name="kg" step="0.1" min="20" max="400" value="${latest?.kg ?? ''}" autofocus><em>kg</em></span></label>
    </div>
    ${s.profile.targetWeightKg ? `<p class="field-hint">目标体重 ${n1(s.profile.targetWeightKg)} kg${latest ? `，还差 ${n1(Math.abs(latest.kg - s.profile.targetWeightKg))} kg` : ''}。</p>` : `<p class="field-hint">在「身体数据与目标」里可以设置目标体重。</p>`}
    ${history.length ? `<div class="field-label" style="margin-top:6px">最近记录</div><div class="foodlist">${history.map((d) => `<div class="foodrow"><i class="foodrow-ic">${icon('scale')}</i><span class="foodrow-main"><b>${n1(s.weights[d])} kg</b><span>${fmtDot(d)}</span></span><button class="linkbtn danger" data-del="${d}" aria-label="删除">删除</button></div>`).join('')}</div>` : ''}
  </div>` });
  sheet.setFoot(`<div class="btn-row"><button class="btn btn-ghost" data-save>保存记录</button>${latest ? `<button class="btn btn-soft" data-trend>看趋势</button>` : ''}</div>`);
  sheet.panel.addEventListener('click', async (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      logWeight(del.dataset.del, 0);
      sheet.close();
      toast('已删除这条体重记录');
      return openWeightSheet(day);
    }
    const act = e.target.closest('[data-save], [data-trend]')?.dataset;
    if (!act) return;
    if (act.trend !== undefined) {
      sheet.close();
      return go('trends');
    }
    const kg = Number(sheet.body.querySelector('[name="kg"]').value);
    const date = sheet.body.querySelector('[name="date"]').value || ymd();
    if (!(kg > 20 && kg < 400)) return toast('请输入有效的体重', { type: 'warn' });
    logWeight(date, kg);
    sheet.close();
    toast(`体重 ${n1(kg)} kg 已记录`);
  });
}

// ---------- 打卡提醒 ----------
export function openRemindersSheet() {
  const sheet = openSheet({ title: '打卡提醒', eyebrow: 'Reminders', tall: true });
  const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const notifyText = () => {
    const st = notificationStatus();
    return st === 'granted' ? '系统通知：已开启' : st === 'denied' ? '系统通知：已被拒绝，可在浏览器设置里重新开启' : st === 'unsupported' ? '这个浏览器不支持系统通知，只能用应用内提醒' : st === 'ios-standalone' ? 'iPhone / iPad：先把燃记「添加到主屏幕」，再在里面点这里开启通知' : '开启系统通知（应用打开时收到）';
  };

  const render = () => {
    const s = getState();
    sheet.setBody(`<div class="form">
      <p class="field-hint">可以设置多条提醒，比如早上称重、晚上打卡。应用打开时到点会提醒你。</p>
      ${s.reminders
        .map(
          (r) => `<div class="optrow" style="align-items:flex-start" data-reminder="${r.id}">
            <button class="switch ${r.enabled !== false ? 'is-on' : ''}" data-enabled="${r.id}" role="switch" aria-checked="${r.enabled !== false}" aria-label="启用这条提醒" style="margin-top:4px"></button>
            <div class="optrow-main" style="gap:6px">
              <div style="display:flex;gap:8px;align-items:center"><input class="input input-inline input-num" style="font-size:17px;width:104px" type="time" value="${esc(r.time)}" data-time aria-label="提醒时间"><input class="input input-inline" style="flex:1;min-width:0;font-weight:600" type="text" maxlength="12" value="${esc(r.label || '')}" data-label aria-label="提醒内容"></div>
              <div class="chips" data-days>${WD.map((w, i) => `<button class="chip mini ${r.days.includes(i + 1) ? 'is-on' : ''}" data-day="${i + 1}" aria-label="周${w}">${w}</button>`).join('')}</div>
            </div>
            <button class="mealhead-add" data-del="${r.id}" aria-label="删除这条提醒" style="margin-top:4px">${icon('trash-2')}</button>
          </div>`,
        )
        .join('')}
      <button class="btn btn-ghost btn-block" data-add>${icon('plus')}添加提醒</button>

      <div class="field-label" style="margin-top:8px">提醒方式</div>
      <div class="notice">${icon('bell')}<span>网页没法在后台定时推送。想要关掉浏览器也能收到，把提醒同步到系统日历最可靠。</span></div>
      <button class="btn btn-ghost btn-block" data-notify>${notifyText()}</button>
      <div class="btn-row"><button class="btn" data-cal="open">${icon('calendar-plus')}添加到系统日历</button><button class="btn btn-ghost" data-cal="download">下载 .ics 文件</button></div>
      <p class="field-hint">${iOS ? '点「添加到系统日历」会弹出日历面板，选「添加全部」即可；没反应时下载文件后用「日历」打开。' : '会下载一个日历文件，用系统日历打开后选择导入；之后每天到点由日历提醒你。'}</p>
    </div>`);
    sheet.setFoot(null);
  };

  sheet.panel.addEventListener('click', async (e) => {
    const t = e.target;
    const en = t.closest('[data-enabled]');
    if (en) {
      const on = !en.classList.contains('is-on');
      en.classList.toggle('is-on', on);
      en.setAttribute('aria-checked', String(on));
      patchReminder(en.dataset.enabled, { enabled: on });
      return;
    }
    const day = t.closest('[data-day]');
    if (day) {
      const id = day.closest('[data-reminder]').dataset.reminder;
      const r = getState().reminders.find((x) => x.id === id);
      const d = Number(day.dataset.day);
      const days = day.classList.contains('is-on') ? r.days.filter((x) => x !== d) : [...r.days, d].sort();
      patchReminder(id, { days });
      day.classList.toggle('is-on');
      return;
    }
    const del = t.closest('[data-del]');
    if (del) {
      removeReminder(del.dataset.del);
      return render();
    }
    if (t.closest('[data-add]')) {
      addReminder({ time: hhmm(new Date(Date.now() + 3600000)), label: '打卡提醒' });
      return render();
    }
    if (t.closest('[data-notify]')) {
      const st = await requestNotificationPermission();
      render();
      toast(st === 'granted' ? '系统通知已开启' : st === 'denied' ? '没有拿到通知权限' : '这个浏览器暂时不支持系统通知', { type: st === 'granted' ? 'ok' : 'warn' });
      return;
    }
    const cal = t.closest('[data-cal]')?.dataset.cal;
    if (cal) {
      const enabled = getState().reminders.filter((r) => r.enabled !== false && r.days.length);
      if (!enabled.length) return toast('先添加并开启至少一条提醒', { type: 'warn' });
      if (cal === 'download') {
        downloadText(buildIcs(enabled), 'ranji-reminder.ics', 'text/calendar;charset=utf-8');
        toast('日历文件已下载，用日历 App 打开即可');
      } else {
        openCalendar(buildIcs(enabled), iOS ? 'open' : 'download');
        toast(iOS ? '正在打开日历，选择「添加全部」' : '日历文件已下载，用日历 App 打开即可');
      }
    }
  });
  sheet.panel.addEventListener('input', (e) => {
    const row = e.target.closest('[data-reminder]');
    if (!row) return;
    const id = row.dataset.reminder;
    if (e.target.matches('[data-time]') && /^\d{2}:\d{2}$/.test(e.target.value)) patchReminder(id, { time: e.target.value });
    if (e.target.matches('[data-label]')) patchReminder(id, { label: e.target.value.trim() || '打卡提醒' });
  });
  render();
}

// ---------- 识别引擎 ----------
export async function openEnginesSheet() {
  const sheet = openSheet({ title: '离线识别引擎', eyebrow: 'On-device engines' });
  const status = async (kind) => {
    if (kind === 'vision' ? visionLoaded() : ocrLoaded()) return '已就绪';
    if (!('caches' in window)) return '浏览器不支持离线缓存，联网时可正常使用';
    const main = kind === 'vision' ? ASSETS.visionModel.file : ASSETS.ocrCore.file;
    return (await isCached(assetURL(main))) ? '已下载，可离线使用' : '未下载';
  };
  const row = (kind, title, sub) => `<div class="optrow"><i class="list-item-ic">${icon(kind === 'vision' ? 'camera' : 'scan-line')}</i><div class="optrow-main"><b>${title}</b><span data-status="${kind}">检查中…</span></div><button class="btn btn-sm btn-soft" data-load="${kind}">预下载</button></div>`;
  sheet.setBody(`<div class="form">
    ${row('vision', '食物照片识别', `MobileCLIP · 约 ${mb(ENGINE_TRANSFER.vision)}`)}
    ${row('ocr', '运动截图识别', `Tesseract 中英文 · 约 ${mb(ENGINE_TRANSFER.ocr)}`)}
    <div class="progress" data-progress hidden><div class="progress-bar"><i></i></div><p class="progress-text"></p></div>
    <p class="field-hint">识别全部在本机完成，照片与截图不会上传。首次使用某个识别功能时会自动下载对应引擎，在这里可以提前下载，之后断网也能用。</p>
  </div>`);
  const refresh = async () => {
    sheet.body.querySelector('[data-status="vision"]').textContent = await status('vision');
    sheet.body.querySelector('[data-status="ocr"]').textContent = await status('ocr');
  };
  await refresh();
  sheet.panel.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-load]');
    if (!btn) return;
    const kind = btn.dataset.load;
    btn.disabled = true;
    const box = sheet.body.querySelector('[data-progress]');
    const bar = box.querySelector('i');
    const text = box.querySelector('.progress-text');
    box.hidden = false;
    const onProgress = (p) => {
      const indet = !(p.ratio > 0);
      bar.classList.toggle('indet', indet);
      bar.style.width = indet ? '' : `${Math.round(p.ratio * 100)}%`;
      text.textContent = p.text || p.stage;
    };
    try {
      if (kind === 'vision') await ensureVision(onProgress);
      else await ensureOcr(onProgress);
      toast('引擎已下载，可离线使用');
    } catch (err) {
      toast(`下载失败：${err?.message || '未知错误'}`, { type: 'warn', duration: 5000 });
    }
    box.hidden = true;
    btn.disabled = false;
    await refresh();
  });
}

// ---------- 数据 ----------
export function openDataSheet() {
  const sheet = openSheet({ title: '备份、导入与清除', eyebrow: 'Your data' });
  sheet.setBody(`<div class="form">
    <p class="field-hint">饮食、运动、打卡和体重记录都保存在这台设备的浏览器里。换设备或清理浏览器数据前，先导出一份备份。</p>
    <div class="optrow"><i class="list-item-ic">${icon('download')}</i><div class="optrow-main"><b>导出备份</b><span>包含全部记录、设置和照片，一个 JSON 文件</span></div></div>
    <div class="optrow"><i class="list-item-ic">${icon('upload')}</i><div class="optrow-main"><b>导入备份</b><span>会用备份内容替换当前的全部数据</span></div></div>
    <div class="optrow"><i class="list-item-ic">${icon('weight')}</i><div class="optrow-main"><b>存储占用</b><span data-usage>计算中…</span></div></div>
    <div class="optrow" style="border-bottom:0"><i class="list-item-ic" style="color:var(--cinnabar-text);background:var(--cinnabar-soft)">${icon('trash-2')}</i><div class="optrow-main"><b class="danger">清除全部数据</b><span>删除所有记录、设置和照片，无法恢复</span></div></div>
  </div>`);
  sheet.setFoot(`<div class="btn-row"><button class="btn btn-ghost" data-import>导入备份</button><button class="btn" data-export>导出备份</button></div><button class="btn btn-ghost danger" data-clear style="color:var(--cinnabar-text);box-shadow:inset 0 0 0 1px var(--cinnabar-soft)">清除全部数据</button>`);

  navigator.storage?.estimate?.().then(({ usage = 0, quota = 0 }) => {
    const el = sheet.body.querySelector('[data-usage]');
    if (!el) return;
    el.textContent = `已用约 ${(usage / 1048576).toFixed(1)} MB${quota ? ` · 可用约 ${(quota / 1073741824).toFixed(1)} GB` : ''}`;
  });

  async function exportAll() {
    const payload = exportPayload();
    const media = {};
    const ids = [...new Set(payload.state.entries.map((e) => e.photoId || e.shotId).filter(Boolean))];
    const { getMedia } = await import('../core/db.js');
    const { blobToDataURL } = await import('../core/image.js');
    for (const id of ids) {
      const full = await getMedia(id, 'full');
      const thumb = await getMedia(id, 'thumb');
      if (full) media[id] = { full: await blobToDataURL(full), thumb: thumb ? await blobToDataURL(thumb) : null };
    }
    payload.media = media;
    downloadText(JSON.stringify(payload), `ranji-backup-${ymd()}.json`, 'application/json');
    toast(`备份已导出（${payload.state.entries.length} 条记录）`);
  }

  async function importAll(file) {
    let payload;
    try {
      payload = JSON.parse(await file.text());
    } catch (err) {
      return toast('这个文件不是有效的备份', { type: 'warn' });
    }
    if (payload?.app !== 'ranji' || !Array.isArray(payload.state?.entries)) return toast('这不是燃记的备份文件', { type: 'warn' });
    if (!(await confirmSheet({ title: '导入备份', message: `将用备份里的 ${payload.state.entries.length} 条记录替换当前的全部数据，确定继续吗？`, confirmLabel: '导入' }))) return;
    for (const [id, m] of Object.entries(payload.media || {})) {
      try {
        await putMedia({ id, full: dataURLToBlob(m.full), thumb: m.thumb ? dataURLToBlob(m.thumb) : dataURLToBlob(m.full) });
      } catch (err) {
        console.warn('照片恢复失败', id, err);
      }
    }
    replaceState(payload.state, 'import');
    sheet.close();
    go('home');
    toast('备份已导入');
  }

  sheet.panel.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-export], [data-import], [data-clear]')?.dataset;
    if (!act) return;
    if ('export' in act) return exportAll();
    if ('import' in act) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json,.json';
      input.addEventListener('change', () => input.files?.[0] && importAll(input.files[0]));
      input.click();
      return;
    }
    if ('clear' in act && (await confirmSheet({ title: '清除全部数据', message: '所有饮食、运动、打卡、体重记录和照片都会被删除，且无法恢复。', confirmLabel: '全部清除', danger: true }))) {
      const { clearMedia } = await import('../core/db.js');
      await clearMedia();
      resetState();
      sheet.close();
      go('home');
      toast('已清除全部数据');
    }
  });
}

// ---------- 关于 ----------
function openAboutSheet() {
  openSheet({
    title: '隐私与开源许可',
    eyebrow: 'About',
    body: `<div class="form">
      <p style="font-size:14px;line-height:1.7;color:var(--ink-2)">燃记是纯静态网页，没有服务器。你的饮食、运动、打卡、体重和照片都只保存在这台设备的浏览器里；食物识别和截图文字识别都在本机完成，照片与截图不会上传到任何地方。</p>
      <p style="font-size:14px;line-height:1.7;color:var(--ink-2)">热量与营养是估算值：食物按每 100 g 的参考数据计算，运动按 MET 与体重估算，建议结合实际情况修正。</p>
      <div class="field-label">用到的开源组件</div>
      <ul style="font-size:13px;line-height:1.9;color:var(--ink-2);padding-left:16px;list-style:disc">
        <li>MobileCLIP（Apple）— 食物照片识别模型</li>
        <li>ONNX Runtime Web（Microsoft，MIT）— 浏览器内模型推理</li>
        <li>Tesseract.js（Apache-2.0）— 截图文字识别</li>
        <li>Lucide（ISC）— 界面图标</li>
        <li>Oswald、Newsreader（SIL OFL 1.1）— 字体</li>
      </ul>
    </div>`,
  });
}

