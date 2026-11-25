// 首次引导：三步填完身体数据、目标和打卡提醒；也可以先载入示例数据四处看看。
import { finishOnboarding, getState, replaceState, setProfile, update } from '../core/store.js';
import { buildDemoState } from '../core/demo.js';
import { esc, icon } from '../ui/dom.js';
import { openSheet, toast } from '../ui/kit.js';
import { bodyFields, goalFields, preview, readBody, readGoal, wireForm } from './profile-form.js';

const WD = ['一', '二', '三', '四', '五', '六', '日'];

export function openOnboarding() {
  const start = getState().profile;
  let step = 0;
  let draft = { ...start };
  const sheet = openSheet({ title: '欢迎使用燃记', eyebrow: 'Welcome', tall: true, dismissable: false });

  const stepsEl = (n) => `<div class="steps" aria-hidden="true">${[0, 1, 2].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</div>`;

  const renderStep = () => {
    if (step === 0) {
      sheet.panel.querySelector('.panel-title').textContent = '先了解一下你';
      sheet.setBody(`<div class="intro">${stepsEl(0)}<h3>身体数据</h3><p>用来计算你的基础代谢、每日摄入目标和营养素建议。所有数据只保存在这台设备的浏览器里。</p></div><div class="form" data-form>${bodyFields(draft)}</div>`);
      sheet.setFoot(`<div style="display:grid;gap:8px"><button class="btn btn-block" data-next>下一步 · 设置目标</button><button class="btn btn-ghost btn-block" data-demo>先用示例数据看看</button></div>`);
    } else if (step === 1) {
      sheet.panel.querySelector('.panel-title').textContent = '想把状态练成什么样';
      sheet.setBody(`<div class="intro">${stepsEl(1)}<h3>目标</h3><p data-preview></p></div><div class="form" data-form>${goalFields(draft)}</div>`);
      sheet.setFoot(`<div class="btn-row"><button class="btn btn-ghost" data-back>上一步</button><button class="btn" data-next>下一步 · 打卡提醒</button></div>`);
    } else {
      sheet.panel.querySelector('.panel-title').textContent = '每天几点提醒你打卡';
      sheet.setBody(`<div class="intro">${stepsEl(2)}<h3>打卡提醒</h3><p>应用打开时会到点提醒；还可以一键同步到系统日历，关着浏览器也能收到提醒。</p></div>
        <div class="form">
          <div class="form-row">
            <label class="field"><span class="field-label">提醒时间</span><input class="input" type="time" name="time" value="${esc(draft.time || '20:30')}"></label>
            <label class="field"><span class="field-label">提醒内容</span><input class="input" type="text" name="label" maxlength="12" value="${esc(draft.label || '今日打卡')}"></label>
          </div>
          <div class="field"><span class="field-label">提醒日</span><div class="seg" data-days role="group">${WD.map((w, i) => `<button type="button" data-day="${i + 1}" class="${(draft.days || [1, 2, 3, 4, 5, 6, 7]).includes(i + 1) ? 'is-on' : ''}">周${w}</button>`).join('')}</div></div>
        </div>`);
      sheet.setFoot(`<div class="btn-row"><button class="btn btn-ghost" data-back>上一步</button><button class="btn btn-cinnabar" data-finish>开始使用</button></div>`);
    }
    wire();
  };

  const refreshPreview = () => {
    const el = sheet.body.querySelector('[data-preview]');
    const form = sheet.body.querySelector('[data-form]');
    if (!el || !form) return;
    const t = preview(form);
    el.textContent = t ? `按当前设置：每天约 ${t.calories.toLocaleString('zh-CN')} kcal，蛋白质 ${t.protein} g、碳水 ${t.carbs} g、脂肪 ${t.fat} g。` : '填好身体数据后，这里会显示每天的热量与营养素目标。';
  };

  const collect = () => {
    const form = sheet.body.querySelector('[data-form]');
    if (!form) return;
    draft = { ...draft, ...(step === 0 ? readBody(form) : readGoal(form)) };
  };

  function wire() {
    const form = sheet.body.querySelector('[data-form]');
    if (form) wireForm(form, refreshPreview);
    refreshPreview();
    sheet.panel.querySelector('[data-back]')?.addEventListener('click', () => {
      step -= 1;
      renderStep();
    });
    sheet.panel.querySelector('[data-demo]')?.addEventListener('click', () => {
      replaceState(buildDemoState(), 'demo');
      sheet.close();
      toast('已载入示例数据，随时可以在首页清除', { duration: 4000 });
    });
    sheet.panel.querySelector('[data-next]')?.addEventListener('click', () => {
      collect();
      step += 1;
      renderStep();
    });
    sheet.panel.querySelector('[data-days]')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-day]');
      if (!b) return;
      b.classList.toggle('is-on');
    });
    sheet.panel.querySelector('[data-finish]')?.addEventListener('click', () => {
      const time = sheet.body.querySelector('[name="time"]')?.value || '20:30';
      const label = sheet.body.querySelector('[name="label"]')?.value.trim() || '今日打卡';
      const days = [...sheet.panel.querySelectorAll('[data-days] .is-on')].map((b) => Number(b.dataset.day));
      setProfile({ ...draft, startWeightKg: draft.weightKg || 0 });
      // 引导里填的那条就是唯一的提醒，替换掉默认的那条
      update((s) => {
        s.reminders = days.length ? [{ id: crypto.randomUUID?.().slice(0, 8) || String(Date.now()), time, label, days, enabled: true }] : [];
        s.onboarded = true;
      }, 'reminder');
      sheet.close();
      toast('设置好了，记下第一餐吧', { action: { label: '去记录', onClick: () => import('./quick-add.js').then((m) => m.openQuickAdd()) } });
    });
  }

  renderStep();
}
