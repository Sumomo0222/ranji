// 热量、营养与周报的全部计算（纯函数，不依赖浏览器环境）。
import { exerciseKcal } from '../data/exercises.js';
import { addDaysYmd, daysBetween, fmtDot, fmtRange, isoWeek, rangeDays, WD_FULL, ymd } from './dates.js';

export const ACTIVITY = [
  { value: 1.2, label: '久坐少动', hint: '大部分时间坐着，很少走动' },
  { value: 1.375, label: '轻度活动', hint: '经常走动，日行 6000–8000 步' },
  { value: 1.55, label: '中度活动', hint: '工作需要长时间站立或走动' },
  { value: 1.725, label: '高度活动', hint: '体力劳动为主' },
];

export const GOAL_TYPES = { lose: '减脂', maintain: '维持体重', gain: '增肌' };
export const PACES = { easy: '温和', normal: '标准', fast: '激进' };

// adjust：相对“日常消耗”（不含专门运动）的缺口或盈余比例
const GOALS = {
  lose: { adjust: { easy: 0.12, normal: 0.2, fast: 0.28 }, proteinPerKg: 1.6, fatPct: 0.28 },
  maintain: { adjust: { easy: 0, normal: 0, fast: 0 }, proteinPerKg: 1.4, fatPct: 0.3 },
  gain: { adjust: { easy: -0.06, normal: -0.1, fast: -0.1 }, proteinPerKg: 1.8, fatPct: 0.25 },
};

export const KCAL_PER_KG_FAT = 7700;

export const GOALS_INFO = {
  lose: { blurb: '在日常消耗的基础上留出热量缺口，蛋白质按每公斤体重 1.6 g 估算。' },
  maintain: { blurb: '摄入与日常消耗持平，蛋白质按每公斤体重 1.4 g 估算。' },
  gain: { blurb: '在日常消耗之上略微盈余，蛋白质按每公斤体重 1.8 g 估算。' },
};

export function bmrOf(p) {
  const sex = p.sex === 'male' ? 5 : -161;
  return Math.round(10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age + sex);
}

/** 每日目标：基础代谢、日常消耗（不含专门运动）、摄入目标与三大营养素克数 */
export function targetsOf(p) {
  const bmr = bmrOf(p);
  const lifestyle = Math.round(bmr * (ACTIVITY.some((a) => a.value === p.activity) ? p.activity : 1.2));
  const goal = GOALS[p.goal] || GOALS.lose;
  const adj = goal.adjust[p.pace] ?? goal.adjust.normal;
  const floor = p.sex === 'male' ? 1500 : 1200;
  const base = Math.max(lifestyle * (1 - adj), floor);
  const calories = p.customCalories > 0 ? Math.round(p.customCalories) : Math.round(base / 10) * 10;
  const protein = Math.round((p.proteinPerKg > 0 ? p.proteinPerKg : goal.proteinPerKg) * p.weightKg);
  const fat = Math.round((calories * (p.fatPct > 0 ? p.fatPct : goal.fatPct)) / 9);
  const carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4));
  return {
    bmr,
    lifestyle,
    calories,
    protein,
    fat,
    carbs,
    proteinKcal: protein * 4,
    fatKcal: fat * 9,
    carbsKcal: carbs * 4,
    isCustom: p.customCalories > 0,
  };
}

export const round1 = (n) => Math.round(n * 10) / 10;

/** 某一天的摄入、消耗与营养汇总 */
export function summarizeDay(entries, day) {
  const foods = [];
  const exercises = [];
  let intake = 0, protein = 0, carbs = 0, fat = 0, burn = 0, exerciseMin = 0;
  for (const e of entries) {
    if (e.date !== day) continue;
    if (e.type === 'food') {
      foods.push(e);
      intake += e.kcal || 0;
      protein += e.protein || 0;
      carbs += e.carbs || 0;
      fat += e.fat || 0;
    } else if (e.type === 'exercise') {
      exercises.push(e);
      burn += e.kcal || 0;
      exerciseMin += e.minutes || 0;
    }
  }
  const byMeal = {};
  for (const m of ['breakfast', 'lunch', 'dinner', 'snack']) byMeal[m] = [];
  for (const f of foods) (byMeal[f.meal] || byMeal.snack).push(f);
  return {
    intake: Math.round(intake),
    protein: Math.round(protein),
    carbs: Math.round(carbs),
    fat: Math.round(fat),
    proteinKcal: Math.round(protein * 4),
    carbsKcal: Math.round(carbs * 4),
    fatKcal: Math.round(fat * 9),
    burn: Math.round(burn),
    exerciseMin: Math.round(exerciseMin),
    workouts: exercises.length,
    foods,
    exercises,
    byMeal,
  };
}

