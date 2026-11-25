// 记运动：上传截图识别 / 手动记录，以及编辑已有记录。
import { addEntry, entryById, getState, patchEntry, removeEntry, uid } from '../core/store.js';
import { hhmm, ymd } from '../core/dates.js';
import { EX_BY_ID, EXERCISES, exerciseKcal } from '../data/exercises.js';
import { compressPhoto } from '../core/image.js';
import { deleteMedia, mediaURL, putMedia } from '../core/db.js';
import { readScreenshot } from '../engine/ocr.js';
import { ENGINE_TRANSFER } from '../generated/assets.js';
import { mb } from '../engine/fetch.js';
import { esc, icon, n0, n1 } from '../ui/dom.js';
import { confirmSheet, openSheet, pickImage, showImage, toast, wireSteppers } from '../ui/kit.js';

const shortName = (ex) => (ex.label.length > 4 ? ex.label.split(/\s*[/·]\s*/)[0] : ex.label);
const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));

function progressText(p) {
  if (p.stage === 'load') return `首次使用需要下载约 ${mb(ENGINE_TRANSFER.ocr)} 的文字识别引擎，之后可离线使用`;
  if (p.stage === 'ocr') return `${p.text}…`;
  return '准备中…';
}

export function openAddExercise({ date = ymd(), entryId = null, start } = {}) {
  const editing = entryId ? entryById(entryId) : null;
  const draft = editing
    ? {
        date: editing.date,
        time: editing.time || hhmm(),
        exId: editing.exId || 'other',
        minutes: editing.minutes || 0,
        distanceKm: editing.distanceKm ?? '',
        steps: editing.steps ?? '',
        kcal: editing.kcal || 0,
        shot: null,
        shotId: editing.shotId || null,
        source: editing.source || 'manual',
        manual: true,
      }
    : { date, time: hhmm(), exId: 'run', minutes: 30, distanceKm: '', steps: '', kcal: 0, shot: null, shotId: null, source: 'manual', manual: false };
  let ocrResult = null;
  let previewUrl = null;
  let busy = false;

  const sheet = openSheet({
    title: editing ? '编辑运动' : '记运动',
    eyebrow: 'Workout',
    tall: true,
    onClose: () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
  });
  const ex = () => EX_BY_ID[draft.exId] || EX_BY_ID.other;

  function showChoose() {
    sheet.setBody(`<div class="tiles">
      <button class="tile" data-act="shot"><span class="tile-ic pine">${icon('scan-line')}</span><span class="tile-main"><b>上传运动截图</b><span>在设备上读出时长、距离和消耗，截图不会上传</span></span>${icon('chevron-right')}</button>
      <button class="tile" data-act="manual"><span class="tile-ic pine">${icon('dumbbell')}</span><span class="tile-main"><b>手动记录</b><span>选运动类型、填时长，自动估算消耗</span></span>${icon('chevron-right')}</button>
    </div>`);
    sheet.setFoot(null);
  }

  function setProgress(p) {
    const box = sheet.body.querySelector('[data-progress]');
    if (!box) return;
    const bar = box.querySelector('i');
    const indet = !p || !(p.ratio > 0);
    bar.classList.toggle('indet', indet);
    bar.style.width = indet ? '' : `${Math.round(p.ratio * 100)}%`;
    box.querySelector('.progress-text').textContent = p ? progressText(p) : '';
  }

  const shotHtml = () => (previewUrl ? `<div class="photo is-screenshot"><img alt="运动截图" src="${previewUrl}"></div>` : draft.shotId ? `<div class="photo is-screenshot" data-existing-shot></div>` : '');

  async function onShot(file) {
    if (busy) return;
    busy = true;
    try {
      const { full, thumb } = await compressPhoto(file, { fullMax: 1700, thumbMax: 520 });
      draft.shot = { full, thumb };
      draft.shotId = null;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(thumb);
      sheet.setBody(`${shotHtml()}<div class="progress" data-progress><div class="progress-bar"><i></i></div><p class="progress-text"></p></div>`);
      sheet.setFoot(null);
      setProgress(null);
      ocrResult = await readScreenshot(full, setProgress);
      showOcrResult();
    } catch (err) {
      console.warn('截图识别失败', err);
      sheet.setBody(`${shotHtml()}<div class="notice" style="margin-top:12px">${icon('info')}<span>识别没能完成：${esc(err?.message || '未知错误')}。多半是网络问题，可以稍后再试，或者带着截图手动填写。</span></div><div class="btn-row" style="margin-top:12px"><button class="btn btn-ghost" data-act="shot">换一张</button></div>`);
      sheet.setFoot(`<button class="btn btn-block" data-act="manual">带截图手动填写</button>`);
    } finally {
      busy = false;
    }
  }

  function showOcrResult() {
    const r = ocrResult;
    const cell = (label, value, unit, low, iconName) => `<div><span>${icon(iconName)}${label}${low ? '<i class="tag" title="推测值" style="background:var(--cinnabar-soft);color:var(--cinnabar-text)">?</i>' : ''}</span><b>${value == null ? '—' : value}${unit ? `<small>${unit}</small>` : ''}</b></div>`;
    const found = r.type || r.kcal || r.minutes || r.distanceKm || r.steps;
    if (!found) {
      sheet.setBody(`${shotHtml()}<div class="notice" style="margin-top:12px">${icon('info')}<span>没有从这张截图里读出运动数据。可以换一张，或者带着截图手动填写。</span></div><div class="btn-row" style="margin-top:12px"><button class="btn btn-ghost" data-act="shot">换一张</button></div>`);
      sheet.setFoot(`<button class="btn btn-block" data-act="manual">带截图手动填写</button>`);
      return;
    }
    const lowAll = r.guesses.length > 0 && !r.kcal?.why?.includes('label') && !r.kcal?.why?.includes('unit');
    sheet.setBody(`${shotHtml()}
      <div class="detected" style="margin-top:12px">
        ${cell('运动类型', r.typeName || '待选择', '', !r.type, 'activity')}
        ${cell('时长', r.minutes ? Math.round(r.minutes.value) : null, '分钟', r.minutes?.low, 'timer')}
        ${cell('距离', r.distanceKm ? n1(r.distanceKm.value) : null, 'km', r.distanceKm?.low, 'ruler')}
        ${cell('消耗', r.kcal ? n0(r.kcal.value) : null, 'kcal', r.kcal?.low, 'flame')}
        ${r.steps ? cell('步数', n0(r.steps.value), '步', r.steps.low, 'footprints') : ''}
      </div>
      <p class="field-hint" style="margin-top:10px">以上数据读自截图${lowAll ? '，带 ? 的是推测值' : ''}，下一步可以修改。</p>
      <details style="margin-top:10px"><summary class="field-hint" style="cursor:pointer">查看识别到的文字</summary><pre class="field-hint" style="white-space:pre-wrap;margin-top:6px;line-height:1.5">${esc(r.text || '')}</pre></details>
      <div class="btn-row" style="margin-top:12px"><button class="btn btn-ghost" data-act="shot">换一张</button><button class="btn" data-act="apply">使用这些数据</button></div>`);
    sheet.setFoot(null);
  }

  function applyOcr() {
    const r = ocrResult;
    if (r.type) draft.exId = r.type;
    draft.minutes = r.minutes ? Math.max(1, Math.round(r.minutes.value)) : 0;
    draft.distanceKm = r.distanceKm ? r.distanceKm.value : '';
    draft.steps = r.steps ? r.steps.value : '';
    draft.kcal = r.kcal ? r.kcal.value : 0;
    draft.manual = !!r.kcal;
    draft.source = 'ocr';
    showForm();
  }

  // ---------- 表单 ----------
  function autoKcal() {
    if (draft.manual) return;
    draft.kcal = exerciseKcal(ex().met, draft.minutes, getState().profile.weightKg);
  }

  function formHtml() {
    return `<div class="form">
      ${shotHtml()}
      ${previewUrl || draft.shotId ? `<div class="btn-row"><button class="btn btn-ghost btn-sm" data-act="shot">换一张</button><button class="btn btn-ghost btn-sm" data-act="remove-shot">移除截图</button></div>` : ''}
      <div class="field"><span class="field-label">运动类型</span><div class="exgrid">${EXERCISES.map((x) => `<button class="exopt ${x.id === draft.exId ? 'is-on' : ''}" data-ex="${x.id}">${icon(x.icon)}<span>${esc(shortName(x))}</span></button>`).join('')}</div></div>
      <div class="form-row">
        <div class="field"><span class="field-label">时长</span>
          <div class="stepper" data-stepper data-min="0" data-max="1440" data-step="5" data-dec="0"><button type="button" data-delta="-1" aria-label="减少">${icon('minus')}</button><div class="unit-wrap" style="display:flex;flex:1"><input class="input input-num" type="number" inputmode="numeric" name="minutes" value="${draft.minutes}" min="0" max="1440"><em>分钟</em></div><button type="button" data-delta="1" aria-label="增加">${icon('plus')}</button></div>
        </div>
        <label class="field"><span class="field-label">距离（选填）</span><span class="unit-wrap"><input class="input input-num" type="number" inputmode="decimal" name="distanceKm" value="${draft.distanceKm}" min="0" max="1000" step="0.01"><em>km</em></span></label>
      </div>
      <div class="form-row">
        <label class="field"><span class="field-label">消耗${draft.manual && draft.source === 'ocr' ? '<span class="tag fixed" style="margin-left:6px">已手动修正</span>' : ''}</span><span class="unit-wrap"><input class="input input-num" type="number" inputmode="numeric" name="kcal" value="${draft.kcal}" min="0" max="20000"><em>kcal</em></span>${draft.manual ? `<button class="linkbtn" data-act="recalc" style="justify-self:start;padding-left:0">按类型和时长重算</button>` : `<span class="field-hint">按「${esc(ex().label)}」的强度（MET ${ex().met}）和体重估算</span>`}</label>
        <label class="field"><span class="field-label">步数（选填）</span><input class="input input-num" type="number" inputmode="numeric" name="steps" value="${draft.steps}" min="0" max="300000"></label>
      </div>
      <div class="form-row">
        <label class="field"><span class="field-label">日期</span><input class="input" type="date" name="date" value="${draft.date}" max="${ymd()}"></label>
        <label class="field"><span class="field-label">时间</span><input class="input" type="time" name="time" value="${draft.time}"></label>
      </div>
    </div>`;
  }

  function showForm() {
    autoKcal();
    sheet.setBody(formHtml());
    sheet.setFoot(`<div class="${editing ? 'btn-row' : ''}">${editing ? `<button class="btn btn-ghost danger" data-act="delete">删除</button>` : ''}<button class="btn" data-act="save">${editing ? '保存修改' : '加入记录'}</button></div>`);
    wireSteppers(sheet.body);
    hydrateExistingShot();
    sheet.body.oninput = (e) => {
      const { name, value } = e.target;
      if (name === 'minutes') draft.minutes = Math.max(0, Number(value) || 0);
      else if (name === 'distanceKm') draft.distanceKm = value;
      else if (name === 'steps') draft.steps = value;
      else if (name === 'date' || name === 'time') draft[name] = value;
      else if (name === 'kcal') {
        // 第一次手动改消耗后，表单切换为「已手动修正」状态并保留输入焦点
        const first = !draft.manual;
        draft.kcal = Math.max(0, Number(value) || 0);
        draft.manual = true;
        if (first) {
          showForm();
          const input = sheet.body.querySelector('[name="kcal"]');
          input?.focus();
          input?.setSelectionRange(value.length, value.length);
        }
        return;
      }
      if (!draft.manual && name !== 'kcal') {
        autoKcal();
        sheet.body.querySelector('[name="kcal"]').value = draft.kcal;
      }
    };
  }

  async function hydrateExistingShot() {
    if (!draft.shotId || previewUrl) return;
    const box = sheet.body.querySelector('[data-existing-shot]');
    if (!box) return;
    const url = await mediaURL(draft.shotId, 'thumb');
    if (url && box.isConnected) box.innerHTML = `<img alt="运动截图" src="${url}">`;
  }

  async function save() {
    if (busy) return;
    if (!draft.minutes && !draft.kcal) {
      toast('填一下时长或消耗', { type: 'warn' });
      return;
    }
    busy = true;
    try {
      let shotId = draft.shotId || null;
      if (draft.shot) {
        shotId = uid();
        await putMedia({ id: shotId, full: draft.shot.full, thumb: draft.shot.thumb });
      } else if (editing?.shotId && !shotId) await deleteMedia(editing.shotId);
      const entry = {
        type: 'exercise',
        date: draft.date,
        time: draft.time || hhmm(),
        exId: draft.exId,
        name: ex().label,
        met: ex().met,
        minutes: Math.round(draft.minutes) || 0,
        distanceKm: num(draft.distanceKm),
        steps: num(draft.steps),
        kcal: Math.round(draft.kcal) || 0,
        shotId,
        source: draft.source || 'manual',
        corrected: !!(draft.manual && draft.source === 'ocr'),
      };
      if (editing) patchEntry(editing.id, entry);
      else addEntry(entry);
      sheet.close();
      toast(`${entry.name} · 消耗 ${n0(entry.kcal)} kcal 已记录`);
    } catch (err) {
      console.error(err);
      toast('保存失败，请重试', { type: 'warn' });
    } finally {
      busy = false;
    }
  }

  sheet.panel.addEventListener('click', async (e) => {
    const exBtn = e.target.closest('[data-ex]');
    if (exBtn) {
      draft.exId = exBtn.dataset.ex;
      for (const b of sheet.body.querySelectorAll('[data-ex]')) b.classList.toggle('is-on', b === exBtn);
      if (!draft.manual) {
        autoKcal();
        const kcal = sheet.body.querySelector('[name="kcal"]');
        if (kcal) kcal.value = draft.kcal;
        const hint = sheet.body.querySelector('.field-hint');
        if (hint && hint.textContent.startsWith('按「')) hint.textContent = `按「${ex().label}」的强度（MET ${ex().met}）和体重估算`;
      }
      return;
    }
    switch (e.target.closest('[data-act]')?.dataset.act) {
      case 'shot': {
        const file = await pickImage();
        if (file) onShot(file);
        break;
      }
      case 'manual':
        showForm();
        break;
      case 'apply':
        applyOcr();
        break;
      case 'recalc':
        draft.manual = false;
        showForm();
        break;
      case 'remove-shot':
        draft.shot = null;
        draft.shotId = null;
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = null;
        showForm();
        break;
      case 'save':
        await save();
        break;
      case 'delete': {
        if (!(await confirmSheet({ title: '删除这条记录', message: `「${editing.name}」会从 ${editing.date} 的记录里移除。`, confirmLabel: '删除', danger: true }))) return;
        removeEntry(editing.id);
        if (editing.shotId) await deleteMedia(editing.shotId);
        sheet.close();
        toast('已删除');
        break;
      }
      default:
    }
  });
  sheet.body.addEventListener('click', (e) => {
    if (e.target.closest('.photo img') && draft.shot) showImage(URL.createObjectURL(draft.shot.full));
  });

  if (editing) showForm();
  else if (start === 'shot') pickImage().then((file) => (file ? onShot(file) : sheet.close()));
  else if (start === 'manual') showForm();
  else showChoose();
}
