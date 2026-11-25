// 轻量的界面辅助：转义、图标、数字格式、触感反馈、数字滚动。
import { ICONS } from './lucide.js';
import { getState } from '../core/store.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const icon = (name, cls = '') =>
  ICONS[name] ? `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>` : '';

const fmt = (digits) => (v) => {
  const n = Number(v) || 0;
  return digits ? n.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : Math.round(n).toLocaleString('zh-CN');
};
/** 整数，千分位 */
export const n0 = fmt(0);
/** 一位小数 */
export const n1 = fmt(1);
export const n2 = fmt(2);
export const signed = (v, digits = 0) => (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(digits)(Math.abs(v));
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
/** a 占 b 的百分比，限制在 0–100 */
export const pct = (a, b) => (b > 0 ? clamp((a / b) * 100, 0, 100) : 0);
export const round1 = (v) => Math.round((Number(v) || 0) * 10) / 10;

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** 触感反馈（支持的设备上） */
export function haptic(pattern = 12) {
  if (!getState().settings.haptics) return;
  try {
    navigator.vibrate?.(pattern);
  } catch (err) {
    /* 不支持则忽略 */
  }
}

const easeOut = (t) => 1 - Math.pow(1 - t, 3);

/** 让 [data-count] 元素的数字从 0 滚动到目标值 */
export function countUp(root) {
  const nodes = [...root.querySelectorAll('[data-count]')];
  if (!nodes.length) return;
  if (reduceMotion()) return;
  const start = performance.now();
  const dur = 720;
  const items = nodes.map((el) => ({ el, to: Number(el.dataset.count) || 0, digits: Number(el.dataset.dec || 0), sign: el.dataset.sign || '' }));
  let last = -1;
  const tick = (now) => {
    const t = clamp((now - start) / dur, 0, 1);
    const k = easeOut(t);
    if (t !== last) {
      for (const it of items) {
        const v = it.to * k;
        it.el.textContent = it.sign + (it.digits ? n1(v) : n0(v));
      }
      last = t;
    }
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function seal(cls = '') {
  return `<span class="seal ${cls}" aria-hidden="true">燃</span>`;
}
