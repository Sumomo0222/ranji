// 记饮食：拍照估算 / 食物库选择 / 手动填写，以及编辑已有记录。
import { addEntry, entryById, patchEntry, removeEntry, uid } from '../core/store.js';
import { hhmm, ymd } from '../core/dates.js';
import { FOODS, FOOD_BY_ID, FOOD_CATS, MEALS, mealByTime } from '../data/foods.js';
import { compressPhoto } from '../core/image.js';
import { deleteMedia, mediaURL, putMedia } from '../core/db.js';
import { recognizeFood } from '../engine/vision.js';
import { ENGINE_TRANSFER } from '../generated/assets.js';
import { mb } from '../engine/fetch.js';
import { esc, icon, n0 } from '../ui/dom.js';
import { confirmSheet, openSheet, pickImage, showImage, toast, wireSteppers } from '../ui/kit.js';

const CAT_ICONS = { staple: 'wheat', dish: 'utensils', soup: 'soup', fruit: 'apple', drink: 'cup-soda', snack: 'candy' };

function portionText(units, unit) {
  return units === 0.5 ? `半${unit}` : `${units}${unit}`;
}

function mealFor(date) {
  return date === ymd() ? mealByTime(new Date()) : 'lunch';
}

/** 识别引擎各阶段的提示文字 */
function progressText(p) {
  if (p.stage === 'runtime') return `首次使用需要下载约 ${mb(ENGINE_TRANSFER.vision)} 的识别引擎，之后可离线使用`;
  if (p.stage === 'model') return `正在下载食物识别模型 ${Math.round(p.ratio * 100)}%`;
  if (p.stage === 'init') return '正在初始化识别引擎';
  if (p.stage === 'run') return '正在识别照片里的食物…';
  return '准备中…';
}

const macroField = (name, label, value) => `<label class="field"><span class="field-label">${label}</span><span class="unit-wrap"><input class="input input-num" type="number" inputmode="decimal" name="${name}" value="${value}" min="0" max="2000" step="0.1"><em>g</em></span></label>`;

const searchFood = (f, q) => !q || f.zh.toLowerCase().includes(q) || f.en.includes(q) || f.alt.some((a) => a.toLowerCase().includes(q));

