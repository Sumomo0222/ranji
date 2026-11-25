import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FOODS, FOOD_BY_ID, NEGATIVE_PROMPTS } from '../src/data/foods.js';
import { EXERCISES } from '../src/data/exercises.js';
import { ymd, parseYmd, addDaysYmd, startOfWeek, rangeDays, isoWeek, fmtRange, monthGrid, weekday, daysBetween, monthKey, addMonths } from '../src/core/dates.js';
import { targetsOf, bmrOf, summarizeDay, dayTasks, streakOf, buildWeeklyReport, reportToText, exerciseKcal, weightGoal, weekSummaries } from '../src/core/calc.js';
import { parseWorkout, parseScreenshot, buildCells, readValue } from '../src/core/screenshot-parse.js';
import { buildIcs, nextFireTime, dueReminders } from '../src/core/notify.js';

test('food db: unique ids, sane macros, alcohol excepted from 4/4/9', () => {
  const ids = new Set();
  const alcohol = new Set(['beer', 'red_wine']);
  for (const f of FOODS) {
    assert.ok(!ids.has(f.id), `duplicate id ${f.id}`);
    ids.add(f.id);
    assert.ok(f.kcal > 0 && f.p >= 0 && f.c >= 0 && f.f >= 0, f.id);
    assert.ok(f.unitG > 0 && f.defUnits > 0 && f.defG > 0, f.id);
    assert.ok(Array.isArray(f.alt) && typeof f.en === 'string' && f.en.length > 2, f.id);
    if (!alcohol.has(f.id)) {
      const calc = 4 * f.p + 4 * f.c + 9 * f.f;
      assert.ok(Math.abs(calc - f.kcal) <= Math.max(8, 0.05 * f.kcal), `${f.id} ${f.zh}: ${f.kcal} vs ${calc.toFixed(1)}`);
    }
  }
  assert.ok(FOODS.length >= 150);
  assert.equal(Object.keys(FOOD_BY_ID).length, FOODS.length);
  assert.ok(NEGATIVE_PROMPTS.length >= 10);
});

test('dates: week starts Monday, ranges and ISO week', () => {
  assert.equal(ymd(new Date(2026, 10, 24)), '2026-11-24');
  assert.equal(weekday(parseYmd('2026-11-24')), 2); // Tuesday
  assert.equal(startOfWeek('2026-11-24'), '2026-11-23');
  assert.equal(addDaysYmd('2026-11-30', 1), '2026-12-01');
  assert.deepEqual(rangeDays('2026-11-23', 3), ['2026-11-23', '2026-11-24', '2026-11-25']);
  assert.equal(isoWeek('2026-01-01'), 1);
  assert.equal(isoWeek('2026-12-28'), 53);
  assert.equal(isoWeek('2027-01-01'), 53);
  assert.equal(isoWeek('2026-11-24'), 48);
  assert.equal(daysBetween('2026-02-28', '2026-03-01'), 1);
  assert.equal(fmtRange('2026-11-17', '2026-11-23'), '11.17 – 23');
  assert.equal(fmtRange('2026-11-30', '2026-12-06'), '11.30 – 12.06');
  const grid = monthGrid('2026-11');
  assert.equal(grid.length % 7, 0);
  assert.ok(grid[0] <= '2026-11-01' && grid.at(-1) >= '2026-11-30');
  assert.equal(monthKey('2026-11-24'), '2026-11');
  assert.equal(addMonths('2026-11', 2), '2027-01');
  assert.equal(addMonths('2026-01', -1), '2025-12');
});

