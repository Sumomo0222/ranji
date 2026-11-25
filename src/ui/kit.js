// 底部面板、提示条、大图查看、确认框。
import { el, esc, icon } from './dom.js';

const stack = [];
let expectPop = false;

function setViewportVar() {
  const vh = window.visualViewport?.height || window.innerHeight;
  document.documentElement.style.setProperty('--vvh', `${vh}px`);
}
if (window.visualViewport) {
  setViewportVar();
  window.visualViewport.addEventListener('resize', () => {
    setViewportVar();
    syncKeyboard();
  });
  window.visualViewport.addEventListener('scroll', syncKeyboard);
}

/** 软键盘弹出时（可视视口明显变矮），把面板钉在可视视口里，避免输入框被键盘盖住 */
function syncKeyboard() {
  const vv = window.visualViewport;
  const top = stack.at(-1);
  if (!vv || !top) return;
  const open = vv.height < window.innerHeight * 0.86;
  if (open) {
    top.panel.style.top = `${Math.max(0, vv.offsetTop)}px`;
    top.panel.style.bottom = 'auto';
    top.panel.style.height = `${vv.height}px`;
    top.panel.style.borderRadius = '0';
  } else {
    top.panel.style.top = top.panel.style.bottom = top.panel.style.height = top.panel.style.borderRadius = '';
  }
}

function lock() {
  document.documentElement.classList.add('is-locked');
}
function unlock() {
  if (!stack.length) document.documentElement.classList.remove('is-locked');
}

window.addEventListener('popstate', () => {
  if (expectPop) {
    expectPop = false;
    return;
  }
  const top = stack.at(-1);
  if (top && top.dismissable) top.close(true);
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') stack.at(-1)?.close();
});

/**
 * 打开底部面板。
 * @param {{title:string, eyebrow?:string, body?:string|Node, foot?:string|Node|null, tall?:boolean, className?:string, onClose?:Function, dismissable?:boolean}} opts
 * @returns {{panel:HTMLElement, body:HTMLElement, setBody:Function, setFoot:Function, close:Function}}
 */
export function openSheet({ title, eyebrow = '', body = '', foot = null, tall = false, className = '', onClose, dismissable = true }) {
  setViewportVar();
  const opener = document.activeElement;
  const scrim = el('<div class="scrim"></div>');
  const panel = el(`<section class="panel ${tall ? 'is-tall' : ''} ${className}" role="dialog" aria-modal="true" aria-label="${esc(title)}"></section>`);
  panel.innerHTML = `
    ${dismissable ? '<button class="panel-grip" aria-label="下滑关闭"></button>' : '<div class="panel-grip" style="cursor:default"></div>'}
    <header class="panel-head">
      <div>${eyebrow ? `<span class="panel-eyebrow">${esc(eyebrow)}</span>` : ''}<h2 class="panel-title">${esc(title)}</h2></div>
      ${dismissable ? `<button class="panel-close" data-close aria-label="关闭">${icon('x')}</button>` : ''}
    </header>
    <div class="panel-body"></div>
    <footer class="panel-foot" hidden></footer>`;
  const bodyEl = panel.querySelector('.panel-body');
  const footEl = panel.querySelector('.panel-foot');

  const fill = (node, content) => {
    if (content == null) node.replaceChildren();
    else if (typeof content === 'string') node.innerHTML = content;
    else node.replaceChildren(content);
    return node;
  };

  const entry = {
    panel,
    body: bodyEl,
    dismissable,
    closed: false,
    setBody(content, { keepScroll = false } = {}) {
      fill(bodyEl, content);
      if (!keepScroll) bodyEl.scrollTop = 0;
    },
    setFoot(content) {
      fill(footEl, content);
      footEl.hidden = content == null;
    },
    close(fromPop = false) {
      if (entry.closed) return;
      entry.closed = true;
      stack.splice(stack.indexOf(entry), 1);
      scrim.classList.add('is-closing');
      panel.classList.add('is-closing');
      scrim.style.pointerEvents = panel.style.pointerEvents = 'none';
      setTimeout(() => {
        scrim.remove();
        panel.remove();
      }, 260);
      if (!fromPop && pushed) {
        expectPop = true;
        history.back();
      }
      unlock();
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus({ preventScroll: true });
      onClose?.();
    },
  };

  fill(bodyEl, body);
  entry.setFoot(foot);
  document.body.append(scrim, panel);
  lock();
  stack.push(entry);
  // 返回键（安卓）关闭最上层面板，而不是直接离开页面
  const pushed = dismissable && history.pushState({ __sheet: true }, '');

  const requestClose = () => entry.close();
  if (dismissable) {
    scrim.addEventListener('click', requestClose);
    panel.querySelector('[data-close]')?.addEventListener('click', requestClose);
  }

  // 下拉关闭
  const grip = panel.querySelector('.panel-grip');
  let startY = 0;
  let startT = 0;
  let dy = 0;
  let tracking = false;
  grip.addEventListener('pointerdown', (e) => {
    tracking = true;
    startY = e.clientY;
    startT = performance.now();
    dy = 0;
    grip.setPointerCapture(e.pointerId);
  });
  grip.addEventListener('pointermove', (e) => {
    if (!tracking) return;
    dy = Math.max(0, e.clientY - startY);
    if (dy > 2) {
      panel.classList.add('is-dragging');
      panel.style.transform = `translate(-50%, ${dy}px)`;
      scrim.style.opacity = String(1 - dy / 420);
    }
  });
  const end = () => {
    if (!tracking) return;
    tracking = false;
    const velocity = dy / Math.max(1, performance.now() - startT);
    panel.classList.remove('is-dragging');
    panel.style.transform = '';
    scrim.style.opacity = '';
    if (dy > 110 || velocity > 0.55) entry.close();
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);

  // 输入框获得焦点后滚到可视区域中间
  bodyEl.addEventListener('focusin', (e) => {
    const input = e.target;
    if (!(input instanceof HTMLElement)) return;
    setTimeout(() => input.scrollIntoView({ block: 'center', behavior: reduce() ? 'auto' : 'smooth' }), 260);
  });
  panel.addEventListener('click', (e) => {
    const b = e.target.closest('[data-close]');
    if (b && dismissable) requestClose();
  });
  return entry;
}

