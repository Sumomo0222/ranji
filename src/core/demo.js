// 示例数据：用于首次打开时预览看板、趋势与周报。用固定随机种子生成，内容可复现。
import { FOOD_BY_ID } from '../data/foods.js';
import { EX_BY_ID } from '../data/exercises.js';
import { exerciseKcal } from './calc.js';
import { addDaysYmd, ymd } from './dates.js';
import { defaultState, uid } from './store.js';

function rng(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BREAKFAST = ['oatmeal', 'granola', 'egg_boiled', 'milk', 'soy_milk', 'baozi', 'congee', 'wholewheat_bread', 'toast', 'latte', 'americano', 'yogurt', 'banana', 'apple', 'jianbing', 'youtiao', 'avocado_toast', 'xiaolongbao', 'milk', 'egg_fried'];
const LUNCH = [
  ['rice', 'kungpao', 'stirfried_greens'],
  ['rice', 'tomato_egg', 'chicken_breast'],
  ['beef_noodle'],
  ['rice', 'mapo_tofu', 'broccoli'],
  ['chow_mein'],
  ['fried_rice', 'cucumber_salad'],
  ['curry_rice'],
  ['bibimbap'],
  ['salad', 'chicken_breast', 'sweet_potato'],
  ['mealprep_bowl'],
  ['rice_plate'],
  ['jiaozi'],
  ['pasta'],
  ['ramen'],
  ['rice', 'braised_beef', 'stirfried_greens'],
  ['steak', 'broccoli', 'mashed_potato'],
  ['salmon', 'brown_rice', 'roasted_veg'],
  ['sushi', 'miso_soup'],
];
const DINNER = [
  ['rice', 'steamed_fish', 'stirfried_greens'],
  ['rice', 'shrimp', 'tomato_egg_soup'],
  ['congee', 'egg_boiled', 'cucumber_salad'],
  ['rice', 'braised_pork', 'broccoli'],
  ['rice_plate'],
  ['hotpot'],
  ['noodle_soup', 'fruit_salad'],
  ['rice', 'twice_cooked_pork', 'stirfried_greens'],
  ['chicken_rice_bowl'],
  ['rice', 'grilled_fish', 'tomato_egg_soup'],
  ['liangpi', 'lamb_skewer'],
  ['omurice', 'salad'],
  ['jiaozi', 'egg_custard', 'cucumber_salad'],
  ['pizza'],
  ['burger', 'fries'],
  ['curry_rice'],
  ['rice', 'kungpao', 'cauliflower'],
];
const SNACKS = ['apple', 'banana', 'yogurt', 'nuts', 'milk', 'bubble_tea', 'ice_cream', 'cookies', 'orange', 'strawberry', 'latte', 'energy_bar', 'blueberry', 'chips', 'mango'];
const WORKOUTS = [
  ['run', 32, 4.6],
  ['brisk_walk', 45, 3.8],
  ['strength', 50, 0],
  ['cycle', 55, 14.2],
  ['yoga', 40, 0],
  ['swim', 40, 1.1],
  ['hiit', 25, 0],
  ['run', 28, 4.1],
  ['strength', 60, 0],
  ['badminton', 60, 0],
];

const hhmm = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
const portions = { 0.5: '半', 1: '', 1.5: '一份半', 2: '两' };

function foodEntry(id, date, time, meal, scale, weight) {
  const f = FOOD_BY_ID[id];
  const units = Math.round(scale * 2) / 2;
  const grams = Math.round(f.unitG * units);
  const k = grams / 100;
  return {
    id: uid(),
    type: 'food',
    date,
    time,
    meal,
    name: f.zh,
    foodId: f.id,
    grams,
    portion: `${portions[units] || units}${f.unit}`,
    kcal: Math.round(f.kcal * k),
    protein: Math.round(f.p * k * 10) / 10,
    carbs: Math.round(f.c * k * 10) / 10,
    fat: Math.round(f.f * k * 10) / 10,
    source: 'demo',
    demo: true,
  };
}

/** 生成过去 28 天（含今天）的示例数据 */
export function buildDemoState() {
  const rand = rng(20241124);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const today = ymd();
  const s = defaultState();
  s.demo = true;
  s.onboarded = true;
  s.profile = {
    ...s.profile,
    age: 28,
    heightCm: 165,
    sex: 'female',
    weightKg: 62.1,
    activity: 1.375,
    goal: 'lose',
    pace: 'normal',
    targetWeightKg: 58,
    startWeightKg: 63.4,
    weeklyExerciseKcal: 1500,
    weeklyWorkouts: 4,
  };
  const weightAt = (i) => Math.round((63.4 - (i / 27) * 1.3 + (rand() - 0.5) * 0.3) * 10) / 10;

  for (let i = 27; i >= 0; i--) {
    const date = addDaysYmd(today, -i);
    const isToday = i === 0;
    if (i % 3 === 0 || isToday) s.weights[date] = weightAt(27 - i);

    // 最近 6 天连续打卡（今天留给你来盖第一个章）
    const checked = i === 0 ? false : i <= 6 ? true : rand() < 0.82;
    if (checked) s.checkins[date] = { at: hhmm(20 + Math.floor(rand() * 3), Math.floor(rand() * 60)), ts: 0, demo: true };

    if (rand() < 0.88) {
      s.entries.push(foodEntry(pick(BREAKFAST), date, hhmm(7, 10 + Math.floor(rand() * 50)), 'breakfast', rand() < 0.25 ? 0.5 : 1));
      if (rand() < 0.55) s.entries.push(foodEntry(pick(BREAKFAST), date, hhmm(7, 10 + Math.floor(rand() * 50)), 'breakfast', 1));
    }
    if (!isToday || new Date().getHours() >= 12) {
      if (rand() < 0.94) {
        const t = hhmm(12, 5 + Math.floor(rand() * 40));
        for (const id of pick(LUNCH)) if (FOOD_BY_ID[id]) s.entries.push(foodEntry(id, date, t, 'lunch', 1));
      }
    }
    if (rand() < 0.42) s.entries.push(foodEntry(pick(SNACKS), date, hhmm(15, 10 + Math.floor(rand() * 40)), 'snack', 1));
    if (!isToday) {
      if (rand() < 0.88) {
        const t = hhmm(18, 40 + Math.floor(rand() * 50));
        for (const id of pick(DINNER)) if (FOOD_BY_ID[id]) s.entries.push(foodEntry(id, date, t, 'dinner', 1));
      }
      if (rand() < 0.52) {
        const [type, minutes, km] = pick(WORKOUTS);
        const ex = EX_BY_ID[type];
        s.entries.push({
          id: uid(),
          type: 'exercise',
          date,
          time: hhmm(19, 20 + Math.floor(rand() * 60)),
          exId: ex.id,
          name: ex.label,
          met: ex.met,
          minutes,
          distanceKm: km || null,
          kcal: exerciseKcal(ex.met, minutes, 62.5),
          source: 'demo',
          demo: true,
        });
      }
    }
  }
  return s;
}