export function openAddFood({ date = ymd(), meal, entryId = null, start } = {}) {
  const editing = entryId ? entryById(entryId) : null;
  const draft = editing
    ? {
        date: editing.date,
        time: editing.time || hhmm(),
        meal: editing.meal || 'lunch',
        name: editing.name,
        foodId: editing.foodId || null,
        units: editing.foodId && editing.grams ? Math.round((editing.grams / FOOD_BY_ID[editing.foodId].unitG) * 2) / 2 : 0,
        grams: editing.grams || 0,
        kcal: editing.kcal || 0,
        protein: editing.protein || 0,
        carbs: editing.carbs || 0,
        fat: editing.fat || 0,
        photo: null,
        photoId: editing.photoId || null,
        ai: editing.ai || null,
        source: editing.source || 'manual',
        manual: !editing.foodId || !!editing.corrected,
      }
    : { date, time: hhmm(), meal: meal || mealFor(date), name: '', foodId: null, units: 0, grams: 0, kcal: 0, protein: 0, carbs: 0, fat: 0, photo: null, photoId: null, ai: null, source: 'manual', manual: false };
  let result = null;
  let libraryQuery = '';
  let libraryCat = 'all';
  let previewUrl = null;
  let busy = false;

  const sheet = openSheet({
    title: editing ? '编辑饮食' : '记饮食',
    eyebrow: 'Meal',
    tall: true,
    onClose: () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
  });
  const food = () => (draft.foodId ? FOOD_BY_ID[draft.foodId] : null);

  // ---------- 选择来源 ----------
  function showChoose() {
    sheet.setBody(`<div class="tiles">
      <button class="tile" data-act="photo"><span class="tile-ic amber">${icon('camera')}</span><span class="tile-main"><b>拍照估算</b><span>在设备上识别食物，照片不会上传</span></span>${icon('chevron-right')}</button>
      <button class="tile" data-act="library"><span class="tile-ic amber">${icon('utensils')}</span><span class="tile-main"><b>从食物库选择</b><span>按常见份量给出热量与营养</span></span>${icon('chevron-right')}</button>
      <button class="tile" data-act="manual"><span class="tile-ic amber">${icon('pencil')}</span><span class="tile-main"><b>手动填写</b><span>自己输入热量和营养素</span></span>${icon('chevron-right')}</button>
    </div>${previewUrl ? `<p class="field-hint" style="margin-top:12px">已经选好照片，可以直接带着它手动填写。</p>` : ''}`);
    sheet.setFoot(previewUrl ? `<button class="btn btn-block" data-act="manual">带照片手动填写</button>` : null);
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

  function photoStage(inner, foot = null) {
    sheet.setBody(`${previewUrl ? `<div class="photo"><img alt="食物照片" src="${previewUrl}"></div>` : ''}${inner}`);
    sheet.setFoot(foot);
  }

  // ---------- 拍照识别 ----------
  async function onPhoto(file) {
    if (busy) return;
    busy = true;
    try {
      const { full, thumb } = await compressPhoto(file);
      draft.photo = { full, thumb };
      draft.photoId = null;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(thumb);
      photoStage(`<div class="progress" data-progress><div class="progress-bar"><i></i></div><p class="progress-text"></p></div>`);
      setProgress(null);
      result = await recognizeFood(full, setProgress);
      if (result.isFood) showCandidates();
      else photoFallback('这张照片里没有认出可以估算的食物。可以换一张，或者从食物库里选。');
    } catch (err) {
      console.warn('识别失败', err);
      photoFallback(`识别没能完成：${err?.message || '未知错误'}。多半是网络问题，可以稍后再试，或者先从食物库选择。`);
    } finally {
      busy = false;
    }
  }

  function photoFallback(message) {
    photoStage(
      `<div class="notice" style="margin-top:12px">${icon('info')}<span>${esc(message)}</span></div>
      <div class="btn-row" style="margin-top:12px"><button class="btn btn-ghost" data-act="photo">换一张</button><button class="btn btn-ghost" data-act="library">食物库</button></div>`,
      `<button class="btn btn-block" data-act="manual">带照片手动填写</button>`,
    );
  }

  function showCandidates() {
    photoStage(`
      <div style="display:flex;align-items:baseline;justify-content:space-between;margin-top:12px"><span class="field-label">${result.confident ? '看起来是' : '不太确定，选一个最接近的'}</span><span class="eyebrow">top ${result.top.length}</span></div>
      <div class="cands" style="margin-top:8px">
        ${result.top
          .map((c) => {
            const f = FOOD_BY_ID[c.id];
            return `<button class="cand" data-pick="${c.id}"><span class="cand-name">${esc(c.zh)}</span><span class="cand-kcal num">${n0((f.kcal * f.defG) / 100)}<small> kcal / ${portionText(f.defUnits, f.unit)}</small></span><i class="cand-meter"><i style="width:${Math.round(c.p * 100)}%"></i></i></button>`;
          })
          .join('')}
      </div>
      <p class="field-hint" style="margin-top:10px">份量按常见的一份估算，下一步可以调整，也可以直接修正热量。</p>
      <div class="btn-row" style="margin-top:12px"><button class="btn btn-ghost" data-act="library">食物库里选</button><button class="btn btn-ghost" data-act="manual">手动填写</button></div>`);
  }

  function pickFood(id) {
    const f = FOOD_BY_ID[id];
    const c = result?.top.find((x) => x.id === id);
    draft.foodId = id;
    draft.name = f.zh;
    draft.units = f.defUnits;
    draft.grams = f.defG;
    // 从识别候选里选的记为「照片识别」，从食物库选的记为「食物库」（照片仍然保留）
    if (c) draft.ai = { label: f.zh, p: c.p, cos: c.cos };
    draft.source = c ? 'photo' : 'library';
    draft.manual = false;
    recompute();
    showForm();
  }

  // ---------- 食物库 ----------
  const foodRow = (f) => `<button class="foodrow" data-pick="${f.id}"><i class="foodrow-ic">${icon(CAT_ICONS[f.cat])}</i><span class="foodrow-main"><b>${esc(f.zh)}</b><span>${FOOD_CATS[f.cat]} · 1${f.unit} 约 ${f.unitG} g</span></span><span class="foodrow-kcal num">${n0((f.kcal * f.unitG) / 100)}<small> kcal / ${f.unit}</small></span></button>`;

  function libraryList() {
    const q = libraryQuery.trim().toLowerCase();
    const list = FOODS.filter((f) => (libraryCat === 'all' || f.cat === libraryCat) && searchFood(f, q)).slice(0, 80);
    return list.length ? list.map(foodRow).join('') : `<p class="empty">没有找到「${esc(libraryQuery)}」</p><button class="btn btn-ghost btn-block" data-act="manual" style="margin-bottom:8px">手动填写这一项</button>`;
  }

  function showLibrary() {
    sheet.setBody(`<div class="form">
      <label class="search">${icon('search')}<input class="input" type="search" name="q" placeholder="搜索食物，如 鸡胸、拉面、pizza" value="${esc(libraryQuery)}" autocomplete="off"></label>
      <div class="chips">${[['all', '全部'], ...Object.entries(FOOD_CATS)].map(([v, label]) => `<button class="chip ${libraryCat === v ? 'is-on' : ''}" data-cat="${v}">${label}</button>`).join('')}</div>
      <div class="foodlist">${libraryList()}</div>
    </div>`);
    sheet.setFoot(null);
    const input = sheet.body.querySelector('[name="q"]');
    input.addEventListener('input', () => {
      libraryQuery = input.value;
      sheet.body.querySelector('.foodlist').innerHTML = libraryList();
    });
    input.focus();
  }

  // ---------- 表单 ----------
  function recompute() {
    const f = food();
    if (!f || draft.manual) return;
    const k = (draft.grams || 0) / 100;
    draft.kcal = Math.round(f.kcal * k);
    draft.protein = Math.round(f.p * k * 10) / 10;
    draft.carbs = Math.round(f.c * k * 10) / 10;
    draft.fat = Math.round(f.f * k * 10) / 10;
  }

  const hasPhoto = () => !!(previewUrl || draft.photoId);

  function formHtml() {
    const f = food();
    const fromPhoto = draft.source === 'photo';
    return `<div class="form">
      ${previewUrl ? `<div class="photo" style="max-height:30dvh"><img alt="食物照片" src="${previewUrl}"></div>` : draft.photoId ? `<div class="photo" style="max-height:30dvh" data-existing-photo></div>` : ''}
      ${hasPhoto() ? `<div class="btn-row"><button class="btn btn-ghost btn-sm" data-act="photo">换照片</button><button class="btn btn-ghost btn-sm" data-act="remove-photo">移除照片</button></div>` : ''}
      <label class="field"><span class="field-label">食物</span><input class="input" type="text" name="name" maxlength="24" placeholder="吃了什么" value="${esc(draft.name)}" autocomplete="off"></label>
      <div class="field"><span class="field-label">份量${f ? ` <span class="muted">（1${f.unit} 约 ${f.unitG} g）</span>` : ''}</span>
        <div class="stepper" data-stepper data-min="0" data-max="5000" data-step="${f ? Math.max(5, Math.round(f.unitG / 10)) : 10}" data-dec="0">
          <button type="button" data-delta="-1" aria-label="减少">${icon('minus')}</button>
          <div class="unit-wrap" style="display:flex;flex:1"><input class="input input-num" type="number" inputmode="numeric" name="grams" value="${draft.grams}" min="0" max="5000"><em>g</em></div>
          <button type="button" data-delta="1" aria-label="增加">${icon('plus')}</button>
        </div>
        ${f ? `<div class="chips" style="margin-top:8px">${[0.5, 1, 1.5, 2].map((u) => `<button class="chip ${draft.units === u ? 'is-on' : ''}" data-units="${u}">${portionText(u, f.unit)}</button>`).join('')}</div>` : ''}
      </div>
      <div class="field"><span class="field-label">热量${draft.manual && fromPhoto ? '<span class="tag fixed" style="margin-left:6px">已手动修正</span>' : ''}</span>
        <span class="unit-wrap"><input class="input input-num" type="number" inputmode="numeric" name="kcal" value="${draft.kcal}" min="0" max="20000"><em>kcal</em></span>
        ${draft.manual && f ? `<button class="linkbtn" data-act="recalc" style="justify-self:start;padding-left:0">按食物数据重算</button>` : ''}
      </div>
      <div class="form-row-3">${macroField('protein', '蛋白质', draft.protein)}${macroField('carbs', '碳水', draft.carbs)}${macroField('fat', '脂肪', draft.fat)}</div>
      <div class="field"><span class="field-label">餐次</span><div class="seg" role="radiogroup" aria-label="餐次">${MEALS.map((m) => `<button type="button" data-val="${m.id}" class="${draft.meal === m.id ? 'is-on' : ''}">${m.label}</button>`).join('')}</div></div>
      <div class="form-row">
        <label class="field"><span class="field-label">日期</span><input class="input" type="date" name="date" value="${draft.date}" max="${ymd()}"></label>
        <label class="field"><span class="field-label">时间</span><input class="input" type="time" name="time" value="${draft.time}"></label>
      </div>
      <p class="field-hint">${fromPhoto ? `${draft.manual ? '数值已按你的修改保存。' : `识别自照片，匹配度 ${Math.round((draft.ai?.p || 0) * 100)}%，数值为估算。`}` : f ? `按「${esc(f.zh)}」每 100 g ${n0(f.kcal)} kcal 估算。` : '数值由你填写，按原样保存。'}</p>
    </div>`;
  }

  function syncNumbers() {
    for (const k of ['kcal', 'protein', 'carbs', 'fat']) {
      const input = sheet.body.querySelector(`[name="${k}"]`);
      if (input && document.activeElement !== input) input.value = draft[k];
    }
    for (const b of sheet.body.querySelectorAll('[data-units]')) b.classList.toggle('is-on', Number(b.dataset.units) === draft.units);
  }

  function showForm() {
    sheet.setBody(formHtml());
    sheet.setFoot(`<div class="${editing ? 'btn-row' : ''}">${editing ? `<button class="btn btn-ghost danger" data-act="delete">删除</button>` : ''}<button class="btn" data-act="save">${editing ? '保存修改' : '加入记录'}</button></div>`);
    wireSteppers(sheet.body);
    hydrateExistingPhoto();
    sheet.body.oninput = (e) => {
      const { name, value } = e.target;
      if (!name) return;
      if (name === 'grams') {
        draft.grams = Math.max(0, Number(value) || 0);
        const f = food();
        if (f) draft.units = f.unitG ? Math.round((draft.grams / f.unitG) * 2) / 2 : 0;
        recompute();
        syncNumbers();
      } else if (name === 'kcal' || name === 'protein' || name === 'carbs' || name === 'fat') {
        draft[name] = Math.max(0, Number(value) || 0);
        if (!draft.manual) {
          draft.manual = true;
          showForm();
          sheet.body.querySelector(`[name="${name}"]`)?.focus();
        }
      } else if (name === 'name') draft.name = value;
      else if (name === 'date' || name === 'time') draft[name] = value;
    };
  }

  async function hydrateExistingPhoto() {
    if (!draft.photoId || previewUrl) return;
    const box = sheet.body.querySelector('[data-existing-photo]');
    if (!box) return;
    const url = await mediaURL(draft.photoId, 'thumb');
    if (url && box.isConnected) box.innerHTML = `<img alt="食物照片" src="${url}">`;
  }

  async function save() {
    if (busy) return;
    busy = true;
    try {
      let photoId = draft.photoId || null;
      if (draft.photo) {
        photoId = uid();
        await putMedia({ id: photoId, full: draft.photo.full, thumb: draft.photo.thumb });
      } else if (editing?.photoId && !photoId) await deleteMedia(editing.photoId);
      const f = food();
      const grams = Math.round(draft.grams) || 0;
      const entry = {
        type: 'food',
        date: draft.date,
        time: draft.time || hhmm(),
        meal: draft.meal,
        name: (draft.name || f?.zh || '自定义食物').trim(),
        foodId: draft.foodId,
        grams,
        portion: f && grams ? portionText(draft.units || Math.round((grams / f.unitG) * 10) / 10, f.unit) : grams ? `${grams} g` : '',
        kcal: Math.round(draft.kcal) || 0,
        protein: Math.round(draft.protein * 10) / 10,
        carbs: Math.round(draft.carbs * 10) / 10,
        fat: Math.round(draft.fat * 10) / 10,
        photoId,
        source: draft.source || 'manual',
        ai: draft.ai,
        corrected: !!(draft.manual && draft.ai),
      };
      if (editing) patchEntry(editing.id, entry);
      else addEntry(entry);
      sheet.close();
      toast(`${entry.name} · ${n0(entry.kcal)} kcal 已记录`);
    } catch (err) {
      console.error(err);
      toast('保存失败，请重试', { type: 'warn' });
    } finally {
      busy = false;
    }
  }

  sheet.panel.addEventListener('click', async (e) => {
    const units = e.target.closest('[data-units]');
    if (units) {
      const f = food();
      if (!f) return;
      draft.units = Number(units.dataset.units);
      draft.grams = Math.round(f.unitG * draft.units);
      draft.manual = false;
      recompute();
      sheet.body.querySelector('[name="grams"]').value = draft.grams;
      syncNumbers();
      return;
    }
    const mealBtn = e.target.closest('.seg [data-val]');
    if (mealBtn) {
      draft.meal = mealBtn.dataset.val;
      mealBtn.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('is-on', b === mealBtn));
      return;
    }
    const pick = e.target.closest('[data-pick]');
    if (pick) return pickFood(pick.dataset.pick);
    const cat = e.target.closest('[data-cat]');
    if (cat) {
      libraryCat = cat.dataset.cat;
      return showLibrary();
    }
    switch (e.target.closest('[data-act]')?.dataset.act) {
      case 'photo': {
        const file = await pickImage({ capture: true });
        if (file) onPhoto(file);
        break;
      }
      case 'library':
        showLibrary();
        break;
      case 'manual':
        if (!draft.name) draft.manual = true;
        showForm();
        break;
      case 'recalc':
        draft.manual = false;
        recompute();
        showForm();
        break;
      case 'remove-photo':
        draft.photo = null;
        draft.photoId = null;
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
        if (editing.photoId) await deleteMedia(editing.photoId);
        sheet.close();
        toast('已删除');
        break;
      }
      default:
    }
  });
  sheet.body.addEventListener('click', (e) => {
    if (e.target.closest('.photo img') && draft.photo) showImage(URL.createObjectURL(draft.photo.full));
  });

  if (editing) showForm();
  else if (start === 'photo') pickImage({ capture: true }).then((file) => (file ? onPhoto(file) : sheet.close()));
  else if (start === 'library') showLibrary();
  else if (start === 'manual') showForm();
  else showChoose();
}
