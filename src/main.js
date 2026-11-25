// 应用入口：标签页路由、主题、首次引导、提醒调度、Service Worker 注册。
import { getState, markFired, replaceState, subscribe } from './core/store.js';
import { buildDemoState } from './core/demo.js';
import { ymd } from './core/dates.js';
import { dueReminders, showNotification } from './core/notify.js';
import { icon } from './ui/dom.js';
import { toast } from './ui/kit.js';
import { go, setRouter } from './ui/nav.js';
import { mountHome, setViewedDay } from './views/home.js';
import { mountTrends } from './views/trends.js';
import { mountReport } from './views/report.js';
import { mountMe } from './views/me.js';

const TABS = [
  { id: 'home', label: '今日', icon: 'notebook-pen' },
  { id: 'trends', label: '趋势', icon: 'chart-column' },
  { id: 'fab' },
  { id: 'report', label: '报告', icon: 'notebook-text' },
  { id: 'me', label: '我的', icon: 'user-round' },
];
const TITLES = { home: '燃记 · 今日', trends: '趋势 · 燃记', report: '周报 · 燃记', me: '我的 · 燃记' };
const VIEWS = { home: mountHome, trends: mountTrends, report: mountReport, me: mountMe };

const view = document.getElementById('view');
let tab = 'home';
let current = null;

function render(animate = true) {
  current?.unmount?.();
  view.innerHTML = '';
  current = VIEWS[tab](view, { animate });
  for (const b of document.querySelectorAll('.tab')) {
    const on = b.dataset.tab === tab;
    b.classList.toggle('is-active', on);
    if (on) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  document.title = TITLES[tab];
}

setRouter((next, day) => {
  if (next === 'home' && day) setViewedDay(day);
  if (next === tab) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  tab = next;
  render(true);
  window.scrollTo(0, 0);
});

function buildTabbar() {
  const nav = document.getElementById('tabbar');
  nav.innerHTML = TABS.map((t) =>
    t.id === 'fab'
      ? `<button class="tab-fab" data-fab aria-label="记一笔">${icon('plus')}</button>`
      : `<button class="tab ${t.id === tab ? 'is-active' : ''}" data-tab="${t.id}">${icon(t.icon)}<span>${t.label}</span></button>`,
  ).join('');
  nav.addEventListener('click', (e) => {
    if (e.target.closest('[data-fab]')) {
      import('./views/quick-add.js').then((m) => m.openQuickAdd({ date: ymd() }));
      return;
    }
    const b = e.target.closest('[data-tab]');
    if (b) go(b.dataset.tab);
  });
}

function applyTheme() {
  const t = getState().settings.theme || 'paper';
  const dark = t === 'night' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'night' : 'paper';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#141310' : '#f3efe6');
}

/** 到点提醒：应用打开时弹提示条；拿到通知权限时同时发一条系统通知 */
function startReminders() {
  const fire = (lookbackMs) => {
    const now = new Date();
    for (const { reminder: r, at } of dueReminders(getState().reminders, getState().fired, now, { lookbackMs })) {
      markFired(r.id);
      const label = r.label || '打卡提醒';
      showNotification(`燃记 · ${label}`, '花一分钟，记下今天的饮食和运动。');
      if (document.visibilityState === 'visible') {
        const late = now.getTime() - at.getTime() > 5 * 60000;
        toast(late ? `错过了 ${at.getHours()}:${String(at.getMinutes()).padStart(2, '0')} 的提醒 · ${label}` : `${label} · 该记录今天了`, {
          duration: 12000,
          action: { label: '去看看', onClick: () => go('home') },
        });
      }
    }
  };
  setInterval(() => fire(5 * 60000), 20000);
  // 回到前台时，把今天最近几小时里错过的提醒补上
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') fire(4 * 60 * 60 * 1000);
  });
  setTimeout(() => fire(4 * 60 * 60 * 1000), 1500);
}

async function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  try {
    const had = !!navigator.serviceWorker.controller;
    const reg = await navigator.serviceWorker.register(new URL('sw.js', document.baseURI));
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && had) toast('燃记已更新到新版本', { duration: 9000, action: { label: '刷新', onClick: () => location.reload() } });
      });
    });
  } catch (err) {
    console.warn('离线缓存注册失败，不影响在线使用', err);
  }
}

async function boot() {
  buildTabbar();
  applyTheme();
  subscribe(({ reason }) => {
    if (reason === 'settings') applyTheme();
    if (reason === 'error') toast('本地存储空间不足，最新修改可能没有保存', { type: 'warn', duration: 6000 });
    current?.render?.({ animate: false });
  });

  const params = new URLSearchParams(location.search);
  const state = getState();
  if (params.has('demo') && !state.entries.length) replaceState(buildDemoState(), 'demo');
  else if (!state.onboarded) {
    const { openOnboarding } = await import('./views/onboarding.js');
    openOnboarding();
  }
  render(true);
  startReminders();
  registerSW();
}

boot();
