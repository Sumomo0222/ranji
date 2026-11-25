// 身体数据与目标的表单片段：首次引导和「我的」页共用。
import { ACTIVITY, GOAL_TYPES, GOALS_INFO, PACES, targetsOf } from '../core/calc.js';
import { esc, n0 } from '../ui/dom.js';

const numField = (name, label, value, unit, { min = 0, max = 400, step = 1, placeholder = '' } = {}) => `
  <label class="field"><span class="field-label">${label}</span>
    <span class="unit-wrap"><input class="input input-num" type="number" inputmode="decimal" name="${name}" value="${value != null ? esc(value) : ''}" min="${min}" max="${max}" step="${step}" placeholder="${placeholder}"><em>${unit}</em></span>
  </label>`;

const seg = (name, label, options, value) => `<div class="seg" role="radiogroup" aria-label="${label}">${options.map((o) => `<button type="button" data-val="${esc(o.v)}" class="${String(o.v) === String(value) ? 'is-on' : ''}" role="radio" aria-checked="${String(o.v) === String(value)}">${o.label}</button>`).join('')}</div>`;

export function bodyFields(p) {
  return `
  <div class="field"><span class="field-label">性别</span>${seg('sex', '性别', [{ v: 'female', label: '女' }, { v: 'male', label: '男' }], p.sex)}</div>
  <div class="form-row-3">
    ${numField('age', '年龄', p.age, '岁', { min: 10, max: 100 })}
    ${numField('heightCm', '身高', p.heightCm, 'cm', { min: 100, max: 250 })}
    ${numField('weightKg', '体重', p.weightKg, 'kg', { min: 25, max: 300, step: 0.1 })}
  </div>
  <label class="field"><span class="field-label">日常活动量（不含专门运动）</span>
    <select class="input" name="activity">${ACTIVITY.map((a) => `<option value="${a.value}" ${Number(p.activity) === a.value ? 'selected' : ''}>${a.label} · ${a.hint}</option>`).join('')}</select>
  </label>`;
}

export function goalFields(p) {
  const paceNeeded = p.goal !== 'maintain';
  return `
  <div class="field"><span class="field-label">目标</span>${seg('goal', '目标', Object.entries(GOAL_TYPES).map(([v, label]) => ({ v, label: label.replace('体重', '') })), p.goal)}</div>
  <div class="field" data-pace ${paceNeeded ? '' : 'hidden'}><span class="field-label">节奏</span>${seg('pace', '节奏', Object.entries(PACES).filter(([v]) => p.goal !== 'gain' || v !== 'fast').map(([v, label]) => ({ v, label })), p.pace)}</div>
  <div class="notice">${GOALS_INFO[p.goal]?.blurb || ''}</div>
  <div class="optrow"><div class="optrow-main"><b>手动指定每日摄入目标</b><span data-kcal-hint>当前按身体数据自动计算：约 ${n0(targetsOf(p).calories)} kcal</span></div><button type="button" class="switch ${p.customCalories > 0 ? 'is-on' : ''}" data-toggle="custom" role="switch" aria-checked="${p.customCalories > 0}" aria-label="手动指定每日摄入目标"></button></div>
  <div class="field" data-custom ${p.customCalories > 0 ? '' : 'hidden'}>${numField('customCalories', '每日摄入目标', p.customCalories || '', 'kcal', { min: 800, max: 6000, placeholder: n0(targetsOf(p).calories) })}</div>
  <div class="form-row">
    ${numField('weeklyWorkouts', '每周训练', p.weeklyWorkouts, '次', { min: 0, max: 14 })}
    ${numField('weeklyExerciseKcal', '每周运动消耗', p.weeklyExerciseKcal, 'kcal', { min: 0, max: 20000, step: 100 })}
  </div>
  ${numField('targetWeightKg', '目标体重（可不填）', p.targetWeightKg || '', 'kg', { min: 25, max: 300, step: 0.1, placeholder: '不设目标' })}
  <div class="optrow"><div class="optrow-main"><b>运动消耗计入可摄入额度</b><span>关掉后，多吃的额度不会因为运动而增加</span></div><button type="button" class="switch ${p.countBurnInBudget !== false ? 'is-on' : ''}" data-toggle="burn" role="switch" aria-checked="${p.countBurnInBudget !== false}" aria-label="运动消耗计入可摄入额度"></button></div>`;
}

