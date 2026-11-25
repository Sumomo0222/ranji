// 趋势：近 7 / 14 / 30 天的热量收支、营养结构、体重，以及打卡日历。
import { getState } from '../core/store.js';
import { summarizeDay, targetsOf } from '../core/calc.js';
import { addDaysYmd, addMonths, fmtDot, monthGrid, monthKey, rangeDays, WD, ymd } from '../core/dates.js';
import { icon, n0, n1 } from '../ui/dom.js';
import { bindTips, groupedBars, lineChart, stackedBars } from '../ui/charts.js';
import { go, openLogWeight } from '../ui/nav.js';

const RANGES = [7, 14, 30];
let range = 7;
let calMonth = monthKey(ymd());

function dayLabel(d, i) {
  const date = new Date(`${d}T12:00:00`);
  return range === 7 ? WD[date.getDay() === 0 ? 6 : date.getDay() - 1] : String(date.getDate());
}

export function mountTrends(container, { animate = true } = {}) {
  let ac = new AbortController();
  let first = animate;
  const cleanups = [];
  let resizeTimer = 0;

  function render() {
    ac.abort();
    ac = new AbortController();
    for (const fn of cleanups.splice(0)) fn();
    container.innerHTML = html(first);
    drawCharts();
    bind();
    first = false;
  }

  function data() {
    const state = getState();
    const today = ymd();
    const days = rangeDays(addDaysYmd(today, -(range - 1)), range).map((d, i) => {
      const s = summarizeDay(state.entries, d);
      const checked = !!state.checkins[d];
      return { d, i, label: dayLabel(d, i), ...s, checked, logged: s.foods.length > 0, weight: state.weights[d] ?? null };
    });
    return { state, today, days, t: targetsOf(state.profile) };
  }

  function html(animate) {
    const { state, days, t } = data();
    const logged = days.filter((d) => d.logged);
    const avgIn = logged.length ? logged.reduce((a, d) => a + d.intake, 0) / logged.length : 0;
    const avgOut = days.reduce((a, d) => a + d.burn, 0) / days.length;
    const deficit = logged.length ? logged.reduce((a, d) => a + (t.lifestyle + d.burn - d.intake), 0) / logged.length : 0;
    const onTarget = logged.filter((d) => d.intake <= t.calories + d.burn).length;
    const weights = Object.keys(state.weights).sort();
    const latestW = weights.length ? state.weights[weights[weights.length - 1]] : null;
    const firstW = weights.length ? state.weights[weights[0]] : null;
    const cls = animate ? 'rise' : '';
    const monthLabel = `${calMonth.slice(0, 4)}年${Number(calMonth.slice(5))}月`;

    return `<div class="page">
      <header class="pagehead">
        <div><h1 class="pagehead-title">趋势</h1><div class="pagehead-sub">Trends</div></div>
        <div class="seg" role="tablist" aria-label="时间范围" style="width:176px">${RANGES.map((r) => `<button role="tab" aria-selected="${range === r}" class="${range === r ? 'is-on' : ''}" data-range="${r}">${r}天</button>`).join('')}</div>
      </header>
      <section class="sheet ${cls}">
        <div class="sheet-head"><h2 class="sheet-title">热量收支</h2><span class="sheet-extra">虚线是摄入目标 ${n0(t.calories)}</span></div>
        <div class="chart" data-chart="energy"></div>
        <div class="legend"><span><i class="c-c"></i>摄入</span><span><i style="background:var(--pine)"></i>运动消耗</span><span><i class="c-p"></i>超出额度</span></div>
      </section>
      <div class="statgrid ${cls}">
        <div><span>平均摄入</span><b class="num">${n0(avgIn)}</b><small>kcal / 天</small></div>
        <div><span>平均运动消耗</span><b class="num">${n0(avgOut)}</b><small>kcal / 天</small></div>
        <div><span>日均缺口</span><b class="num">${n0(Math.abs(deficit))}</b><small>${deficit >= 0 ? 'kcal' : '盈余'}</small></div>
        <div><span>额度内天数</span><b class="num">${onTarget}<small style="font-size:12px">/${logged.length}</small></b></div>
      </div>
      <section class="sheet ${cls}">
        <div class="sheet-head"><h2 class="sheet-title">营养结构</h2><span class="sheet-extra">按供能（kcal）</span></div>
        <div class="chart" data-chart="macro"></div>
        <div class="legend"><span><i class="c-p"></i>蛋白质</span><span><i class="c-c"></i>碳水</span><span><i class="c-f"></i>脂肪</span></div>
      </section>
      <section class="sheet ${cls}">
        <div class="sheet-head"><h2 class="sheet-title">体重</h2><button class="linkbtn" data-act="log-weight">记录体重</button></div>
        <div class="chart" data-chart="weight"></div>
        ${latestW != null ? `<div class="legend"><span>最近 <b class="num" style="color:var(--ink);font-size:15px">${n1(latestW)}</b> kg</span>${weights.length > 1 ? `<span>期间 <b class="num" style="color:var(--ink);font-size:15px">${latestW - firstW >= 0 ? '+' : '−'}${n1(Math.abs(latestW - firstW))}</b> kg</span>` : ''}${state.profile.targetWeightKg ? `<span>目标 ${n1(state.profile.targetWeightKg)} kg</span>` : ''}</div>` : ''}
      </section>
      <section class="sheet ${cls}">
        <div class="cal-head"><b>${monthLabel}</b><span><button data-act="cal-prev" aria-label="上个月">${icon('chevron-left')}</button><button data-act="cal-next" aria-label="下个月" ${calMonth >= monthKey(ymd()) ? 'disabled' : ''}>${icon('chevron-right')}</button></span></div>
        <div class="cal">${WD.map((w) => `<span class="cal-wd">${w}</span>`).join('')}${calendarCells(state)}</div>
        <div class="legend"><span><i style="background:var(--cinnabar-soft);border:1px solid var(--cinnabar)"></i>已打卡</span><span><i style="background:var(--ink);opacity:.4"></i>记录条数</span><span class="muted" style="margin-left:auto">点日期回到当天</span></div>
      </section>
    </div>`;
  }

  function calendarCells(state) {
    return monthGrid(calMonth)
      .map((d) => {
        const s = summarizeDay(state.entries, d);
        const count = s.foods.length + s.exercises.length;
        const checked = !!state.checkins[d];
        const lvl = count >= 5 ? 'l3' : count >= 3 ? 'l2' : count >= 1 ? 'l1' : '';
        const cls = [d.slice(0, 7) !== calMonth ? 'is-out' : '', d === ymd() ? 'is-today' : '', checked ? 'is-checked' : '', d > ymd() ? 'is-future' : ''].join(' ');
        return `<button class="cal-d ${cls} ${lvl}" data-day="${d}" ${d > ymd() ? 'disabled' : ''} aria-label="${fmtDot(d)}${checked ? ' 已打卡' : ''}${count ? ` ${count} 条记录` : ''}">${Number(d.slice(8))}${count ? '<i class="lvl"></i>' : ''}</button>`;
      })
      .join('');
  }

  function drawCharts() {
    const { days, t } = data();
    const widthOf = (sel) => Math.max(260, container.querySelector(sel)?.clientWidth || 320);

    const energy = groupedBars({
      width: widthOf('[data-chart="energy"]'),
      height: range === 30 ? 200 : 190,
      days: days.map((d) => ({ label: d.label, values: { in: d.intake, out: d.burn } })),
      series: [
        { key: 'in', cls: 'in', over: (d) => d.values.in > t.calories + d.values.out },
        { key: 'out', cls: 'out' },
      ],
      target: t.calories,
      yLabel: (v) => (v >= 1000 ? `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}k` : `${Math.round(v)}`),
    });
    const macro = stackedBars({
      width: widthOf('[data-chart="macro"]'),
      height: 170,
      days: days.map((d) => ({ label: d.label, values: { p: d.proteinKcal, c: d.carbsKcal, f: d.fatKcal } })),
      parts: [
        { key: 'p', cls: 'p' },
        { key: 'c', cls: 'c' },
        { key: 'f', cls: 'f' },
      ],
      yLabel: (v) => (v >= 1000 ? `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}k` : `${Math.round(v)}`),
    });
    const weightPts = days.filter((d) => d.weight != null).map((d) => ({ label: String(Number(d.d.slice(8))), y: d.weight }));
    const weight = lineChart({ width: widthOf('[data-chart="weight"]'), height: 170, points: weightPts.length >= 2 ? weightPts : [], yLabel: (v) => v.toFixed(1) });

    container.querySelector('[data-chart="energy"]').innerHTML = energy.svg;
    container.querySelector('[data-chart="macro"]').innerHTML = macro.svg;
    container.querySelector('[data-chart="weight"]').innerHTML = weight.svg;
    cleanups.push(
      bindTips(container.querySelector('[data-chart="energy"]'), energy, (i) => {
        const d = days[i];
        return [`${fmtDot(d.d)} ${WD[new Date(`${d.d}T12:00:00`).getDay() === 0 ? 6 : new Date(`${d.d}T12:00:00`).getDay() - 1]}`, `摄入 ${n0(d.intake)} kcal`, `运动 ${n0(d.burn)} kcal`];
      }),
      bindTips(container.querySelector('[data-chart="macro"]'), macro, (i) => {
        const d = days[i];
        return [`${fmtDot(d.d)} 供能`, `蛋白质 ${n0(d.proteinKcal)} · 碳水 ${n0(d.carbsKcal)}`, `脂肪 ${n0(d.fatKcal)} kcal`];
      }),
      bindTips(container.querySelector('[data-chart="weight"]'), weight, (i) => {
        const d = days.find((x) => String(Number(x.d.slice(8))) === weightPts[i]?.label && x.weight != null);
        return d ? [`${fmtDot(d.d)}`, `${n1(d.weight)} kg`] : null;
      }),
    );
  }

  function bind() {
    const signal = ac.signal;
    container.addEventListener('click', onClick, { signal });
    const ro = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(drawCharts, 120);
    });
    ro.observe(container);
    cleanups.push(() => ro.disconnect());
  }

  function onClick(e) {
    const rangeBtn = e.target.closest('[data-range]');
    if (rangeBtn) {
      range = Number(rangeBtn.dataset.range);
      return render();
    }
    const day = e.target.closest('[data-day]');
    if (day) return go('home', day.dataset.day);
    switch (e.target.closest('[data-act]')?.dataset.act) {
      case 'log-weight':
        openLogWeight(ymd());
        break;
      case 'cal-prev':
        calMonth = addMonths(calMonth, -1);
        render();
        break;
      case 'cal-next':
        calMonth = addMonths(calMonth, 1);
        render();
        break;
      default:
    }
  }

  render();
  return { render, unmount: () => {
    ac.abort();
    for (const fn of cleanups.splice(0)) fn();
  } };
}

