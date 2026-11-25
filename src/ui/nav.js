// 页面间的跳转入口。各流程模块按需加载（也是打包时的分包点）。
export const TABS = ['home', 'trends', 'report', 'me'];

const loaders = {
  async addFood(opts) {
    return (await import('../views/add-food.js')).openAddFood(opts);
  },
  async addExercise(opts) {
    return (await import('../views/add-exercise.js')).openAddExercise(opts);
  },
  async quickAdd(opts) {
    return (await import('../views/quick-add.js')).openQuickAdd(opts);
  },
  async logWeight(day) {
    return (await import('../views/me.js')).openWeightSheet(day);
  },
  async goals() {
    return (await import('../views/me.js')).openGoalsSheet();
  },
  async reminders() {
    return (await import('../views/me.js')).openRemindersSheet();
  },
};

let goImpl = () => {};

/** 由 main.js 注入实际的切页实现 */
export function setRouter(fn) {
  goImpl = fn;
}

/** 切换底部标签页；day（可选）让「今日」页定位到某一天 */
export function go(tab, day) {
  goImpl(tab, day);
}

export const openAddFood = (opts) => loaders.addFood(opts);
export const openAddExercise = (opts) => loaders.addExercise(opts);
export const openQuickAdd = (opts) => loaders.quickAdd(opts);
export const openLogWeight = (day) => loaders.logWeight(day);
export const openGoals = () => loaders.goals();
export const openReminders = () => loaders.reminders();