/** 读取表单里的身体数据，返回可写入 profile 的字段（无效输入会被忽略） */
export function readBody(root) {
  const num = (name) => {
    const v = Number(root.querySelector(`[name="${name}"]`)?.value);
    return Number.isFinite(v) && v > 0 ? v : undefined;
  };
  return { sex: segValue(root.querySelector('[aria-label="性别"]')), age: num('age'), heightCm: num('heightCm'), weightKg: num('weightKg'), activity: Number(root.querySelector('[name="activity"]')?.value) || undefined };
}

export function readGoal(root) {
  const num = (name) => {
    const raw = root.querySelector(`[name="${name}"]`)?.value;
    const v = Number(raw);
    return raw === '' || !Number.isFinite(v) ? undefined : v;
  };
  return {
    goal: segValue(root.querySelector('[aria-label="目标"]')),
    pace: segValue(root.querySelector('[aria-label="节奏"]')) || 'normal',
    customCalories: root.querySelector('[data-toggle="custom"]')?.classList.contains('is-on') ? num('customCalories') || undefined : 0,
    weeklyWorkouts: num('weeklyWorkouts'),
    weeklyExerciseKcal: num('weeklyExerciseKcal'),
    targetWeightKg: num('targetWeightKg') ?? 0,
    countBurnInBudget: !root.querySelector('[data-toggle="burn"]') || root.querySelector('[data-toggle="burn"]').classList.contains('is-on'),
  };
}

export function segValue(segEl) {
  return segEl?.querySelector('.is-on')?.dataset.val;
}

/** 给表单里的分段控件、开关接上行为；目标变化时联动「节奏」「手动指定」并回调以便刷新预览 */
export function wireForm(root, onChange) {
  const emit = () => onChange?.();
  root.addEventListener('click', (e) => {
    const segBtn = e.target.closest('.seg > button');
    if (segBtn) {
      segBtn.parentElement.querySelectorAll('button').forEach((b) => {
        b.classList.toggle('is-on', b === segBtn);
        b.setAttribute('aria-checked', String(b === segBtn));
      });
      if (segBtn.closest('.seg')?.getAttribute('aria-label') === '目标') {
        const pace = root.querySelector('[data-pace]');
        if (pace) pace.hidden = segBtn.dataset.val === 'maintain';
        const notice = root.querySelector('.notice');
        if (notice) notice.textContent = GOALS_INFO[segBtn.dataset.val]?.blurb || '';
        const paces = root.querySelector('[aria-label="节奏"]');
        if (paces) {
          const fast = [...paces.querySelectorAll('button')].find((b) => b.dataset.val === 'fast');
          if (fast) fast.hidden = segBtn.dataset.val === 'gain';
          if (segBtn.dataset.val === 'gain' && fast?.classList.contains('is-on')) {
            fast.classList.remove('is-on');
            paces.querySelector('[data-val="normal"]')?.classList.add('is-on');
          }
        }
      }
      emit();
      return;
    }
    const toggle = e.target.closest('[data-toggle]');
    if (toggle) {
      toggle.classList.toggle('is-on');
      toggle.setAttribute('aria-checked', String(toggle.classList.contains('is-on')));
      if (toggle.dataset.toggle === 'custom') {
        const field = root.querySelector('[data-custom]');
        if (field) {
          field.hidden = !toggle.classList.contains('is-on');
          if (!field.hidden) field.querySelector('input')?.focus();
        }
      }
      emit();
    }
  });
  root.addEventListener('input', (e) => {
    if (e.target.matches('input, select')) emit();
  });
}

/** 当前表单状态下，每日目标的热量与三大营养素 */
export function preview(root) {
  const base = { ...readBody(root), ...readGoal(root) };
  if (!base.weightKg || !base.heightCm || !base.age) return null;
  return targetsOf(base);
}