test('targets: Mifflin-St Jeor BMR, goal adjustments and macro split', () => {
  const p = { sex: 'female', age: 28, heightCm: 165, weightKg: 62.1, activity: 1.375, goal: 'lose', pace: 'normal' };
  assert.equal(bmrOf(p), Math.round(10 * 62.1 + 6.25 * 165 - 5 * 28 - 161));
  const t = targetsOf(p);
  assert.equal(t.lifestyle, Math.round(t.bmr * 1.375));
  assert.equal(t.calories, Math.round((t.lifestyle * 0.8) / 10) * 10);
  assert.ok(Math.abs(t.protein * 4 + t.fat * 9 + t.carbs * 4 - t.calories) <= 40, 'macros add up to calories');
  const maintain = targetsOf({ ...p, goal: 'maintain' });
  assert.equal(maintain.calories, Math.round(maintain.lifestyle / 10) * 10);
  const gain = targetsOf({ ...p, goal: 'gain' });
  assert.ok(gain.calories > maintain.calories);
  const custom = targetsOf({ ...p, customCalories: 1555 });
  assert.equal(custom.calories, 1555);
  assert.equal(custom.isCustom, true);
  const floor = targetsOf({ ...p, weightKg: 40, heightCm: 140, pace: 'fast' });
  assert.ok(floor.calories >= 1200);
});

test('exercise kcal uses MET formula', () => {
  assert.equal(exerciseKcal(9.8, 30, 60), Math.round(((9.8 * 3.5 * 60) / 200) * 30));
  for (const e of EXERCISES) assert.ok(e.met > 0 && e.label && e.id && Array.isArray(e.keywords));
});

test('day summary, tasks and streak', () => {
  const entries = [
    { id: 'a', type: 'food', date: '2026-11-24', meal: 'breakfast', kcal: 300, protein: 12, carbs: 40, fat: 8 },
    { id: 'b', type: 'food', date: '2026-11-24', meal: 'lunch', kcal: 520, protein: 25, carbs: 60, fat: 18 },
    { id: 'c', type: 'exercise', date: '2026-11-24', kcal: 286, minutes: 30 },
    { id: 'd', type: 'food', date: '2026-11-23', meal: 'dinner', kcal: 600, protein: 20, carbs: 70, fat: 20 },
  ];
  const s = summarizeDay(entries, '2026-11-24');
  assert.equal(s.intake, 820);
  assert.equal(s.burn, 286);
  assert.equal(s.protein, 37);
  assert.equal(s.workouts, 1);
  assert.equal(s.exerciseMin, 30);
  assert.equal(s.byMeal.breakfast.length, 1);
  const tasks = dayTasks(s, true);
  assert.deepEqual(tasks.map((t) => t.done), [true, true, false, true, true]);
  assert.equal(streakOf({ '2026-11-24': 1, '2026-11-23': 1, '2026-11-22': 1, '2026-11-20': 1 }, '2026-11-24'), 3);
  assert.equal(streakOf({ '2026-11-23': 1, '2026-11-22': 1 }, '2026-11-24'), 2);
  assert.equal(streakOf({}, '2026-11-24'), 0);
});

test('weekly report aggregates and never throws on empty weeks', () => {
  const empty = { profile: { sex: 'female', age: 28, heightCm: 165, weightKg: 60, activity: 1.2, goal: 'lose', pace: 'normal', weeklyWorkouts: 3 }, entries: [], checkins: {}, weights: {} };
  const r0 = buildWeeklyReport(empty, '2026-11-23', '2026-11-24');
  assert.equal(r0.isCurrent, true);
  assert.equal(r0.elapsed, 2);
  assert.equal(r0.metrics.loggedDays, 0);
  assert.ok(r0.highlights.length > 0 && r0.advice.length > 0);
  assert.ok(reportToText(r0).includes('周健身报告'));

  const entries = [];
  let n = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDaysYmd('2026-11-16', i);
    for (const meal of ['breakfast', 'lunch', 'dinner']) {
      entries.push({ id: 'e' + n++, type: 'food', date: d, meal, kcal: 500, protein: 30, carbs: 55, fat: 15 });
    }
    if (i % 2 === 0) entries.push({ id: 'x' + i, type: 'exercise', date: d, kcal: 300, minutes: 30 });
  }
  const st = { profile: { ...empty.profile, weeklyWorkouts: 4 }, entries, checkins: Object.fromEntries(rangeDays('2026-11-16', 7).map((d) => [d, { at: '20:00' }])), weights: { '2026-11-16': 62.5, '2026-11-22': 62.0 } };
  const r = buildWeeklyReport(st, '2026-11-16', '2026-11-24');
  assert.equal(r.isoWeek, 47);
  assert.equal(r.elapsed, 7);
  assert.equal(r.metrics.checkins, 7);
  assert.equal(r.metrics.avgIntake, 1500);
  assert.equal(r.metrics.workouts, 4);
  assert.equal(r.metrics.proteinDays, 7);
  assert.equal(r.metrics.weightStart, 62.5);
  assert.equal(r.metrics.weightEnd, 62.0);
  assert.ok(r.metrics.deficitSum > 0, 'logged week ends in a deficit for a fat-loss target');
  assert.ok(r.days.filter((_, i) => i % 2 === 0).every((d) => d.tasks.every((t) => t.done)), 'days with a workout complete every task');
  assert.equal(r.days[1].tasks.find((t) => t.id === 'exercise').done, false);
  assert.ok(r.highlights.some((h) => h.text.includes('完成度最高的一天')));
  assert.equal(weekSummaries(st, '2026-11-16').length, 7);
  const future = buildWeeklyReport(st, '2026-12-14', '2026-11-24');
  assert.equal(future.isFuture, true);
  assert.equal(future.highlights.length, 0);
});

