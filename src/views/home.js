// 首页：某一天的看板——打卡进度、热量收支、营养分布、健身目标、当日记录。
import { getState, resetState, toggleCheckin } from '../core/store.js';
import { dayTasks, latestWeight, streakOf, summarizeDay, targetsOf, weekExerciseProgress, weightGoal } from '../core/calc.js';
import { addDaysYmd, fmtDot, fmtMD, isoWeek, rangeDays, startOfWeek, WD, WD_FULL, ymd } from '../core/dates.js';
import { mediaURL } from '../core/db.js';
import { FOOD_BY_ID, MEALS } from '../data/foods.js';
import { EX_BY_ID } from '../data/exercises.js';
import { countUp, esc, haptic, icon, n0, n1, pct } from '../ui/dom.js';
import { confirmSheet, toast } from '../ui/kit.js';
import { go, openAddExercise, openAddFood, openGoals, openLogWeight } from '../ui/nav.js';
import { stampSvg } from '../ui/stamp.js';
import { donut } from '../ui/charts.js';

const MEAL_ICONS = { breakfast: 'sunrise', lunch: 'sun', dinner: 'moon', snack: 'cookie' };
const CAT_ICONS = { staple: 'wheat', dish: 'utensils', soup: 'soup', fruit: 'apple', drink: 'cup-soda', snack: 'candy' };
const MACROS = [
  { key: 'protein', label: '蛋白质', cls: 'p', color: 'var(--cinnabar)' },
  { key: 'carbs', label: '碳水', cls: 'c', color: 'var(--amber)' },
  { key: 'fat', label: '脂肪', cls: 'f', color: 'var(--indigo)' },
];

let viewedDay = ymd();
let stampAnim = false;

function weekStrip(state, day, today) {
  const start = startOfWeek(day);
  return `<nav class="weekstrip" aria-label="选择日期"><button class="wshift" data-act="shift-day" data-delta="-7" aria-label="上一周">${icon('chevron-left')}</button>${rangeDays(start, 7)
    .map((d, i) => {
      const cls = [state.checkins[d] ? 'is-checked' : '', d === today ? 'is-today' : '', d === day ? 'is-active' : '', d > today ? 'is-future' : ''].join(' ');
      return `<button class="wday ${cls}" data-day="${d}" ${d > today ? 'disabled' : ''} aria-label="${fmtMD(d)}${state.checkins[d] ? '，已打卡' : ''}"><span class="wday-wd">${WD[i]}</span><span class="wday-num num">${Number(d.slice(8))}</span><i class="wday-dot"></i></button>`;
    })
    .join('')}<button class="wshift" data-act="shift-day" data-delta="7" ${day >= today ? 'disabled' : ''} aria-label="下一周">${icon('chevron-right')}</button></nav>`;
}

function checkinSheet(state, day, today, summary) {
  const checked = !!state.checkins[day];
  const tasks = dayTasks(summary, checked);
  const done = tasks.filter((t) => t.done).length;
  const next = tasks.find((t) => !t.done);
  const info = state.checkins[day];
  const streak = streakOf(state.checkins, today);
  const weekDone = rangeDays(startOfWeek(today), 7).filter((d) => state.checkins[d]).length;
  let note;
  if (checked) note = info?.late ? `补卡于 ${fmtDot(day)}` : `第 ${streak} 天连续打卡，继续保持`;
  else if (!next) note = '都记好了，盖个章收工';
  else if (next.id === 'exercise') note = done ? '再记一次运动，今天就齐了' : '出门动一动，哪怕快走 20 分钟';
  else if (done === 0) note = `从${next.label}开始记录今天`;
  else note = `再记一餐${next.label}，就完成今天的进度`;

  const stamp = checked
    ? stampSvg({ date: fmtDot(day), time: info?.at || '', cls: stampAnim ? 'is-animating' : '' })
    : `<button class="stamp-btn" data-act="checkin" aria-label="${day === today ? '打卡' : '补卡'}"><span class="stamp-btn-label">打卡</span><span class="stamp-btn-sub">${day === today ? '点按盖章' : '补卡'}</span></button>`;

  return `<section class="sheet checkin" id="checkin-card">
    <div class="sheet-head"><h2 class="sheet-title">今日打卡</h2><span class="sheet-extra"><b class="num">${done}</b> / ${tasks.length}</span></div>
    <div class="checkin-body">
      <div class="tasks">
        ${tasks.map((t, i) => `<div class="task ${t.done ? 'is-done' : t === next ? 'is-next' : ''}" style="animation-delay:${i * 40}ms"><i class="task-dot">${icon('check')}</i><span>${t.label}</span></div>`).join('')}
        <p class="tasks-note">${note}</p>
      </div>
      <div class="stampzone">${stamp}</div>
    </div>
    <footer class="checkin-foot">${icon('flame')}连续 <b class="num">${streak}</b> 天 · 本周已打卡 <b class="num">${weekDone}</b> 天</footer>
  </section>`;
}

