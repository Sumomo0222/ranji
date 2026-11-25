// 日期工具。所有日期键都是本地时区的 'YYYY-MM-DD'，周一为一周的第一天。
export const WD = ['一', '二', '三', '四', '五', '六', '日'];
export const WD_FULL = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
export const DAY_MS = 86400000;

const pad = (n) => String(n).padStart(2, '0');

export function ymd(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

export function addDaysYmd(s, n) {
  return ymd(addDays(parseYmd(s), n));
}

/** 周一=1 … 周日=7 */
export function weekday(date) {
  return date.getDay() === 0 ? 7 : date.getDay();
}

export function startOfWeek(s) {
  return ymd(addDays(parseYmd(s), 1 - weekday(parseYmd(s))));
}

export function rangeDays(start, n) {
  return Array.from({ length: n }, (_, i) => addDaysYmd(start, i));
}

export function daysBetween(a, b) {
  return Math.round((parseYmd(b) - parseYmd(a)) / DAY_MS);
}

export function fmtMD(s) {
  const d = parseYmd(s);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export function fmtDot(s) {
  return s.slice(5).replace('-', '.');
}

/** '11.17 – 11.23'，跨月时写成 '11.30 – 12.6' */
export function fmtRange(a, b) {
  const [am, ad] = [parseYmd(a).getMonth() + 1, parseYmd(a).getDate()];
  const [bm, bd] = [parseYmd(b).getMonth() + 1, parseYmd(b).getDate()];
  return am === bm ? `${am}.${pad(ad)} – ${pad(bd)}` : `${am}.${pad(ad)} – ${bm}.${pad(bd)}`;
}

/** ISO 8601 周数：把日期挪到当周的周四，再看它是一年里第几个完整的 7 天 */
export function isoWeek(s) {
  const [y, m, d] = s.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date - yearStart) / DAY_MS + 1) / 7);
}

export function hhmm(date = new Date()) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function relativeDay(s, today = ymd()) {
  const diff = daysBetween(s, today);
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  return fmtMD(s);
}

export function monthKey(s) {
  return s.slice(0, 7);
}

/** 月历网格：返回覆盖该月所需的整周日期（周一起） */
export function monthGrid(monthKeyStr) {
  const [y, m] = monthKeyStr.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const start = addDays(first, 1 - weekday(first));
  const weeks = Math.ceil((daysBetween(ymd(start), ymd(new Date(y, m, 0))) + 1) / 7);
  return rangeDays(ymd(start), weeks * 7);
}

export function addMonths(monthKeyStr, n) {
  const [y, m] = monthKeyStr.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function greet(date = new Date()) {
  const h = date.getHours();
  if (h < 5) return '夜深了';
  if (h < 11) return '早上好';
  if (h < 13) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
}
