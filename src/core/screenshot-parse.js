// 从运动截图的 OCR 结果里提取「类型 / 时长 / 距离 / 消耗 / 步数」。
// 截图里数值和它的标签、单位往往不在同一行（标签在左、单位在下、或标签一行数值一行），
// 所以这里按版面几何关联：每个数字去看它左侧的标签、右侧的单位、正上方与正下方的说明，再叠加格式规则。
import { EX_BY_ID, EXERCISES } from '../data/exercises.js';

const CJK_RE = /^[\u3400-\u9fff]+$/;
const isCjk = (s) => CJK_RE.test(s);
const NUMERIC = /^\d[\d,.:]*$/;
const SHORT_ALPHA = /^[a-z]{1,4}$/i;

const FIELDS = ['kcal', 'distance', 'duration', 'steps'];

// 标签词表。BAD 一旦命中，说明这个数字不是我们要的字段（配速、心率、步频、速度等）。
const LABELS = {
  kcal: /热量|消耗|能量|千卡|大卡|卡路里|活动能量|总消耗|cal(?:ories)?|energy|burn|kcal/i,
  distance: /距离|里程|公里|千米|distance/i,
  duration: /时长|时间|用时|运动时间|duration|elapsed|time/i,
  steps: /步数|steps?/i,
};
const BAD = /目标|摄入|静息|基础|basal|resting|target|goal|intake|每日|心率|bpm|配速|pace|踏频|cadence|速度|speed|km\/h|公里\/小时|组数|sets?|reps?|次\/分钟|步频|电量|battery|海拔|elev|趟数|阻力|resist|功率|watts?|容量|volume|步\/分钟/i;
// 「千卡」最常被认成「干卡」「F」「FF」「H」
const UNITS = {
  kcal: /^(?:千卡|大卡|卡路里|卡|干卡|千卜|kcal|kca1|keal|kcar|cal|ca1|ff|f|h)$/i,
  distance: /^(?:公里|千米|公单|千来|km|m|米)$/i,
  duration: /^(?:分钟|分钾|分钟数|min|mins|minute|小时|分)$/i,
  steps: /^(?:步|steps?)$/i,
};
const LIMITS = { kcal: [5, 20000], distance: [0.05, 1000], duration: [1, 2880], steps: [50, 300000] };
// 出现这些词的行是时间戳或日期，其中的 mm:ss 不是运动时长
const CLOCK_ROW = /上午|下午|凌晨|中午|今天|昨天|\d{1,2}\s*月|\d{4}年?|周[一二三四五六日天]|星期|[A-Z][a-z]{2},|\b(?:mon|tue|wed|thu|fri|sat|sun)\b/i;
const DURATION_ROW = /时长|用时|duration|elapsed|运动时间|total time/i;
// 单元格自身是配速（6'42"、5:30/km）时不作为任何字段
const PACE = /\d\s*'\s*\d{1,2}\s*["”]|\d(?::\d{2})?\s*\/\s*(?:km|mi|公里)\s*$/i;

function cleanText(t) {
  return String(t || '')
    .replace(/[：:］［[\]()（）]/g, (c) => (/[：:]/.test(c) ? ':' : ' '))
    .replace(/。/g, '.')
    .replace(/０/g, '0')
    .trim();
}

/** OCR 常见的字母/数字混淆：只在数字上下文里纠正，避免破坏英文单词 */
function fixDigits(s) {
  return s
    .replace(/(?<=\d)[OoQ](?=\d)/g, '0')
    .replace(/(?<=\d)[lI|](?=\d)/g, '1')
    .replace(/(?<=\d)S(?=\d)/g, '5')
    .replace(/(?<=\d)B(?=\d)/g, '8')
    .replace(/^[OoQlI|](?=\d)/g, (m) => (/[lI|]/.test(m) ? '1' : '0'))
    .replace(/千卡|干卡|千卜/g, '千卡');
}