function budgetSheet(state, summary, t, animate) {
  const countBurn = state.profile.countBurnInBudget !== false;
  const budget = t.calories + (countBurn ? summary.burn : 0);
  const left = budget - summary.intake;
  const scale = Math.max(budget, summary.intake, 1);
  const bonus = budget - t.calories;
  const inW = pct(Math.min(summary.intake, budget), scale);
  const overW = pct(Math.max(0, summary.intake - budget), scale);
  const net = t.lifestyle + summary.burn - summary.intake; // 正数表示缺口
  const goalWord = state.profile.goal === 'gain' ? '盈余' : '净缺口';
  const num = (v, dec = 0) => (animate ? `data-count="${Math.round(v)}" data-dec="${dec}"` : '');
  return `<section class="sheet budget">
    <div class="sheet-head"><h2 class="sheet-title">热量收支</h2><span class="sheet-extra">目标 <b class="num">${n0(t.calories)}</b> kcal</span></div>
    <div class="kpis">
      <div class="kpi kpi--in"><span class="kpi-label">摄入</span><span class="kpi-num num" ${num(summary.intake)}>${n0(summary.intake)}</span><span class="kpi-unit">kcal in</span></div>
      <div class="kpi kpi--out"><span class="kpi-label">运动消耗</span><span class="kpi-num num" ${num(summary.burn)}>${n0(summary.burn)}</span><span class="kpi-unit">kcal out</span></div>
    </div>
    <div class="bars">
      <div class="brow"><span>摄入</span><div class="brow-track">${bonus > 0 ? `<i class="brow-bonus" style="width:${pct(bonus, scale)}%"></i>` : ''}<i class="brow-fill" style="width:${inW}%"></i>${overW ? `<i class="brow-fill over" style="left:${inW}%;width:${overW}%"></i>` : ''}${bonus > 0 ? `<i class="brow-tick" style="left:${pct(t.calories, scale)}%"></i>` : ''}</div><span class="brow-val num">${n0(summary.intake)}</span></div>
      <div class="brow"><span>消耗</span><div class="brow-track burn"><i class="brow-fill out" style="width:${pct(summary.burn, scale)}%"></i></div><span class="brow-val num">${n0(summary.burn)}</span></div>
    </div>
    <p class="budget-note ${left < 0 ? 'is-over' : ''}">${
      left >= 0
        ? `还能吃 <b class="num">${n0(left)}</b> kcal${summary.intake ? ` · 已用 ${Math.round((summary.intake / budget) * 100)}%` : ''}`
        : `超出 <b class="num">${n0(-left)}</b> kcal${countBurn && summary.burn ? ' · 运动已经帮你腾出空间' : ''}`
    }</p>
    <div class="ministats">
      <div><span>基础代谢</span><b class="num">${n0(t.bmr)}</b></div>
      <div><span>${goalWord}</span><b class="num ${net >= 0 ? 'pos' : ''}">${net >= 0 ? n0(net) : '−' + n0(-net)}</b></div>
      <div><span>饮食记录</span><b class="num">${summary.foods.length}<small> 项</small></b></div>
    </div>
  </section>`;
}