test('weight goal progress', () => {
  const g = weightGoal({ goal: 'lose', targetWeightKg: 58, startWeightKg: 63.4, currentWeightKg: 62.1 }, '2026-11-24');
  assert.equal(g.start, 63.4);
  assert.equal(g.current, 62.1);
  assert.equal(g.remaining, -4.1);
  assert.ok(Math.abs(g.pct - 1.3 / 5.4) < 1e-9);
  assert.equal(weightGoal({ goal: 'lose' }, null), null);
  const wrongDirection = weightGoal({ goal: 'lose', targetWeightKg: 58, startWeightKg: 63.4, currentWeightKg: 64 }, '2026-11-24');
  assert.equal(wrongDirection.done, 0);
});

test('workout screenshot parser: Chinese and English layouts', () => {
  const run = parseWorkout([
    { text: '户外跑步', confidence: 93 },
    { text: '5.21 公里', confidence: 95 },
    { text: '总时长 32:05', confidence: 92 },
    { text: '消耗 386 千卡', confidence: 94 },
    { text: "配速 6'09\"", confidence: 88 },
  ]);
  assert.equal(run.type, 'run');
  assert.equal(run.distanceKm.value, 5.21);
  assert.equal(run.minutes.value, 32.08);
  assert.equal(run.kcal.value, 386);
  assert.equal(run.guesses.length, 0, 'every field came from an explicit label or unit');

  const apple = parseWorkout([
    { text: '体能训练', confidence: 90 },
    { text: '活动能量', confidence: 95 },
    { text: '486 千卡', confidence: 93 },
    { text: '锻炼 42 分钟', confidence: 91 },
    { text: '步数 8,432', confidence: 90 },
    { text: '距离 5.2 千米', confidence: 92 },
  ]);
  assert.equal(apple.kcal.value, 486);
  assert.equal(apple.minutes.value, 42);
  assert.equal(apple.steps.value, 8432);
  assert.equal(apple.distanceKm.value, 5.2);

  const strava = parseWorkout([
    { text: 'Morning Run', confidence: 92 },
    { text: '5.21 km', confidence: 95 },
    { text: '28:06', confidence: 90 },
    { text: '386 kcal', confidence: 94 },
    { text: '145 bpm', confidence: 93 },
  ]);
  assert.equal(strava.type, 'run');
  assert.equal(strava.minutes.value, 28.1);
  assert.equal(strava.kcal.value, 386);
  assert.equal(strava.steps, null);
  assert.equal(strava.minutes.low, false);

  const decoy = parseWorkout([
    { text: '11月24日 18:30', confidence: 90 },
    { text: '动感单车', confidence: 91 },
    { text: '时长 45:00', confidence: 90 },
    { text: '412 千卡', confidence: 92 },
  ]);
  assert.equal(decoy.type, 'indoor_cycle');
  assert.equal(decoy.minutes.value, 45);
  assert.equal(decoy.kcal.value, 412);

  const treadmill = parseWorkout([
    { text: '跑步机', confidence: 90 },
    { text: '时长 40:12', confidence: 90 },
    { text: '热量 356 千卡', confidence: 90 },
    { text: '距离 6.0 公里', confidence: 90 },
    { text: "平均配速 6'42\"", confidence: 85 },
  ]);
  assert.equal(treadmill.minutes.value, 40.2);
  assert.equal(treadmill.distanceKm.value, 6);
  assert.equal(treadmill.kcal.value, 356);

  const speed = parseWorkout([{ text: 'Ride', confidence: 90 }, { text: '10.2 km/h', confidence: 90 }, { text: '12.4 km', confidence: 90 }, { text: '41:00', confidence: 90 }]);
  assert.equal(speed.distanceKm.value, 12.4);
  assert.equal(speed.type, 'cycle');

  const empty = parseWorkout([]);
  assert.equal(empty.type, null);
  assert.equal(empty.kcal, null);
});