/** 单元格里的数值部分：null 或 { value, kind: 'num' | 'time', suffix, grouped, decimal } */
export function readValue(text) {
  let m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(.*)$/.exec(text);
  if (m) {
    const value = m[3] != null ? Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 60 : Number(m[1]) + Number(m[2]) / 60;
    return { value, kind: 'time', suffix: (m[4] || '').replace(/[.。]+$/, ''), grouped: false, decimal: false };
  }
  m = /^(\d{1,3}(?:,\d{3})+|\d{1,6})(?:\.(\d{1,3}))?(.*)$/.exec(text);
  if (!m || PACE.test(text)) return null;
  const int = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(int)) return null;
  return { value: int + (m[2] ? Number(`0.${m[2]}`) : 0), kind: 'num', suffix: (m[3] || '').replace(/^\.+/, ''), grouped: m[1].includes(','), decimal: !!m[2] };
}

/** 同一视觉行里挨得很近的词合并成一个单元格（「分」「钟」→「分钟」，「512」「kcal」→「512kcal」） */
export function buildCells(pass) {
  const k = 1 / (pass.scale || 1);
  const words = (pass.words || [])
    .map((w) => {
      const b = Array.isArray(w.bbox) ? { x0: w.bbox[0], y0: w.bbox[1], x1: w.bbox[2], y1: w.bbox[3] } : w.bbox || {};
      return { text: cleanText(w.text), conf: Number.isFinite(w.confidence) ? w.confidence : 70, x0: (b.x0 || 0) * k, y0: (b.y0 || 0) * k, x1: (b.x1 || 0) * k, y1: (b.y1 || 0) * k };
    })
    .filter((w) => w.text)
    .sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2 || a.x0 - b.x0);

  const rows = [];
  for (const w of words) {
    const row = rows.find((r) => {
      const ov = Math.min(w.y1, r.y1) - Math.max(w.y0, r.y0);
      return ov >= 0.5 * Math.min(w.y1 - w.y0, r.y1 - r.y0);
    });
    if (row) {
      row.words.push(w);
      row.y0 = Math.min(row.y0, w.y0);
      row.y1 = Math.max(row.y1, w.y1);
    } else rows.push({ words: [w], y0: w.y0, y1: w.y1 });
  }

  const cells = [];
  for (const row of rows) {
    row.words.sort((a, b) => a.x0 - b.x0);
    let cur = null;
    for (const w of row.words) {
      const h = w.y1 - w.y0;
      if (cur) {
        const gap = w.x0 - cur.x1;
        const cjk = isCjk(cur.text) || isCjk(w.text);
        const afterNumber = NUMERIC.test(cur.text) && (SHORT_ALPHA.test(w.text) || w.text.startsWith('/') || /^\d[.,:\d]/.test(w.text) && !/[.:]/.test(w.text));
        const limit = cjk || afterNumber ? 0.6 : 0.15;
        if (gap < limit * Math.min(h, cur.y1 - cur.y0)) {
          cur.text += w.text;
          cur.conf = (cur.conf + w.conf) / 2;
          cur.x1 = w.x1;
          cur.y0 = Math.min(cur.y0, w.y0);
          cur.y1 = Math.max(cur.y1, w.y1);
          continue;
        }
      }
      cur = { ...w };
      cells.push(cur);
    }
  }
  for (const c of cells) {
    c.text = fixDigits(c.text);
    c.h = c.y1 - c.y0;
    c.cx = (c.x0 + c.x1) / 2;
    c.cy = (c.y0 + c.y1) / 2;
  }
  return cells;
}

const xOverlap = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));

function judge(text) {
  if (PACE.test(text) || BAD.test(text)) return { f: null, kind: 'bad' };
  for (const f of FIELDS) if (UNITS[f].test(text)) return { f, kind: 'unit' };
  for (const f of FIELDS) if (LABELS[f].test(text)) return { f, kind: 'label' };
  return { f: null, kind: 'none' };
}

/** a 与 b 是否是上下相邻的说明关系：横向重叠至少 25%，纵向间隙不超过较大字高的 1.6 倍 */
function stacked(a, b) {
  const gap = a.y0 >= b.y1 ? a.y0 - b.y1 : b.y0 >= a.y1 ? b.y0 - a.y1 : -1;
  if (gap < 0 || gap > 1.6 * Math.max(a.h, b.h)) return false;
  return xOverlap(a, b) >= 0.25 * Math.min(a.x1 - a.x0, b.x1 - b.x0);
}