export const TASKS = [
  { id: 'breakfast', label: '早餐' },
  { id: 'lunch', label: '午餐' },
  { id: 'dinner', label: '晚餐' },
  { id: 'exercise', label: '运动' },
  { id: 'checkin', label: '打卡' },
];

export function dayTasks(summary, checked) {
  return TASKS.map((t) => {
    let done = false;
    if (t.id === 'exercise') done = summary.exercises.length > 0;
    else if (t.id === 'checkin') done = checked;
    else done = summary.byMeal[t.id].length > 0;
    return { ...t, done };
  });
}

/** 连续打卡天数：今天没打则从昨天往前数 */
export function streakOf(checkins, today = ymd()) {
  let d = checkins[today] ? today : addDaysYmd(today, -1);
  let n = 0;
  while (checkins[d]) {
    n++;
    d = addDaysYmd(d, -1);
  }
  return n;
}

export function weekSummaries(state, weekStart) {
  return rangeDays(weekStart, 7).map((d, i) => {
    const s = summarizeDay(state.entries, d);
    const checked = !!state.checkins[d];
    return {
      ymd: d,
      wd: i,
      label: WD_FULL[i],
      ...s,
      checked,
      weight: state.weights[d] ?? null,
      logged: s.foods.length > 0,
      tasks: dayTasks(s, checked),
    };
  });
}

export function weekExerciseProgress(state, weekStart) {
  const days = weekSummaries(state, weekStart);
  const kcal = days.reduce((a, d) => a + d.burn, 0);
  const minutes = days.reduce((a, d) => a + d.exerciseMin, 0);
  const workouts = days.reduce((a, d) => a + d.workouts, 0);
  return { kcal, minutes, workouts, perDay: days.map((d) => d.burn) };
}

/** 体重目标进度；没有目标体重或从未记录体重时返回 null */
export function weightGoal(p, latestYmd) {
  const target = Number(p.targetWeightKg);
  if (!(target > 0) || !latestYmd) return null;
  const start = Number(p.startWeightKg) > 0 ? Number(p.startWeightKg) : null;
  const current = Number(p.currentWeightKg);
  if (!(current > 0) || !start) return null;
  const total = Math.abs(start - target);
  const movedTowardTarget = (current - start) * Math.sign(target - start);
  const done = total < 0.05 ? total : Math.max(0, Math.min(total, movedTowardTarget));
  const pct = total < 0.05 ? 1 : done / total;
  const remaining = round1(target - current);
  return {
    start,
    current,
    target,
    pct,
    done,
    remaining,
    reached: p.goal === 'lose' ? current <= target : p.goal === 'gain' ? current >= target : Math.abs(current - target) < 0.5,
    change: round1(current - start),
  };
}

export function latestWeight(weights, onOrBefore = ymd()) {
  let best = null;
  for (const k of Object.keys(weights)) if (k <= onOrBefore && (!best || k > best)) best = k;
  return best ? { ymd: best, kg: weights[best] } : null;
}

const n0 = (x) => Math.round(x).toLocaleString('zh-CN');
const pct0 = (x) => `${Math.round(x * 100)}%`;

