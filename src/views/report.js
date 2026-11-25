// 周报：按周自动生成的健身报告，可复制文字或导出长图。
import { getState } from '../core/store.js';
import { buildWeeklyReport, reportToText } from '../core/calc.js';
import { addDaysYmd, startOfWeek, WD, ymd } from '../core/dates.js';
import { esc, icon, n0, n1 } from '../ui/dom.js';
import { bindTips, groupedBars } from '../ui/charts.js';
import { toast } from '../ui/kit.js';
import { stampSvg } from '../ui/stamp.js';

let weekStart = startOfWeek(ymd());
let resizeTimer = 0;


export function mountReport(container, { animate = true } = {}) {
  let ac = new AbortController();
  let first = animate;
  let unTips = () => {};
  let ro = null;

  function render() {
    ac.abort();
    ac = new AbortController();
    unTips();
    ro?.disconnect();
    const report = buildWeeklyReport(getState(), weekStart, ymd());
    container.innerHTML = html(report, first);
    drawChart(report);
    container.addEventListener('click', onClick, { signal: ac.signal });
    ro = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => drawChart(report), 120);
    });
    ro.observe(container);
    first = false;
  }

  function html(r, animate) {
    const m = r.metrics;
    const name = getState().profile.name?.trim();
    const weightText = m.weightStart != null && m.weightEnd != null ? `${m.weightEnd - m.weightStart > 0 ? '+' : m.weightEnd - m.weightStart < 0 ? '−' : ''}${n1(Math.abs(m.weightEnd - m.weightStart))}` : '—';
    const weightDir = m.weightStart != null && m.weightEnd != null ? (m.weightEnd < m.weightStart ? 'down' : m.weightEnd > m.weightStart ? 'up' : '') : '';
    const full = m.checkins === 7 && !r.isCurrent;
    const cls = animate ? 'rise' : '';
    return `<div class="page">
      <header class="pagehead">
        <div><h1 class="pagehead-title">周报</h1><div class="pagehead-sub">Weekly report</div></div>
        <span class="streak">${icon('sparkles')}自动生成</span>
      </header>
      <div class="weekswitch ${cls}">
        <button data-act="prev" aria-label="上一周">${icon('chevron-left')}</button>
        <b>第 ${r.isoWeek} 周 · ${r.rangeLabel}</b>
        <button data-act="next" aria-label="下一周" ${r.isCurrent ? 'disabled' : ''}>${icon('chevron-right')}</button>
      </div>
      <article class="report ${cls}" id="report-card">
        <div class="report-head">
          <div>
            <div class="report-eyebrow">Weekly report · No.${r.isoWeek}</div>
            <h2 class="report-title">训练周报</h2>
            <div class="report-range">${name ? `${esc(name)} · ` : ''}${r.isCurrent ? `进行中 · 已过 ${r.elapsed} 天` : r.isFuture ? '这一周还没开始' : '完整一周'}</div>
          </div>
          ${full ? stampSvg({ date: r.rangeLabel, time: `WEEK ${r.isoWeek}`, text: '全勤', id: 'report-ink', cls: 'report-stamp' }) : ''}
        </div>
        <div class="report-grid">
          <div><span>打卡</span><b class="num">${m.checkins}<small>/ ${r.elapsed} 天</small></b></div>
          <div><span>平均摄入</span><b class="num">${n0(m.avgIntake)}<small>kcal</small></b></div>
          <div><span>平均运动消耗</span><b class="num">${n0(m.avgBurn)}<small>kcal</small></b></div>
          <div><span>体重变化</span><b class="num ${weightDir}">${weightText}<small>kg</small></b></div>
        </div>
        <div class="chart" data-chart="week" style="margin-top:14px"></div>
        <div class="legend" style="margin-top:4px"><span><i class="c-c"></i>摄入</span><span><i style="background:var(--pine)"></i>运动消耗</span><span class="muted" style="margin-left:auto">运动 ${m.workouts} 次 · ${n0(m.exerciseMin)} 分钟</span></div>
        <div class="report-section">
          <h3>本周亮点</h3>
          ${r.highlights.length ? `<ul class="hl">${r.highlights.map((h) => `<li class="${h.kind || 'info'}"><span>${esc(h.text)}</span></li>`).join('')}</ul>` : `<p class="muted" style="font-size:13.5px">等这一周开始后，报告会自动生成。</p>`}
        </div>
        <div class="report-section">
          <h3>下周建议</h3>
          ${r.advice.length ? `<ul class="advice">${r.advice.map((a, i) => `<li><i>${String(i + 1).padStart(2, '0')}</i><span>${esc(a)}</span></li>`).join('')}</ul>` : `<p class="muted" style="font-size:13.5px">下周开始后给出建议。</p>`}
        </div>
        <div class="report-actions">
          <button class="btn btn-ghost" data-act="copy">${icon('copy')}复制文字</button>
          <button class="btn" data-act="share" ${r.isFuture ? 'disabled' : ''}>${icon('share-2')}生成长图</button>
        </div>
      </article>
      <p class="field-hint" style="text-align:center;margin-top:12px">报告由你的记录自动计算，热量缺口按「日常消耗 + 运动消耗 − 摄入」统计。</p>
    </div>`;
  }

  function drawChart(r) {
    unTips();
    const box = container.querySelector('[data-chart="week"]');
    if (!box) return;
    const width = Math.max(260, box.clientWidth || 320);
    const chart = groupedBars({
      width,
      height: 170,
      days: r.days.map((d, i) => ({ label: WD[i], values: { in: d.intake, out: d.burn }, day: d })),
      series: [{ key: 'in', cls: 'in' }, { key: 'out', cls: 'out' }],
      target: r.targets.calories,
      yLabel: (v) => (v >= 1000 ? `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}k` : `${Math.round(v)}`),
    });
    box.innerHTML = chart.svg;
    unTips = bindTips(box, chart, (i) => {
      const d = r.days[i];
      return [d.label, `摄入 ${n0(d.intake)} kcal`, `运动 ${n0(d.burn)} kcal`, d.checked ? '已打卡' : '未打卡'];
    });
  }

  async function onClick(e) {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    const today = ymd();
    if (act === 'prev') {
      weekStart = addDaysYmd(weekStart, -7);
      render();
    } else if (act === 'next') {
      weekStart = addDaysYmd(weekStart, 7);
      if (weekStart > startOfWeek(today)) weekStart = startOfWeek(today);
      render();
    } else if (act === 'copy') {
      const text = reportToText(buildWeeklyReport(getState(), weekStart, today), getState().profile.name);
      try {
        await navigator.clipboard.writeText(text);
        toast('报告文字已复制');
      } catch (err) {
        toast('复制失败，请长按报告手动选择', { type: 'warn' });
      }
    } else if (act === 'share') {
      const btn = e.target.closest('[data-act]');
      btn.disabled = true;
      try {
        const report = buildWeeklyReport(getState(), weekStart, today);
        const blob = await renderReportImage(report, getState().profile.name);
        const file = new File([blob], `燃记-第${report.isoWeek}周.png`, { type: 'image/png' });
        if (navigator.share && navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: `燃记 · 第 ${report.isoWeek} 周健身报告` });
        } else {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = file.name;
          document.body.append(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 20000);
          toast('长图已生成，正在下载');
        }
      } catch (err) {
        if (err?.name !== 'AbortError') {
          console.error('生成长图失败', err);
          toast(`生成长图失败：${err?.message || '未知错误'}`, { type: 'warn', duration: 6000 });
        }
      } finally {
        btn.disabled = false;
      }
    }
  }

  render();
  return {
    render,
    unmount: () => {
      ac.abort();
      unTips();
      ro?.disconnect();
    },
  };
}

