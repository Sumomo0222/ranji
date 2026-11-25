// 轻量的 SVG 图表：分组柱状图、堆积柱状图、折线图、环形图。不依赖第三方库，样式走 CSS 变量。
import { esc } from './dom.js';

const PAD = { l: 36, r: 8, t: 14, b: 22 };
let uid = 0;

/** 取一个「好看的」坐标上限 */
export function niceMax(v) {
  if (!(v > 0)) return 100;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

function frame({ width, height, yMin, yMax, ticks, xLabels, yLabel }) {
  const plotW = width - PAD.l - PAD.r;
  const plotH = height - PAD.t - PAD.b;
  const y = (v) => PAD.t + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
  const groupW = plotW / xLabels.length;
  let out = '';
  for (let i = 0; i <= ticks; i++) {
    const v = yMin + ((yMax - yMin) / ticks) * i;
    const yy = y(v).toFixed(1);
    out += `<line class="axis" x1="${PAD.l}" x2="${width - PAD.r}" y1="${yy}" y2="${yy}"/><text x="${PAD.l - 6}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end">${esc(yLabel(v))}</text>`;
  }
  xLabels.forEach((label, i) => {
    if (xLabels.length > 10 && i % 2 === 1) return;
    out += `<text x="${(PAD.l + groupW * (i + 0.5)).toFixed(1)}" y="${height - 6}" text-anchor="middle">${esc(label)}</text>`;
  });
  return { out, plotW, plotH, y, groupW };
}

const hitAreas = (n, ax) =>
  Array.from({ length: n }, (_, i) => `<rect class="hit" data-i="${i}" x="${(PAD.l + ax.groupW * i).toFixed(1)}" y="${PAD.t}" width="${ax.groupW.toFixed(1)}" height="${ax.plotH}"/>`).join('');

const wrap = (width, height, inner, ax) => ({
  svg: `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img">${inner}<g class="tipbox" opacity="0" pointer-events="none"></g></svg>`,
  plot: { l: PAD.l, t: PAD.t, w: ax.plotW, h: ax.plotH, y: ax.y, groupW: ax.groupW, width, height },
});

/**
 * 分组柱状图：每天一组柱子（如摄入 / 运动消耗），可带目标虚线。
 * @param {{width:number, height?:number, days:{label:string, values:object}[], series:{key:string, cls:string, over?:(d:object)=>boolean}[], target?:number, yLabel?:(v:number)=>string}} opts
 */
export function groupedBars({ width, height = 190, days, series, target = 0, yLabel = (v) => Math.round(v).toString() }) {
  const maxVal = Math.max(target, ...days.flatMap((d) => series.map((s) => d.values[s.key] || 0)), 1);
  const ax = frame({ width, height, yMin: 0, yMax: niceMax(maxVal * 1.12), ticks: 4, xLabels: days.map((d) => d.label), yLabel });
  const barW = Math.min(16, ax.groupW * (series.length > 1 ? 0.3 : 0.5));
  const gap = 3;
  let bars = '';
  days.forEach((d, i) => {
    const total = series.length * barW + (series.length - 1) * gap;
    let x = PAD.l + ax.groupW * (i + 0.5) - total / 2;
    for (const s of series) {
      const v = d.values[s.key] || 0;
      const top = ax.y(v);
      bars += `<rect class="bar-${s.over?.(d) ? 'over' : s.cls}" x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0, PAD.t + ax.plotH - top).toFixed(1)}" rx="2.5"/>`;
      x += barW + gap;
    }
  });
  const line = target > 0 ? `<line class="target" x1="${PAD.l}" x2="${width - PAD.r}" y1="${ax.y(target).toFixed(1)}" y2="${ax.y(target).toFixed(1)}"/>` : '';
  return wrap(width, height, ax.out + line + bars + hitAreas(days.length, ax), ax);
}

/** 堆积柱状图：每天一根柱子，由若干部分自下而上叠成 */
export function stackedBars({ width, height = 170, days, parts, yLabel = (v) => Math.round(v).toString() }) {
  const yMax = niceMax(Math.max(1, ...days.map((d) => parts.reduce((a, p) => a + (d.values[p.key] || 0), 0))) * 1.15);
  const ax = frame({ width, height, yMin: 0, yMax, ticks: 4, xLabels: days.map((d) => d.label), yLabel });
  const barW = Math.min(22, ax.groupW * 0.52);
  const id = `stk${uid++}`;
  let defs = '';
  let bars = '';
  days.forEach((d, i) => {
    const total = parts.reduce((a, p) => a + (d.values[p.key] || 0), 0);
    if (!total) return;
    const x = PAD.l + ax.groupW * (i + 0.5) - barW / 2;
    const bottom = PAD.t + ax.plotH;
    defs += `<clipPath id="${id}-${i}"><rect x="${x.toFixed(1)}" y="${ax.y(total).toFixed(1)}" width="${barW.toFixed(1)}" height="${(bottom - ax.y(total)).toFixed(1)}" rx="3"/></clipPath>`;
    let yTop = bottom;
    bars += `<g clip-path="url(#${id}-${i})">`;
    for (const p of parts) {
      const v = d.values[p.key] || 0;
      if (!v) continue;
      const yNext = ax.y(v);
      bars += `<rect class="bar-${p.cls}" x="${x.toFixed(1)}" y="${(yTop - (bottom - yNext)).toFixed(1)}" width="${barW.toFixed(1)}" height="${((bottom - yNext) + 0.6).toFixed(1)}"/>`;
      yTop -= bottom - yNext;
    }
    bars += '</g>';
  });
  return wrap(width, height, `<defs>${defs}</defs>` + ax.out + bars + hitAreas(days.length, ax), ax);
}

/** 折线图，points 里 y 可为 null（断开） */
export function lineChart({ width, height = 170, points, yLabel = (v) => Math.round(v).toString() }) {
  const vals = points.map((p) => p.y).filter((v) => v != null);
  const lo = vals.length ? Math.min(...vals) : 0;
  const hi = vals.length ? Math.max(...vals) : 1;
  const span = Math.max(hi - lo, hi * 0.06, 1);
  const yMin = lo - span * 0.3;
  const yMax = hi + span * 0.3;
  const ax = frame({ width, height, yMin, yMax, ticks: 3, xLabels: points.map((p) => p.label), yLabel });
  const x = (i) => PAD.l + ax.groupW * (i + 0.5);
  const base = PAD.t + ax.plotH;
  const segments = [];
  let seg = [];
  points.forEach((p, i) => {
    if (p.y == null) {
      if (seg.length) segments.push(seg);
      seg = [];
    } else seg.push(i);
  });
  if (seg.length) segments.push(seg);
  let shapes = '';
  for (const s of segments) {
    const pts = s.map((i) => [x(i), ax.y(points[i].y)]);
    const first = pts[0];
    const last = pts[pts.length - 1];
    shapes += `<path class="area" d="M${first[0].toFixed(1)} ${base.toFixed(1)}${pts.map((p) => `L${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('')}L${last[0].toFixed(1)} ${base.toFixed(1)}Z"/>`;
    shapes += `<path class="line" d="M${pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('L')}"/>`;
    if (points.length <= 16) for (const p of pts) shapes += `<circle class="dot" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.2"/>`;
  }
  if (!shapes) shapes = `<text class="empty-text" x="${width / 2}" y="${base - 30}" text-anchor="middle">记录体重后在这里看到变化</text>`;
  return wrap(width, height, ax.out + shapes + hitAreas(points.length, ax), ax);
}

/** 给图表绑定点击提示：lines(i) 返回要显示的几行文字 */
export function bindTips(root, chart, lines) {
  const svg = root.querySelector('svg');
  if (!svg) return () => {};
  const box = svg.querySelector('.tipbox');
  const show = (i) => {
    const rows = lines(i);
    if (!rows) return;
    const w = Math.max(...rows.map((r) => r.length)) * 7.4 + 20;
    const h = rows.length * 16 + 10;
    const cx = chart.plot.l + chart.plot.groupW * (i + 0.5);
    const x = Math.max(2, Math.min(chart.plot.width - w - 2, cx - w / 2));
    box.setAttribute('transform', `translate(${x.toFixed(1)},2)`);
    box.innerHTML = `<rect class="tip" width="${w.toFixed(1)}" height="${h}" rx="7"/>` + rows.map((r, j) => `<text class="tip-text" x="10" y="${18 + j * 16}">${esc(r)}</text>`).join('');
    box.setAttribute('opacity', '1');
  };
  const hide = () => box.setAttribute('opacity', '0');
  const onHit = (e) => {
    const t = e.target.closest?.('.hit');
    if (t) show(Number(t.dataset.i));
    else hide();
  };
  svg.addEventListener('click', onHit);
  svg.addEventListener('pointerleave', hide);
  return () => {
    svg.removeEventListener('click', onHit);
    svg.removeEventListener('pointerleave', hide);
  };
}

/** 环形图，各段之间留一点缝 */
export function donut(parts, { size = 132, thickness = 15, gapDeg = 2.4 } = {}) {
  const r = (size - thickness) / 2;
  const c = size / 2;
  const total = parts.reduce((a, p) => a + p.value, 0);
  if (total <= 0) return `<svg viewBox="0 0 ${size} ${size}"><circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--paper-2)" stroke-width="${thickness}"/></svg>`;
  let out = '';
  let angle = -Math.PI / 2;
  for (const p of parts) {
    if (!p.value) continue;
    const sweep = (p.value / total) * Math.PI * 2;
    const half = ((gapDeg * Math.PI) / 180 / 2) * Math.min(1, sweep / 0.2);
    const a0 = angle + half;
    const a1 = angle + sweep - half;
    out += `<path d="M${(c + r * Math.cos(a0)).toFixed(2)} ${(c + r * Math.sin(a0)).toFixed(2)}A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${(c + r * Math.cos(a1)).toFixed(2)} ${(c + r * Math.sin(a1)).toFixed(2)}" fill="none" stroke="${p.color}" stroke-width="${thickness}"/>`;
    angle += sweep;
  }
  return `<svg viewBox="0 0 ${size} ${size}">${out}</svg>`;
}