function macroSheet(summary, t) {
  const kcal = summary.proteinKcal + summary.carbsKcal + summary.fatKcal;
  const parts = MACROS.map((m) => ({ value: m.key === 'protein' ? summary.proteinKcal : m.key === 'carbs' ? summary.carbsKcal : summary.fatKcal, color: m.color }));
  const pShare = kcal ? summary.proteinKcal / kcal : 0;
  const fShare = kcal ? summary.fatKcal / kcal : 0;
  const cShare = kcal ? summary.carbsKcal / kcal : 0;
  let insight = '记下第一餐后，这里会显示三大营养素的供能比';
  if (kcal) {
    if (fShare > 0.35) insight = `脂肪供能 ${Math.round(fShare * 100)}%，偏高，晚餐可以清淡一些`;
    else if (pShare < 0.2) insight = `蛋白质供能只有 ${Math.round(pShare * 100)}%，下一餐补点蛋白质`;
    else if (pShare >= 0.3 && fShare <= 0.3) insight = '蛋白质充足、脂肪适中，结构很漂亮';
    else insight = `碳水 ${Math.round(cShare * 100)}% · 蛋白质 ${Math.round(pShare * 100)}% · 脂肪 ${Math.round(fShare * 100)}%`;
  }
  return `<section class="sheet macro">
    <div class="sheet-head"><h2 class="sheet-title">营养分布</h2><span class="sheet-extra">蛋白质供能比 <b class="num">${Math.round(pShare * 100)}</b>%</span></div>
    <div class="macro-body">
      <div class="donut">${donut(parts)}<div class="donut-center"><b class="num">${Math.round(pShare * 100)}<i>%</i></b><span>蛋白质</span></div></div>
      <div class="macro-list">
        ${MACROS.map((m) => {
          const v = summary[m.key];
          const target = t[m.key];
          return `<div class="mrow"><span class="mrow-name"><i class="c-${m.cls}"></i>${m.label}</span><span class="mrow-val num">${n0(v)}<b> / ${n0(target)} g</b></span><div class="mrow-bar"><i class="c-${m.cls}" style="width:${pct(v, target)}%"></i></div></div>`;
        }).join('')}
      </div>
    </div>
    <div class="macro-foot"><span>${insight}</span></div>
  </section>`;
}

function goalsSheet(state, day) {
  const p = state.profile;
  const week = weekExerciseProgress(state, startOfWeek(day));
  const wkKcal = Number(p.weeklyExerciseKcal) || 0;
  const wkCount = Number(p.weeklyWorkouts) || 0;
  const latest = latestWeight(state.weights, day);
  const g = weightGoal({ ...p, currentWeightKg: latest?.kg }, latest?.ymd);
  const peak = Math.max(...week.perDay, 1);
  return `<section class="sheet goals">
    <div class="sheet-head"><h2 class="sheet-title">健身目标</h2><button class="linkbtn" data-act="goals">调整目标</button></div>
    <button class="goal" data-act="trends">
      <div class="goal-top"><span class="goal-name">${icon('dumbbell')}本周运动</span><span class="goal-val num">${n0(week.kcal)}<b> / ${n0(wkKcal)} kcal</b></span></div>
      <div class="bar"><i class="bar-fill pine" style="width:${pct(week.kcal, wkKcal)}%"></i></div>
      <div class="spark" aria-hidden="true">${week.perDay.map((v) => `<i class="${v ? 'on' : ''}" style="height:${v ? Math.max(14, (v / peak) * 100) : 6}%"></i>`).join('')}</div>
    </button>
    <div class="goal-cols">
      <button class="goal" data-act="goals">
        <div class="goal-top"><span class="goal-name">${icon('flame')}训练频次</span><span class="goal-val num">${week.workouts}<b> / ${wkCount} 次</b></span></div>
        <div class="bar"><i class="bar-fill amber" style="width:${pct(week.workouts, wkCount)}%"></i></div>
        <span class="goal-sub">共 ${n0(week.minutes)} 分钟</span>
      </button>
      <button class="goal" data-act="${g ? 'goals' : 'log-weight'}">
        <div class="goal-top"><span class="goal-name">${icon('target')}目标体重</span><span class="goal-val num">${g ? n1(g.current) : '—'}<b>${g ? ` / ${n1(g.target)} kg` : ' 未设置'}</b></span></div>
        <div class="bar"><i class="bar-fill cinnabar" style="width:${g ? pct(g.done, Math.abs(g.start - g.target)) : 0}%"></i></div>
        <span class="goal-sub">${g ? (g.reached ? '已经达成，继续保持' : `还差 ${n1(Math.abs(g.remaining))} kg`) : '记一次体重开始追踪'}</span>
      </button>
    </div>
  </section>`;
}