/** 自动生成某一周的健身报告 */
export function buildWeeklyReport(state, weekStart, today = ymd()) {
  const t = targetsOf(state.profile);
  const days = weekSummaries(state, weekStart);
  const end = addDaysYmd(weekStart, 6);
  const elapsed = Math.max(1, Math.min(7, daysBetween(weekStart, today) + 1));
  const isCurrent = today >= weekStart && today <= end;
  const isFuture = today < weekStart;

  const loggedDays = days.filter((d) => d.logged);
  const checkins = days.filter((d) => d.checked).length;
  const intakeSum = days.reduce((a, d) => a + d.intake, 0);
  const burn = days.reduce((a, d) => a + d.burn, 0);
  const exerciseMin = days.reduce((a, d) => a + d.exerciseMin, 0);
  const workouts = days.reduce((a, d) => a + d.workouts, 0);
  const avgIntake = loggedDays.length ? intakeSum / loggedDays.length : 0;
  const avgBurn = burn / elapsed;
  const proteinSum = loggedDays.reduce((a, d) => a + d.protein, 0);
  const avgProtein = loggedDays.length ? proteinSum / loggedDays.length : 0;
  const proteinDays = loggedDays.filter((d) => d.protein >= t.protein * 0.9).length;
  const onTargetDays = loggedDays.filter((d) => d.intake <= t.calories + d.burn).length;
  const kcalSum = loggedDays.reduce((a, d) => a + d.proteinKcal + d.carbsKcal + d.fatKcal, 0);
  const share = {
    p: kcalSum ? loggedDays.reduce((a, d) => a + d.proteinKcal, 0) / kcalSum : 0,
    c: kcalSum ? loggedDays.reduce((a, d) => a + d.carbsKcal, 0) / kcalSum : 0,
    f: kcalSum ? loggedDays.reduce((a, d) => a + d.fatKcal, 0) / kcalSum : 0,
  };
  const deficitSum = loggedDays.reduce((a, d) => a + (t.lifestyle + d.burn - d.intake), 0);

  const weekWeights = days.filter((d) => d.weight != null);
  const wStartObj = latestWeight(state.weights, weekStart);
  const weightStart = weekWeights.length ? weekWeights[0].weight : wStartObj?.kg ?? null;
  const weightEnd = weekWeights.length ? weekWeights[weekWeights.length - 1].weight : null;

  const perfect = days.filter((d) => d.logged && d.tasks.every((x) => x.done));
  const bestPool = perfect.length ? perfect : days.filter((d) => d.logged).sort((a, b) => b.tasks.filter((x) => x.done).length - a.tasks.filter((x) => x.done).length);
  const bestDay = bestPool.length ? bestPool[0] : null;

  const highlights = [];
  if (!isFuture) {
    if (checkins === elapsed) highlights.push({ kind: 'good', text: `打卡 ${checkins}/${elapsed} 天，全勤。` });
    else if (checkins >= elapsed * 0.7) highlights.push({ kind: 'good', text: `打卡 ${checkins}/${elapsed} 天，节奏稳定。` });
    else if (checkins > 0) highlights.push({ kind: 'warn', text: `打卡 ${checkins}/${elapsed} 天，有 ${elapsed - checkins} 天中断。` });
    else highlights.push({ kind: 'warn', text: '这一周还没有打卡记录。' });
  }
  if (loggedDays.length) {
    const ratio = t.calories ? avgIntake / t.calories : 0;
    const diff = Math.abs(avgIntake - t.calories);
    if (ratio <= 0.9) highlights.push({ kind: 'warn', text: `平均摄入 ${n0(avgIntake)} kcal，比目标低 ${pct0(1 - ratio)}，偏低较多。` });
    else if (ratio <= 1.1) highlights.push({ kind: 'good', text: `平均摄入 ${n0(avgIntake)} kcal，贴近目标 ${n0(t.calories)} kcal。` });
    else highlights.push({ kind: 'warn', text: `平均摄入 ${n0(avgIntake)} kcal，比目标高出约 ${n0(diff)} kcal。` });
    highlights.push({ kind: proteinDays >= Math.max(1, loggedDays.length * 0.7) ? 'good' : 'info', text: `蛋白质达标 ${proteinDays}/${loggedDays.length} 个记录日（平均 ${Math.round(avgProtein)} g，目标 ${t.protein} g）。` });
    if (kcalSum) {
      const parts = `蛋白质 ${pct0(share.p)} · 碳水 ${pct0(share.c)} · 脂肪 ${pct0(share.f)}`;
      highlights.push({
        kind: share.f > 0.35 ? 'warn' : share.p < 0.2 ? 'info' : 'good',
        text: share.f > 0.35 ? `脂肪供能占比 ${pct0(share.f)}，偏高（${parts}）。` : share.p < 0.2 ? `蛋白质供能占比 ${pct0(share.p)}，略低（${parts}）。` : `供能比均衡：${parts}。`,
      });
    }
    if (state.profile.goal === 'lose' && deficitSum > 0) {
      highlights.push({ kind: 'info', text: `记录日累计热量缺口约 ${n0(deficitSum)} kcal，理论上约合 ${(deficitSum / KCAL_PER_KG_FAT).toFixed(2)} kg 脂肪。` });
    }
  } else if (!isFuture) {
    highlights.push({ kind: 'info', text: '这一周还没有饮食记录，记下第一餐后报告会自动补全。' });
  }
  if (workouts > 0) {
    const wk = Number(state.profile.weeklyWorkouts) || 0;
    const minutes = Math.round(exerciseMin);
    const goalText = wk > 0 && workouts >= Math.ceil((wk * elapsed) / 7) ? '，已达到每周频次目标' : '';
    highlights.push({ kind: 'good', text: `运动 ${workouts} 次、共 ${minutes} 分钟，消耗 ${n0(burn)} kcal${goalText}。` });
  } else if (!isFuture) {
    highlights.push({ kind: 'info', text: '本周还没有运动记录，哪怕快走 20 分钟也算数。' });
  }
  if (weightStart != null && weightEnd != null) {
    const change = round1(weightEnd - weightStart);
    if (Math.abs(change) >= 0.05) {
      const good = state.profile.goal === 'gain' ? change > 0 : state.profile.goal === 'lose' ? change < 0 : false;
      highlights.push({ kind: good ? 'good' : 'info', text: `体重从 ${weightStart.toFixed(1)} kg 到 ${weightEnd.toFixed(1)} kg，${change > 0 ? '增加' : '减少'} ${Math.abs(change).toFixed(1)} kg。` });
    } else highlights.push({ kind: 'info', text: `体重保持稳定（${weightEnd.toFixed(1)} kg）。` });
  }
  if (bestDay) highlights.push({ kind: 'good', text: `完成度最高的一天：${bestDay.label}（${fmtDot(bestDay.ymd)}）。` });

  const advice = [];
  if (!isFuture) {
    if (checkins < elapsed * 0.7) advice.push('把打卡提醒固定在每天同一时间，先守住连续性。');
    if (loggedDays.length && proteinDays < loggedDays.length * 0.6) advice.push(`每餐先安排一掌心大小的蛋白质（鸡胸、鱼、蛋、豆制品），把蛋白质拉到 ${t.protein} g 左右。`);
    const wk = Number(state.profile.weeklyWorkouts) || 0;
    if (wk > 0 && workouts < Math.ceil((wk * elapsed) / 7)) advice.push(`本周运动 ${workouts} 次，目标是每周 ${wk} 次；下周先圈出两段固定时间。`);
    if (state.profile.goal === 'lose' && avgIntake && avgIntake < t.calories * 0.8) advice.push('摄入偏低容易掉肌肉，建议补回到目标附近，把缺口控制在 300–500 kcal。');
    if (state.profile.goal === 'gain' && avgIntake && avgIntake < t.calories * 1.03) advice.push('增肌期摄入略保守，可以在训练日加一餐主食或一杯奶。');
    if (share.f > 0.35) advice.push('减少油炸和肥肉，烹调油控制在每天 25–30 g。');
    if (loggedDays.length && avgIntake > t.calories * 1.1) advice.push('主食减四分之一，用蔬菜和汤增加饱腹感。');
    if (!advice.length) advice.push('保持当前节奏，下周试着把每次训练加长 5–10 分钟。');
  }

  return {
    weekStart,
    weekEnd: end,
    isoWeek: isoWeek(weekStart),
    rangeLabel: fmtRange(weekStart, end),
    isCurrent,
    isFuture,
    elapsed,
    targets: t,
    days,
    metrics: {
      checkins,
      loggedDays: loggedDays.length,
      avgIntake,
      avgBurn,
      burn,
      exerciseMin,
      workouts,
      avgProtein,
      proteinDays,
      onTargetDays,
      deficitSum,
      share,
      weightStart,
      weightEnd,
    },
    highlights,
    advice: advice.slice(0, 3),
  };
}

/** 报告的纯文本版，用于复制分享 */
export function reportToText(r, name = '') {
  const m = r.metrics;
  const lines = [
    `燃记 · 第 ${r.isoWeek} 周健身报告（${r.rangeLabel}）`,
    name ? `${name} 的本周小结` : '本周小结',
    '',
    `打卡 ${m.checkins}/${r.elapsed} 天 · 饮食记录 ${m.loggedDays} 天`,
    `平均摄入 ${n0(m.avgIntake)} kcal / 目标 ${n0(r.targets.calories)} kcal`,
    `运动 ${m.workouts} 次 · ${Math.round(m.exerciseMin)} 分钟 · 消耗 ${n0(m.burn)} kcal`,
    `蛋白质达标 ${m.proteinDays}/${m.loggedDays} 天 · 平均 ${Math.round(m.avgProtein)} g`,
    '',
    ...r.highlights.map((h) => `· ${h.text}`),
    '',
    '下周建议',
    ...r.advice.map((a) => `· ${a}`),
  ];
  return lines.join('\n');
}

export { exerciseKcal };