/**
 * 多次 OCR（不同缩放、是否反相）得到的单元格按位置去重，保留置信度更高的那个；
 * 某一遍把一个数字拆成两个碎片（小数点丢失）而另一遍完整读出时，丢弃碎片。
 */
export function mergeCells(groups) {
  const out = [];
  for (const cell of groups.flat()) {
    const dup = out.find((o) => {
      const ix = xOverlap(o, cell);
      const iy = Math.min(o.y1, cell.y1) - Math.max(o.y0, cell.y0);
      if (ix <= 0 || iy <= 0) return false;
      const inter = ix * iy;
      const uni = (o.x1 - o.x0) * (o.y1 - o.y0) + (cell.x1 - cell.x0) * (cell.y1 - cell.y0) - inter;
      return inter / uni > 0.35;
    });
    if (!dup) out.push(cell);
    else if (cell.conf > dup.conf + 8) Object.assign(dup, cell);
  }
  const startsWithDigit = (t) => /^\d/.test(t);
  const whole = out.filter((c) => /^\d+[.,]\d/.test(c.text));
  const fragments = new Set();
  for (const f of out) {
    if (!startsWithDigit(f.text)) continue;
    const w = whole.find(
      (x) =>
        x !== f &&
        Math.min(x.y1, f.y1) - Math.max(x.y0, f.y0) >= 0.5 * Math.min(x.h, f.h) &&
        (Math.abs(f.x0 - x.x0) < 0.15 * (x.x1 - x.x0) ||
          (f.x0 > x.x0 + 0.15 * (x.x1 - x.x0) && f.x0 < x.x1 && f.x1 <= x.x1 + 2.2 * x.h && /^\d+[.,](\d+)/.exec(x.text)?.[1].startsWith(/^\d+/.exec(f.text)[0]))),
    );
    if (w) fragments.add(f);
  }
  return out.filter((c) => !fragments.has(c));
}

/**
 * @param {Array<{scale:number, words:Array, width?:number, height?:number}>} passes 一次或多次 OCR 的结果（words 带 bbox，坐标为该次图片的像素）
 * @param {{width?:number, height?:number}} imageSize 原图尺寸（用于识别状态栏）
 */