function entryRow(e) {
  if (e.type === 'food') {
    const food = e.foodId ? FOOD_BY_ID[e.foodId] : null;
    const glyph = icon(food ? CAT_ICONS[food.cat] : 'utensils');
    const tag = e.corrected ? '<em class="tag fixed">已修正</em>' : e.ai?.p ? `<em class="tag ai">识别 ${Math.round(e.ai.p * 100)}%</em>` : '';
    return `<button class="entry" data-act="edit" data-id="${e.id}">
      <span class="thumb" ${e.photoId ? `data-photo="${e.photoId}"` : ''}>${glyph}</span>
      <span class="entry-main"><span class="entry-name">${esc(e.name)}${tag}</span><span class="entry-sub">${esc(e.portion || (e.grams ? `${e.grams} g` : '自定义份量'))} · ${esc(e.time || '')}</span></span>
      <span class="entry-side"><b class="entry-kcal num">${n0(e.kcal)}<small>kcal</small></b><i class="entry-macros">P${n0(e.protein)} C${n0(e.carbs)} F${n0(e.fat)}</i></span>
    </button>`;
  }
  const ex = EX_BY_ID[e.exId];
  const detail = [e.minutes ? `${n0(e.minutes)} 分钟` : '', e.distanceKm ? `${n1(e.distanceKm)} km` : '', e.steps ? `${n0(e.steps)} 步` : ''].filter(Boolean).join(' · ');
  const tag = e.source === 'ocr' ? (e.corrected ? '<em class="tag fixed">已修正</em>' : '<em class="tag ai">截图识别</em>') : '';
  return `<button class="entry" data-act="edit" data-id="${e.id}">
    <span class="thumb" ${e.shotId ? `data-photo="${e.shotId}"` : ''}>${icon(ex?.icon || 'dumbbell')}</span>
    <span class="entry-main"><span class="entry-name">${esc(e.name)}${tag}</span><span class="entry-sub">${detail || '未填时长'} · ${esc(e.time || '')}</span></span>
    <span class="entry-side"><b class="entry-kcal num">${n0(e.kcal)}<small>kcal</small></b></span>
  </button>`;
}

function logList(state, summary, day, isToday) {
  const head = (meal, kcal, act, extra = '') => `<button class="mealhead" data-act="${act}" ${extra}><i class="meal-ic">${icon(MEAL_ICONS[meal] || 'dumbbell')}</i><span class="mealhead-name">${meal === 'exercise' ? '运动' : MEALS.find((m) => m.id === meal).label}</span><span class="mealhead-kcal num">${kcal ? n0(kcal) : '<small class="none">未记录</small>'}${kcal ? '<small>kcal</small>' : ''}</span><i class="mealhead-add">${icon('plus')}</i></button>`;
  const rows = (list) => (list.length ? `<div class="entries">${list.map(entryRow).join('')}</div>` : '');
  return `<section class="loglist">
    <div class="loglist-head"><h2 class="sheet-title">${isToday ? '今日记录' : `${fmtMD(day)} 的记录`}</h2><span class="loglist-count num">${summary.foods.length + summary.exercises.length} 条</span></div>
    <div class="mealgroup">
      ${MEALS.map((m) => head(m.id, summary.byMeal[m.id].reduce((a, e) => a + e.kcal, 0), 'add-food', `data-meal="${m.id}"`) + rows(summary.byMeal[m.id])).join('')}
    </div>
    <div class="mealgroup">
      ${head('exercise', summary.burn, 'add-exercise')}${rows(summary.exercises)}
    </div>
  </section>`;
}

