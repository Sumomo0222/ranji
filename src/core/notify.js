// 打卡提醒：应用打开时到点提醒（页面内 + 系统通知），以及导出到系统日历（关闭浏览器也能提醒）。
const WD_ISO = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const pad = (n) => String(n).padStart(2, '0');

function minutesOf(hhmmStr) {
  const [h, m] = String(hhmmStr).split(':').map(Number);
  return h * 60 + m;
}

function weekdayIdx(date) {
  return date.getDay() === 0 ? 6 : date.getDay() - 1;
}

/** 下一次触发的本地时间；提醒被禁用或没有生效日时返回 null */
export function nextFireTime(reminder, from = new Date()) {
  if (!reminder || reminder.enabled === false) return null;
  const days = Array.isArray(reminder.days) ? reminder.days : [];
  for (let i = 0; i < 8; i++) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    d.setDate(d.getDate() + i);
    const wd = weekdayIdx(d) + 1;
    if (!days.includes(wd)) continue;
    const [h, m] = String(reminder.time).split(':').map(Number);
    d.setHours(h, m, 0, 0);
    if (d > from) return d;
  }
  return null;
}

/**
 * 当前应当触发（且今天还没触发过）的提醒。
 * @param {Array} reminders 提醒列表
 * @param {Object} fired 每条提醒最近一次触发的日期
 * @param {Date} now
 * @param {{lookbackMs?: number}} opts 往前回看的时间窗口，默认 90 秒；页面刚回到前台时可以放宽到几小时，补发错过的提醒
 */
export function dueReminders(reminders, fired, now = new Date(), { lookbackMs = 90 * 1000 } = {}) {
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const out = [];
  for (const r of reminders || []) {
    if (r.enabled === false || fired?.[r.id] === today) continue;
    // 回看窗口内有过一次触发时间，且下一次触发还没到：说明这条提醒错过或正处在触发窗口内
    const prev = nextFireTime(r, new Date(now.getTime() - lookbackMs));
    const prevDay = prev ? `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}-${pad(prev.getDate())}` : null;
    // 只补发今天错过的；昨天没提醒到的不算
    if (prev && prev <= now && prevDay === today) {
      const next = nextFireTime(r, now);
      if (!next || next > now) out.push({ reminder: r, at: prev });
    }
  }
  return out;
}

/** 'unsupported'：浏览器不支持；'ios-standalone'：iOS 需要先添加到主屏幕；'default' | 'granted' | 'denied'：当前授权状态 */
export function notificationStatus() {
  if (typeof Notification === 'undefined') {
    const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    return iOS ? 'ios-standalone' : 'unsupported';
  }
  return Notification.permission;
}

export async function requestNotificationPermission() {
  const status = notificationStatus();
  if (status !== 'default') return status;
  try {
    return await Notification.requestPermission();
  } catch (err) {
    return 'denied';
  }
}

export function showNotification(title, body, tag = 'ranji-reminder') {
  if (notificationStatus() !== 'granted') return false;
  try {
    const n = new Notification(title, { body, tag, icon: new URL('./icons/icon-192.png', document.baseURI).href, lang: 'zh-CN' });
    n.onclick = () => {
      window.focus();
      n.close();
    };
    return true;
  } catch (err) {
    return false;
  }
}

export function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
}

const icsEscape = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

function icsTime(d) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
}

/** 生成 .ics 日历文件：每条提醒对应一个按周重复、带闹钟的事件 */
export function buildIcs(reminders, now = new Date()) {
  const list = (reminders || []).filter((r) => r.enabled !== false && Array.isArray(r.days) && r.days.length);
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}00Z`;
  const events = list.map((r) => {
    const start = nextFireTime(r, now);
    if (!start) return '';
    const days = [...r.days].sort((a, b) => a - b).map((d) => WD_ISO[d - 1]);
    const weekly = days.length === 7 ? 'FREQ=DAILY' : 'FREQ=WEEKLY;BYDAY=' + days.join(',');
    const end = new Date(start.getTime() + 15 * 60000);
    return [
      'BEGIN:VEVENT',
      `UID:ranji-${r.id}@ranji.app`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsTime(start)}`,
      `DTEND:${icsTime(end)}`,
      `RRULE:${weekly}`,
      `SUMMARY:${icsEscape(r.label || '燃记打卡')}`,
      'DESCRIPTION:' + icsEscape('来自「燃记」的打卡提醒。打开燃记，记录今天的饮食与运动。'),
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:' + icsEscape(`${r.label || '打卡提醒'} · 燃记`),
      'TRIGGER:PT0S',
      'END:VALARM',
      'END:VEVENT',
    ].join('\r\n');
  });
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Ranji//Check-in Reminder//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:燃记打卡提醒',
    ...events,
    'END:VCALENDAR',
  ].join('\r\n');
}

export function downloadText(text, name, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** iOS Safari 不认 download 属性，但会直接把 data: 协议的 .ics 交给日历打开 */
function calendarDataUrl(text) {
  return 'data:text/calendar;charset=utf-8,' + encodeURIComponent(text);
}

/** mode: 'open' 尝试直接交给系统日历；'download' 下载 .ics 文件 */
export function openCalendar(text, mode = 'open', name = 'ranji-reminder.ics') {
  const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const a = document.createElement('a');
  a.rel = 'noopener';
  if (mode === 'open' && iOS) {
    a.href = calendarDataUrl(text);
    a.target = '_blank';
  } else {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
    a.href = url;
    a.download = name;
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  document.body.appendChild(a);
  a.click();
  a.remove();
}