const reduce = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

let toastRoot;
/** 提示条：message 加可选的操作按钮 */
export function toast(message, { type = 'ok', duration = 2600, action = null } = {}) {
  toastRoot ||= el('<div class="toasts" aria-live="polite"></div>');
  if (!toastRoot.isConnected) document.body.append(toastRoot);
  const node = el(`<div class="toast ${type === 'warn' ? 'warn' : ''}">${icon(type === 'warn' ? 'triangle-alert' : 'check')}<span>${esc(message)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}</div>`);
  let timer;
  const dismiss = () => {
    clearTimeout(timer);
    node.classList.add('is-closing');
    setTimeout(() => node.remove(), 220);
  };
  node.querySelector('button')?.addEventListener('click', () => {
    action.onClick?.();
    dismiss();
  });
  toastRoot.append(node);
  while (toastRoot.children.length > 2) toastRoot.firstElementChild.remove();
  if (duration > 0) timer = setTimeout(dismiss, duration);
  return dismiss;
}

/** 全屏查看照片 */
export function showImage(src) {
  const box = el(`<div class="lightbox"><img alt=""><button aria-label="关闭">${icon('x')}</button></div>`);
  box.querySelector('img').src = src;
  const close = () => box.remove();
  box.addEventListener('click', close);
  document.body.append(box);
}

/** 确认框，返回 Promise<boolean> */
export function confirmSheet({ title, message, confirmLabel = '确定', cancelLabel = '取消', danger = false }) {
  return new Promise((resolve) => {
    let decided = false;
    const sheet = openSheet({
      title,
      body: `<p style="font-size:14.5px;color:var(--ink-2);line-height:1.6">${esc(message)}</p>`,
      className: 'confirm',
      onClose: () => {
        if (!decided) resolve(false);
      },
    });
    sheet.setFoot(`<div class="btn-row"><button class="btn btn-ghost" data-no>${esc(cancelLabel)}</button><button class="btn ${danger ? 'btn-cinnabar' : ''}" data-yes>${esc(confirmLabel)}</button></div>`);
    sheet.panel.querySelector('[data-no]').addEventListener('click', () => sheet.close());
    sheet.panel.querySelector('[data-yes]').addEventListener('click', () => {
      decided = true;
      resolve(true);
      sheet.close();
    });
  });
}

/** 数字步进器：带 − / + 按钮的输入框。点击按钮会更新输入框并触发 input 事件。 */
export function stepperHtml(name, value, { min = 0, max = 9999, step = 1, unit = '', dec = 0 } = {}) {
  return `<div class="stepper" data-stepper data-min="${min}" data-max="${max}" data-step="${step}" data-dec="${dec}">
    <button type="button" data-delta="-1" aria-label="减少">${icon('minus')}</button>
    <input class="input input-num" type="number" inputmode="decimal" name="${name}" value="${value ?? ''}" min="${min}" max="${max}" step="${step}" aria-label="${name}">
    <button type="button" data-delta="1" aria-label="增加">${icon('plus')}</button>
  </div>${unit ? `<span class="field-hint" style="text-align:right;margin-top:-2px">单位：${unit}</span>` : ''}`;
}

export function wireSteppers(root) {
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-stepper] [data-delta]');
    if (!btn) return;
    const box = btn.closest('[data-stepper]');
    const input = box.querySelector('input');
    const dec = Number(box.dataset.dec || 0);
    const step = Number(box.dataset.step || 1);
    const min = Number(box.dataset.min || 0);
    const max = Number(box.dataset.max || 9999);
    const cur = Number(input.value);
    const base = Number.isFinite(cur) ? cur : min;
    input.value = String(Math.min(max, Math.max(min, +(base + step * Number(btn.dataset.delta)).toFixed(dec))));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** 选一张图片（拍照或相册），返回 File；用户取消时返回 null */
export function pickImage({ capture = false } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (capture) input.capture = 'environment';
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.append(input);
    let settled = false;
    const done = (file) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(file || null);
    };
    input.addEventListener('change', () => done(input.files?.[0]));
    window.addEventListener('focus', () => setTimeout(() => done(input.files?.[0] || null), 800), { once: true });
    input.click();
  });
}