function html({ animate }) {
  const state = getState();
  const today = ymd();
  const day = viewedDay > today ? today : viewedDay;
  const isToday = day === today;
  const t = targetsOf(state.profile);
  const summary = summarizeDay(state.entries, day);
  const streak = streakOf(state.checkins, today);
  const d = new Date(`${day}T12:00:00`);
  const cls = (i) => (animate ? `rise` : '');

  return `<div class="page home">
    <header class="pagehead">
      <span class="brand"><span class="seal">燃</span>燃记</span>
      <button class="streak" data-act="trends" aria-label="连续打卡 ${streak} 天">${icon('flame')}连续 <b class="num">${streak}</b> 天</button>
    </header>
    ${state.demo ? `<div class="banner ${cls(0)}">${icon('info')}<span>当前是示例数据，可以先四处看看</span><button class="linkbtn danger" data-act="clear-demo">清除并开始</button></div>` : ''}
    <section class="dayhead ${cls(1)}">
      <div class="dayhead-date"><span class="dayhead-big num">${d.getDate()}</span><span class="dayhead-rest"><b>${d.getMonth() + 1}月</b><span>${WD_FULL[d.getDay() === 0 ? 6 : d.getDay() - 1]} · 第 ${isoWeek(day)} 周</span></span></div>
      <span class="dayhead-note serif">Daily ledger</span>
    </section>
    ${weekStrip(state, day, today)}
    ${isToday ? '' : '<div class="wday-nav"><button data-act="today">回到今天</button></div>'}
    ${checkinSheet(state, day, today, summary)}
    ${budgetSheet(state, summary, t, animate)}
    ${macroSheet(summary, t)}
    ${goalsSheet(state, day)}
    ${logList(state, summary, day, isToday)}
  </div>`;
}

export function mountHome(container, { animate = true } = {}) {
  let ac = new AbortController();
  let first = animate;

  const render = (opts = { animate: false }) => {
    ac.abort();
    ac = new AbortController();
    container.innerHTML = html({ animate: first || opts.animate });
    if (first) countUp(container);
    first = false;
    stampAnim = false;
    bind();
    hydrate();
  };

  function bind() {
    const signal = ac.signal;
    container.addEventListener('click', onClick, { signal });
  }

  async function onClick(e) {
    const target = e.target.closest('[data-act], .wday[data-day]');
    if (!target) return;
    if (target.dataset.day) {
      viewedDay = target.dataset.day;
      haptic(6);
      render();
      return;
    }
    const state = getState();
    const today = ymd();
    switch (target.dataset.act) {
      case 'checkin': {
        const was = !!state.checkins[viewedDay];
        haptic(was ? 8 : [10, 28, 16]);
        toggleCheckin(viewedDay);
        if (!was) {
          stampAnim = true;
          render();
          container.querySelector('#checkin-card')?.classList.add('is-shaking');
          toast(`已打卡 · 连续 ${streakOf(getState().checkins)} 天`);
        } else {
          render();
          toast('已取消这天的打卡');
        }
        break;
      }
      case 'shift-day': {
        const next = addDaysYmd(viewedDay, Number(target.dataset.delta));
        viewedDay = next > today ? today : next;
        haptic(6);
        render();
        break;
      }
      case 'today':
        viewedDay = today;
        render();
        break;
      case 'add-food':
        openAddFood({ date: viewedDay, meal: target.dataset.meal });
        break;
      case 'add-exercise':
        openAddExercise({ date: viewedDay });
        break;
      case 'edit': {
        const entry = state.entries.find((x) => x.id === target.dataset.id);
        if (!entry) return;
        (entry.type === 'food' ? openAddFood : openAddExercise)({ date: entry.date, entryId: entry.id });
        break;
      }
      case 'goals':
        openGoals();
        break;
      case 'log-weight':
        openLogWeight(viewedDay);
        break;
      case 'trends':
        go('trends');
        break;
      case 'clear-demo':
        if (await confirmSheet({ title: '清除示例数据', message: '会删除示例的饮食、运动和打卡记录，身体数据可以随后重新填写。', confirmLabel: '清除', danger: true })) {
          resetState();
          viewedDay = ymd();
          toast('示例数据已清除，先填一下身体数据吧');
          openGoals();
        }
        break;
      default:
    }
  }

  async function hydrate() {
    const signal = ac.signal;
    for (const node of container.querySelectorAll('[data-photo]')) {
      const url = await mediaURL(node.dataset.photo, 'thumb');
      if (signal.aborted || !node.isConnected) continue;
      if (url) {
        node.classList.add('is-photo');
        node.innerHTML = `<img alt="" loading="lazy" src="${url}">`;
      }
    }
  }

  render({ animate: first });
  return { render, unmount: () => ac.abort() };
}

export function setViewedDay(day) {
  viewedDay = day;
}