test('reminders: next fire time, due window and calendar export', () => {
  const r = { id: 'r1', label: '今日打卡', time: '20:30', days: [1, 2, 3, 4, 5], enabled: true };
  const tue10 = new Date(2026, 10, 24, 10, 0); // Tuesday
  assert.equal(nextFireTime(r, tue10).toString(), new Date(2026, 10, 24, 20, 30).toString());
  const fri21 = new Date(2026, 10, 27, 21, 0); // Friday after time → Monday
  assert.equal(nextFireTime(r, fri21).toString(), new Date(2026, 10, 30, 20, 30).toString());
  assert.equal(nextFireTime({ ...r, enabled: false }, tue10), null);
  assert.equal(nextFireTime({ ...r, days: [] }, tue10), null);

  const at = new Date(2026, 10, 24, 20, 30, 20);
  assert.deepEqual(dueReminders([r], {}, at).map((x) => x.reminder.id), ['r1']);
  assert.equal(dueReminders([r], {}, at)[0].at.getHours(), 20);
  assert.deepEqual(dueReminders([r], { r1: '2026-11-24' }, at), []);
  assert.deepEqual(dueReminders([r], {}, new Date(2026, 10, 24, 20, 40)), []);
  assert.deepEqual(dueReminders([r], {}, new Date(2026, 10, 24, 20, 29)), []);
  // 回到前台时补发：两小时前错过的提醒，在 4 小时回看窗口内算错过，默认窗口内不算
  const evening = new Date(2026, 10, 24, 22, 10);
  assert.deepEqual(dueReminders([r], {}, evening, { lookbackMs: 4 * 3600 * 1000 }).map((x) => x.reminder.id), ['r1']);
  assert.deepEqual(dueReminders([r], {}, evening), []);
  // 零点后不该把昨天的提醒当成今天错过的
  assert.deepEqual(dueReminders([r], {}, new Date(2026, 10, 25, 1, 0), { lookbackMs: 12 * 3600 * 1000 }), []);

  const ics = buildIcs([r, { ...r, id: 'r2', time: '09:00', days: [1, 2, 3, 4, 5, 6, 7], label: '称重, 早上' }], new Date(2026, 10, 24, 10, 0));
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR'));
  assert.ok(!/(?<!\r)\n/.test(ics), 'CRLF line endings only');
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.ok(ics.includes('DTSTART:20261124T203000'));
  assert.ok(ics.includes('RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'));
  assert.ok(ics.includes('RRULE:FREQ=DAILY'));
  assert.ok(ics.includes('DTSTART:20261125T090000'));
  assert.ok(ics.includes('SUMMARY:称重\\, 早上'));
  assert.equal((ics.match(/BEGIN:VALARM/g) || []).length, 2);
  assert.ok(buildIcs([], new Date()).includes('BEGIN:VCALENDAR'));
});