// ---------- 长图 ----------
const C = { paper: '#f3efe6', sheet: '#fbf9f4', ink: '#1c1b18', ink2: '#575247', ink3: '#776f60', line: '#ddd5c4', cinnabar: '#c8402d', amber: '#d9822b', pine: '#1f8a70' };
const SERIF = '"Songti SC", "STSong", "Noto Serif CJK SC", serif';
const SANS = '-apple-system, "PingFang SC", "Helvetica Neue", "Noto Sans SC", sans-serif';
const NUM = '"Oswald", "PingFang SC", sans-serif';
const ITALIC = '"Newsreader", "Songti SC", serif';

function wrap(ctx, text, maxW) {
  const lines = [];
  let cur = '';
  for (const ch of text) {
    if (ctx.measureText(cur + ch).width > maxW && cur) {
      lines.push(cur);
      cur = ch;
    } else cur += ch;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** 把周报画成一张竖版长图（宽 1080） */
export async function renderReportImage(r, name = '') {
  await document.fonts.ready;
  const W = 1080;
  const P = 64;
  const m = r.metrics;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const inner = W - P * 2;

  // 先量文字，算出高度
  ctx.font = `400 26px ${SANS}`;
  const hlLines = r.highlights.map((h) => ({ kind: h.kind, lines: wrap(ctx, h.text, inner - 40) }));
  const adLines = r.advice.map((a) => wrap(ctx, a, inner - 112));
  let H = P + 64 + 86 + 44 + 30 + 3 + 36 + 150 + 30 + 170 + 56 + 46 + 40 + hlLines.reduce((a, h) => a + h.lines.length * 42 + 14, 0) + 12 + 40 + 44 + adLines.reduce((a, l) => a + l.length * 42 + 14, 0) + 22 + 36 + 26;
  canvas.width = W;
  canvas.height = H;

  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = C.sheet;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = C.ink;
  ctx.fillRect(0, 0, W, 10);

  // 印章 + 品牌
  const seal = (x, y, s, fs) => {
    ctx.save();
    ctx.fillStyle = C.cinnabar;
    ctx.beginPath();
    ctx.roundRect(x, y, s, s, s * 0.26);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x + 4, y + 4, s - 8, s - 8, s * 0.2);
    ctx.stroke();
    ctx.fillStyle = '#f8f4ec';
    ctx.font = `900 ${fs}px "Kaiti SC", "STKaiti", ${SERIF}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('燃', x + s / 2, y + s / 2 + fs * 0.04);
    ctx.restore();
  };
  let y = P;
  seal(P, y, 64, 46);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.ink;
  ctx.font = `700 36px ${SERIF}`;
  ctx.fillText('燃记', P + 80, y + 44);
  ctx.font = `italic 400 30px ${ITALIC}`;
  ctx.fillStyle = C.ink3;
  ctx.textAlign = 'right';
  ctx.fillText('Weekly report', W - P, y + 44);
  ctx.textAlign = 'left';
  y += 64 + 86;

  ctx.fillStyle = C.ink;
  ctx.font = `700 60px ${SERIF}`;
  ctx.fillText(`第 ${r.isoWeek} 周训练周报`, P, y);
  y += 44;
  ctx.font = `400 27px ${SANS}`;
  ctx.fillStyle = C.ink2;
  ctx.fillText(`${name ? `${name} · ` : ''}${r.rangeLabel}${r.isCurrent ? ` · 进行中（已过 ${r.elapsed} 天）` : ''}`, P, y);
  y += 30;
  ctx.fillStyle = C.ink;
  ctx.fillRect(P, y, inner, 3);
  y += 36;

  // 指标
  const cell = (i, label, value, unit, color) => {
    const x = P + (inner / 4) * i;
    ctx.fillStyle = C.ink3;
    ctx.font = `600 22px ${SANS}`;
    ctx.fillText(label, x, y + 22);
    ctx.fillStyle = color || C.ink;
    const vw = (() => {
      ctx.font = `500 60px ${NUM}`;
      return ctx.measureText(value).width;
    })();
    ctx.fillText(value, x, y + 86);
    ctx.font = `400 22px ${SANS}`;
    ctx.fillStyle = C.ink3;
    ctx.fillText(unit, x + vw + 8, y + 86);
  };
  const wText = m.weightStart != null && m.weightEnd != null ? `${m.weightEnd - m.weightStart > 0 ? '+' : m.weightEnd - m.weightStart < 0 ? '−' : ''}${n1(Math.abs(m.weightEnd - m.weightStart))}` : '—';
  cell(0, '打卡', `${m.checkins}`, `/ ${r.elapsed} 天`);
  cell(1, '平均摄入', n0(m.avgIntake), 'kcal', '#a85a0c');
  cell(2, '平均运动消耗', n0(m.avgBurn), 'kcal', '#146a53');
  cell(3, '体重变化', wText, 'kg');
  y += 150;
  ctx.fillStyle = C.line;
  ctx.fillRect(P, y, inner, 1);
  y += 30;

  // 七天柱状图
  const chartTop = y;
  const chartH = 170;
  const maxV = Math.max(r.targets.calories, ...r.days.map((d) => d.intake), 1) * 1.12;
  const gw = inner / 7;
  const bw = 26;
  const ty = chartTop + chartH - (r.targets.calories / maxV) * chartH;
  ctx.strokeStyle = C.ink;
  ctx.setLineDash([8, 8]);
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.moveTo(P, ty);
  ctx.lineTo(P + inner, ty);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  r.days.forEach((d, i) => {
    const cx = P + gw * (i + 0.5);
    const h1 = (d.intake / maxV) * chartH;
    const h2 = (d.burn / maxV) * chartH;
    ctx.fillStyle = C.amber;
    ctx.beginPath();
    ctx.roundRect(cx - bw - 4, chartTop + chartH - h1, bw, h1, 4);
    ctx.fill();
    ctx.fillStyle = C.pine;
    ctx.beginPath();
    ctx.roundRect(cx + 4, chartTop + chartH - h2, bw, h2, 4);
    ctx.fill();
    ctx.fillStyle = d.checked ? C.cinnabar : C.ink3;
    ctx.font = `600 22px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.fillText(WD[i], cx, chartTop + chartH + 30);
    ctx.fillStyle = C.ink3;
    ctx.font = `400 500 20px ${NUM}`;
    ctx.fillText(n0(d.intake), cx, chartTop + chartH - h1 - 10);
  });
  ctx.textAlign = 'left';
  y = chartTop + chartH + 56;
  ctx.fillStyle = C.line;
  ctx.fillRect(P, y, inner, 1);
  y += 46;

  const heading = (text) => {
    ctx.fillStyle = C.ink;
    ctx.font = `700 32px ${SERIF}`;
    ctx.fillText(text, P, y);
    const w = ctx.measureText(text).width;
    ctx.fillStyle = C.line;
    ctx.fillRect(P + w + 18, y - 10, inner - w - 18, 1);
    y += 40;
  };
  heading('本周亮点');
  for (const h of hlLines) {
    ctx.fillStyle = { good: C.pine, warn: C.cinnabar, info: C.amber }[h.kind] || C.ink3;
    ctx.beginPath();
    ctx.roundRect(P, y - 18, 9, 9, 2);
    ctx.fill();
    ctx.fillStyle = C.ink2;
    ctx.font = `400 26px ${SANS}`;
    for (const line of h.lines) {
      ctx.fillText(line, P + 28, y);
      y += 42;
    }
    y += 14;
  }
  y += 12;
  heading('下周建议');
  ctx.strokeStyle = '#c9c0ad';
  ctx.setLineDash([10, 8]);
  ctx.lineWidth = 2;
  const boxH = adLines.reduce((a, l) => a + l.length * 42, 0) + 44;
  ctx.strokeRect(P, y - 30, inner, boxH);
  ctx.setLineDash([]);
  ctx.lineWidth = 1;
  y += 14;
  adLines.forEach((lines, i) => {
    ctx.fillStyle = C.cinnabar;
    ctx.font = `italic 500 26px ${ITALIC}`;
    ctx.fillText(String(i + 1).padStart(2, '0'), P + 24, y);
    ctx.fillStyle = C.ink2;
    ctx.font = `400 26px ${SANS}`;
    for (const line of lines) {
      ctx.fillText(line, P + 84, y);
      y += 42;
    }
    y += 14;
  });
  y += 22;
  ctx.fillStyle = C.line;
  ctx.fillRect(P, y, inner, 1);
  y += 36;
  seal(P, y - 30, 36, 26);
  ctx.fillStyle = C.ink3;
  ctx.font = `400 22px ${SANS}`;
  ctx.fillText('燃记 · 记录饮食与运动，数据保存在本机', P + 48, y - 6);
  ctx.font = `italic 400 22px ${ITALIC}`;
  ctx.textAlign = 'right';
  ctx.fillText('ranji', W - P, y - 6);

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