export function parseScreenshot(passes, imageSize = {}) {
  const cells = mergeCells(passes.map(buildCells));

  const bands = [];
  for (const c of [...cells].sort((a, b) => a.cy - b.cy)) {
    const band = bands.find((bd) => Math.abs(bd.y - c.cy) <= 0.45 * Math.max(bd.h, c.h));
    if (band) {
      band.members.push(c);
      band.y = (band.y * band.members.length + c.cy) / (band.members.length + 1);
      band.h = Math.max(band.h, c.h);
    } else bands.push({ y: c.cy, h: c.h, members: [c] });
  }
  bands.forEach((bd, i) => bd.members.sort((a, b) => a.x0 - b.x0).forEach((m) => (m.row = i)));
  const rowText = (c) => bands[c.row].members.map((x) => x.text).join(' ');

  const numeric = [];
  for (const c of cells) {
    const v = readValue(c.text);
    if (v) numeric.push({ cell: c, ...v });
  }

  const cands = Object.fromEntries(FIELDS.map((f) => [f, []]));
  const rejected = new Set();
  const statusBar = imageSize.height ? 0.055 * imageSize.height : 0;

  for (const n of numeric) {
    const c = n.cell;
    const rowMates = bands[c.row].members.filter((o) => o !== c).sort((a, b) => a.x0 - b.x0);
    const leftSide = rowMates.filter((o) => o.x1 <= c.x0 + 2).reverse();
    const rightSide = rowMates.filter((o) => o.x0 >= c.x1 - 2);
    const isValue = (o) => !!readValue(o.text);

    // 同行标注：向左向右走到下一个数字为止；夹在两个数字之间的单位词，归离它更近的那个数字
    const around = [];
    for (const o of leftSide) {
      if (isValue(o)) break;
      const prevNum = leftSide.filter((x) => x.x1 <= o.x0 + 2).find(isValue);
      const gapLeft = prevNum ? o.x0 - prevNum.x1 : Infinity;
      if (prevNum && c.x0 - o.x1 >= gapLeft) continue;
      around.push(o);
    }
    for (const o of rightSide) {
      if (isValue(o)) break;
      const nextNum = rightSide.filter((x) => x.x0 >= o.x1 - 2).find(isValue);
      const gapRight = nextNum ? nextNum.x0 - o.x1 : Infinity;
      if (nextNum && o.x0 - c.x1 >= gapRight) continue;
      if (o.x0 - c.x1 > 1.8 * c.h) break;
      around.push(o);
    }

    // 上下标注：只取最近的一个。标签行与数值行交替出现时，更远的那个属于相邻的另一张卡片
    const stackedCells = cells
      .filter((o) => o !== c && stacked(c, o))
      .map((o) => ({ o, gap: o.y0 >= c.y1 ? o.y0 - c.y1 : c.y0 - o.y1, where: o.cy > c.cy ? 'below' : 'above' }))
      .sort((a, b) => a.gap - b.gap);
    const nearest = stackedCells[0];

    const aroundJudged = around.map((o) => ({ o, j: judge(o.text) }));
    // 同行已有明确标注时，不再看上下相邻的说明（它们多半属于相邻的另一行）
    const rowClear = aroundJudged.some((x) => x.j.kind !== 'none');
    const stackedJudged = !rowClear && nearest ? [{ o: nearest.o, j: judge(nearest.o.text), where: nearest.where }] : [];
    const text = rowText(c);
    const bad = BAD.test(c.text) || PACE.test(c.text) || aroundJudged.some((x) => x.j.kind === 'bad') || stackedJudged.some((x) => x.j.kind === 'bad') || /^\s*%$/.test(n.suffix);
    n.rowIsClock = CLOCK_ROW.test(text) && !DURATION_ROW.test(text);
    n.inStatusBar = imageSize.height > 0 && c.y1 <= statusBar;
    if (bad) {
      rejected.add(c);
      continue;
    }

    const push = (f, score, why) => cands[f].push({ value: n.value, score, conf: c.conf, cell: c, why });
    for (const { o, j } of aroundJudged) if (j.kind !== 'none') push(j.f, 4, `${j.kind}:${o.text}`);
    for (const { o, j, where } of stackedJudged) if (j.kind !== 'none') push(j.f, 3, `${j.kind}-${where}:${o.text}`);
    const suf = n.suffix.replace(/[^a-z\u3400-\u9fff]/gi, '');
    if (/^(?:km|公里|千米)$/i.test(suf)) push('distance', 3, `suffix:${suf}`);
    else if (/^千卡$/i.test(suf)) push('kcal', 3, `suffix:${suf}`);
    else if (/^(?:min|分|分钟)$/i.test(suf)) push('duration', 3, `suffix:${suf}`);
    else if (/^k?cal$/i.test(suf)) push('kcal', 4, `suffix:${suf}`);

    const explained = FIELDS.some((f) => cands[f].some((x) => x.cell === c));
    if (!explained && !n.inStatusBar && !n.rowIsClock) {
      // 没有任何说明的数字，只能靠格式猜
      if (n.kind === 'time') push('duration', 2, 'format:mm:ss');
      if (n.kind === 'num' && n.decimal && n.value >= 0.1 && n.value <= 99) push('distance', 1, 'format:decimal');
      if (n.kind === 'num' && n.grouped && n.value >= 1000 && n.value <= 99999) push('steps', 1, 'format:thousands');
    }
  }

  // 一个数字只归一个字段：各字段的证据分相加，取最高的那个；同一位置在多次 OCR 里重复读出则加分
  const owner = new Map();
  for (const f of FIELDS) for (const x of cands[f]) owner.set(x.cell, [...(owner.get(x.cell) || []), { f, score: x.score }]);
  const bestField = (cell) => {
    const sum = {};
    for (const x of owner.get(cell) || []) sum[x.f] = (sum[x.f] || 0) + x.score;
    return FIELDS.reduce((a, f) => (sum[f] > (sum[a] || 0) ? f : a), FIELDS[0]);
  };
  const pick = (f) => {
    const list = cands[f]
      .filter((x) => bestField(x.cell) === f && x.value >= LIMITS[f][0] && x.value <= LIMITS[f][1])
      .sort((a, b) => b.score - a.score || b.conf - a.conf);
    if (!list.length) return null;
    const top = list[0];
    const repeats = list.filter((x) => x !== top && Math.abs(x.value - top.value) < 0.01 && Math.abs(x.cell.cy - top.cell.cy) < Math.max(4, top.cell.h)).length;
    return { ...top, score: top.score + Math.min(repeats, 2) };
  };
  const result = Object.fromEntries(FIELDS.map((f) => [f, pick(f)]));

  // 兜底：字段完全没有证据时，挑版面上最显眼、又没人认领的数字，并标记为推测
  const guesses = [];
  const free = (pred) =>
    numeric
      .filter((n) => pred(n) && !rejected.has(n.cell) && !n.rowIsClock && !n.inStatusBar && n.cell.conf >= 45 && !FIELDS.some((f) => result[f] && result[f].cell === n.cell))
      .sort((a, b) => b.cell.h - a.cell.h)[0];
  const fallback = (f, n, why) => {
    if (n) {
      result[f] = { value: n.value, score: 1, conf: n.cell.conf, cell: n.cell, why };
      guesses.push(f);
    }
  };
  if (!result.kcal) fallback('kcal', free((n) => n.kind === 'num' && !n.decimal && !n.grouped && n.value >= 100 && n.value <= 3000), 'guess:prominent-integer');
  if (!result.distance) fallback('distance', free((n) => n.kind === 'num' && n.decimal && n.value >= 0.2 && n.value <= 60), 'guess:prominent-decimal');
  if (!result.steps) fallback('steps', free((n) => n.kind === 'num' && n.grouped && n.value >= 1000 && n.value <= 99999), 'guess:thousands');
  if (!result.duration) fallback('duration', free((n) => n.kind === 'time'), 'guess:mm:ss');

  // 运动类型：按阅读顺序找关键词，靠前的行权重更高
  const votes = {};
  [...cells].sort((a, b) => a.row - b.row || a.x0 - b.x0).forEach((c, i) => {
    for (const ex of EXERCISES) {
      for (const key of ex.keywords) {
        const k = key.trim();
        if (!k) continue;
        const hit = /[a-z]/i.test(k) ? new RegExp(`(^|[^a-z])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z])`, 'i').test(c.text) : c.text.includes(k);
        if (hit) votes[ex.id] = (votes[ex.id] || 0) + (i < 6 ? 2 : 1);
      }
    }
  });
  let type = Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  if (!type && result.steps && !result.kcal && !result.duration && !result.distance) type = 'walk';

  const field = (r, decimals = 2) =>
    r
      ? {
          value: Math.round(r.value * 10 ** decimals) / 10 ** decimals,
          confidence: Math.round(r.conf),
          low: r.score <= 1,
          why: r.why,
          bbox: { x0: Math.round(r.cell.x0), y0: Math.round(r.cell.y0), x1: Math.round(r.cell.x1), y1: Math.round(r.cell.y1) },
        }
      : null;

  return {
    type,
    typeName: type ? EX_BY_ID[type]?.label : null,
    kcal: field(result.kcal),
    minutes: field(result.duration),
    distanceKm: field(result.distance),
    steps: field(result.steps, 0),
    guesses,
    cells: [...cells]
      .sort((a, b) => a.row - b.row || a.x0 - b.x0)
      .map((c) => ({ text: c.text, confidence: Math.round(c.conf), row: c.row, bbox: { x0: Math.round(c.x0), y0: Math.round(c.y0), x1: Math.round(c.x1), y1: Math.round(c.y1) } })),
    text: bands.map((bd) => bd.members.map((c) => c.text).join('  ')).join('\n'),
  };
}

/** 兼容只给出行文本的调用：把每一行的词横向排开，再走同一套规则 */
export function parseWorkout(lines) {
  const words = [];
  (Array.isArray(lines) ? lines : []).forEach((l, i) => {
    const row = typeof l === 'string' ? { text: l, confidence: 80 } : l;
    let x = 0;
    for (const part of String(row.text || '').split(/\s+/).filter(Boolean)) {
      const w = part.length * 10;
      words.push({ text: part, confidence: Number(row.confidence ?? row.conf ?? 80), bbox: { x0: x, y0: i * 40, x1: x + w, y1: i * 40 + 30 } });
      x += w + 40;
    }
  });
  return parseScreenshot([{ scale: 1, words }]);
}

export const OCR_CONF_THRESHOLD = 60;
