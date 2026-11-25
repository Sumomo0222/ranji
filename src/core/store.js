// 应用状态与持久化（localStorage 保存结构化数据，照片另存 IndexedDB，见 db.js）。
import { ymd } from './dates.js';

const KEY = 'ranji.v1';
const listeners = new Set();
let state = load();
let saveTimer = 0;

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID().slice(0, 8);
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function defaultState() {
  return {
    v: 1,
    createdAt: Date.now(),
    onboarded: false,
    demo: false,
    profile: {
      name: '',
      sex: 'female',
      age: 28,
      heightCm: 165,
      weightKg: 60,
      activity: 1.375,
      goal: 'lose',
      pace: 'normal',
      customCalories: 0,
      proteinPerKg: 0,
      fatPct: 0,
      targetWeightKg: 0,
      startWeightKg: 0,
      weeklyExerciseKcal: 1800,
      weeklyWorkouts: 4,
      countBurnInBudget: true,
    },
    reminders: [{ id: uid(), label: '今日打卡', time: '20:30', days: [1, 2, 3, 4, 5, 6, 7], enabled: true }],
    entries: [],
    checkins: {},
    weights: {},
    fired: {},
    settings: { theme: 'paper', haptics: true },
  };
}

function sanitize(raw) {
  const base = defaultState();
  if (!raw || typeof raw !== 'object') return base;
  const out = { ...base, ...raw, profile: { ...base.profile, ...(raw.profile || {}) }, settings: { ...base.settings, ...(raw.settings || {}) } };
  if (!Array.isArray(out.entries)) out.entries = [];
  out.entries = out.entries.filter((e) => e && e.id && e.date && e.type);
  if (!Array.isArray(out.reminders)) out.reminders = base.reminders;
  for (const k of ['checkins', 'weights', 'fired']) if (!out[k] || typeof out[k] !== 'object') out[k] = {};
  return out;
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return sanitize(raw ? JSON.parse(raw) : null);
  } catch (err) {
    console.warn('读取本地数据失败，已使用初始状态', err);
    return defaultState();
  }
}

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (err) {
      for (const fn of listeners) fn({ reason: 'error', error: err });
    }
  }, 120);
}

export function getState() {
  return state;
}

export function setState(next, reason = 'update') {
  state = sanitize(next);
  persist();
  for (const fn of listeners) fn({ reason });
}

export function update(fn, reason = 'update') {
  const next = structuredCloneSafe(state);
  fn(next);
  setState(next, reason);
  return state;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function structuredCloneSafe(s) {
  return typeof structuredClone === 'function' ? structuredClone(s) : JSON.parse(JSON.stringify(s));
}

// ---------- 记录 ----------

export function addEntry(entry) {
  const id = entry.id || uid();
  update((s) => {
    s.entries.push({ ...entry, id });
    if (entry.date === ymd()) autoStartWeight(s);
  }, 'entry');
  return id;
}

export function patchEntry(id, patch) {
  update((s) => {
    const i = s.entries.findIndex((e) => e.id === id);
    if (i >= 0) s.entries[i] = { ...s.entries[i], ...patch, id };
  }, 'entry');
}

export function removeEntry(id) {
  update((s) => {
    s.entries = s.entries.filter((e) => e.id !== id);
  }, 'entry');
}

export function entryById(id) {
  return state.entries.find((e) => e.id === id) || null;
}

function autoStartWeight(s) {
  if (!(Number(s.profile.startWeightKg) > 0) && Number(s.profile.weightKg) > 0) {
    const first = s.entries.map((e) => e.date).sort()[0];
    s.profile.startWeightKg = Number(s.profile.weightKg);
    if (!s.weights[first]) s.weights[first] = Number(s.profile.weightKg);
  }
}

export function setProfile(patch) {
  update((s) => {
    Object.assign(s.profile, patch);
    if (patch.weightKg > 0) {
      const t = ymd();
      s.weights[t] = Number(patch.weightKg);
      if (!(Number(s.profile.startWeightKg) > 0)) s.profile.startWeightKg = Number(patch.weightKg);
    }
  }, 'profile');
}

export function logWeight(day, kg) {
  update((s) => {
    if (kg > 0) s.weights[day] = Number(kg);
    else delete s.weights[day];
    if (kg > 0 && day === ymd()) s.profile.weightKg = Number(kg);
  }, 'weight');
}

export function toggleCheckin(day) {
  update((s) => {
    if (s.checkins[day]) delete s.checkins[day];
    else {
      const d = new Date();
      const late = day !== ymd();
      s.checkins[day] = { at: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, ts: d.getTime(), late };
    }
  }, 'checkin');
}

// ---------- 提醒 ----------

export function addReminder(data) {
  const r = { id: uid(), label: '打卡提醒', time: '20:00', days: [1, 2, 3, 4, 5, 6, 7], enabled: true, ...data };
  update((s) => {
    s.reminders.push(r);
  }, 'reminder');
  return r;
}

export function patchReminder(id, patch) {
  update((s) => {
    const r = s.reminders.find((x) => x.id === id);
    if (r) Object.assign(r, patch);
  }, 'reminder');
}

export function removeReminder(id) {
  update((s) => {
    s.reminders = s.reminders.filter((x) => x.id !== id);
  }, 'reminder');
}

export function markFired(id) {
  update((s) => {
    s.fired[id] = ymd();
  }, 'fired');
}

// ---------- 设置与数据 ----------

export function setSetting(key, value) {
  update((s) => {
    s.settings[key] = value;
  }, 'settings');
}

export function finishOnboarding() {
  update((s) => {
    s.onboarded = true;
  }, 'onboarding');
}

export function replaceState(next, reason = 'replace') {
  setState(sanitize(next), reason);
}

export function resetState() {
  setState({ ...defaultState(), onboarded: true }, 'reset');
}

export function exportPayload() {
  return {
    app: 'ranji',
    version: 1,
    exportedAt: new Date().toISOString(),
    state,
  };
}
