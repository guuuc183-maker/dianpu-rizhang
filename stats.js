// 统计与汇总：按日 / 按周（ISO 周，周一开始）/ 按月 / 按年
// 记录格式：{ '2026-10-12': { cash, card, note, by } }
import { holiday } from './holidays.js';
export { holiday };
let ALL = {};
export function setRecords(all) { ALL = all || {}; }
export function getAll() { return ALL; }

export const pad = n => (n < 10 ? '0' : '') + n;
export function parse(s) { const p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
export function fmt(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
export function addDays(s, n) { const d = parse(s); d.setDate(d.getDate() + n); return fmt(d); }
export function today() { return fmt(new Date()); }
export function money(n) { return (Math.round((Number(n) || 0) * 100) / 100).toFixed(2); }
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
export function weekday(s) { return WEEK[parse(s).getDay()]; }
export function total(r) { return r ? (r.cash || 0) + (r.card || 0) : 0; }
const round = n => Math.round(n * 100) / 100;
function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }
function lastYear(s) { return (+s.slice(0, 4) - 1) + s.slice(4); }

export function isoWeek(d) {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  t.setDate(t.getDate() - (t.getDay() + 6) % 7 + 3);
  const jan4 = new Date(t.getFullYear(), 0, 4);
  const mon1 = new Date(jan4); mon1.setDate(jan4.getDate() - (jan4.getDay() + 6) % 7);
  return { year: t.getFullYear(), week: 1 + Math.round((t - mon1) / 86400000 / 7 - 3 / 7) };
}
function weekMonday(y, w) {
  const jan4 = new Date(y, 0, 4);
  const d = new Date(jan4); d.setDate(jan4.getDate() - (jan4.getDay() + 6) % 7 + (w - 1) * 7);
  return d;
}
function weeksInYear(y) { return isoWeek(new Date(y, 11, 28)).week; }

function sumBetween(start, end) {
  let s = 0;
  for (const k in ALL) if (k >= start && k <= end) s += total(ALL[k]);
  return round(s);
}

// 本周（周一起）到 date 为止 vs 上周同期
export function weekVsLast(date) {
  const wd = (parse(date).getDay() + 6) % 7, mon = addDays(date, -wd);
  const cur = sumBetween(mon, date), prev = sumBetween(addDays(mon, -7), addDays(date, -7));
  return { cur, prev, pct: pct(cur, prev), days: wd + 1, isSun: wd === 6 };
}
export function pct(cur, prev) {
  if (!prev) return '';
  const p = Math.round((cur - prev) / prev * 100);
  return (p >= 0 ? '+' : '') + p + '%';
}

export function byDay(month) {
  const y = +month.slice(0, 4), m = +month.slice(5, 7);
  const n = daysInMonth(y, m), ln = daysInMonth(y - 1, m);
  const lm = (y - 1) + '-' + pad(m);
  const labels = [], values = [], compare = [], titles = [], marks = [];
  for (let d = 1; d <= n; d++) {
    const k = month + '-' + pad(d);
    labels.push(String(d));
    values.push(round(total(ALL[k])));
    compare.push(d <= ln ? round(total(ALL[lm + '-' + pad(d)])) : 0);
    const hd = holiday(k);
    titles.push(m + '月' + d + '日 ' + weekday(k) + (hd ? ' · ' + hd : ''));
    marks.push(!!hd);
  }
  const t = today();
  const isNow = month === t.slice(0, 7);
  const end = isNow ? t : month + '-' + pad(n);
  const cur = sumBetween(month + '-01', end);
  const prev = sumBetween(lastYear(month + '-01'), lastYear(end));
  return { labels, values, compare, titles, marks, cur, prev, pct: pct(cur, prev), focus: isNow ? +t.slice(8) - 1 : -1, isNow };
}

export function byWeek(year) {
  const map = {};
  for (const k in ALL) {
    const w = isoWeek(parse(k));
    const key = w.year + '-' + w.week;
    map[key] = (map[key] || 0) + total(ALL[k]);
  }
  const n = weeksInYear(year);
  const labels = [], values = [], compare = [], titles = [];
  for (let w = 1; w <= n; w++) {
    const mon = weekMonday(year, w);
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    labels.push(String(w));
    values.push(round(map[year + '-' + w] || 0));
    compare.push(round(map[(year - 1) + '-' + w] || 0));
    titles.push('第' + w + '周 ' + (mon.getMonth() + 1) + '/' + mon.getDate() + '–' + (sun.getMonth() + 1) + '/' + sun.getDate());
  }
  const now = isoWeek(new Date());
  return Object.assign({ labels, values, compare, titles, focus: now.year === year ? now.week - 1 : -1 }, ytd(year));
}

export function byMonth(year) {
  const values = new Array(12).fill(0), compare = new Array(12).fill(0);
  for (const k in ALL) {
    const y = +k.slice(0, 4), m = +k.slice(5, 7) - 1;
    if (y === year) values[m] += total(ALL[k]);
    if (y === year - 1) compare[m] += total(ALL[k]);
  }
  const labels = [], titles = [];
  for (let i = 1; i <= 12; i++) { labels.push(i + '月'); titles.push(year + '年' + i + '月'); }
  const t = today();
  return Object.assign({ labels, values: values.map(round), compare: compare.map(round), titles,
    focus: +t.slice(0, 4) === year ? +t.slice(5, 7) - 1 : -1 }, ytd(year));
}

function ytd(year) {
  const t = today();
  const isNow = +t.slice(0, 4) === year;
  const end = isNow ? t : year + '-12-31';
  const cur = sumBetween(year + '-01-01', end);
  const prev = sumBetween((year - 1) + '-01-01', lastYear(end));
  return { cur, prev, pct: pct(cur, prev), isNow };
}

export function byYear() {
  const map = {};
  for (const k in ALL) { const y = k.slice(0, 4); map[y] = (map[y] || 0) + total(ALL[k]); }
  const now = +today().slice(0, 4);
  const ys = Object.keys(map).map(Number);
  const first = ys.length ? Math.min(...ys) : now;
  const labels = [], values = [], titles = [];
  for (let y = first; y <= now; y++) { labels.push(String(y)); values.push(round(map[y] || 0)); titles.push(y + (y === now ? '年至今' : '年全年')); }
  return { labels, values, titles };
}

export function firstYear() {
  const ks = Object.keys(ALL).sort();
  return ks.length ? +ks[0].slice(0, 4) : +today().slice(0, 4);
}

export function lastYearToday(date) {
  let lyDate = lastYear(date);
  if (date.slice(5) === '02-29') lyDate = lyDate.slice(0, 5) + '02-28';
  const lw = addDays(date, -364);
  return {
    lyDate, lyWeekday: weekday(lyDate),
    lyTotal: ALL[lyDate] ? round(total(ALL[lyDate])) : null,
    lwDate: lw, lwWeekday: weekday(lw),
    lwTotal: ALL[lw] ? round(total(ALL[lw])) : null
  };
}

export function listMonth(month) {
  return Object.keys(ALL).filter(d => d.startsWith(month)).sort().reverse().map(d => Object.assign({ date: d }, ALL[d]));
}

// 星期分析：某一年里，周一到周日各自的日均营业额（只算有记录的天）
const WD = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
export function byWeekday(year) {
  const sum = [[0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0]], cnt = [[0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0]];
  for (const k in ALL) {
    const y = +k.slice(0, 4);
    const i = y === year ? 0 : y === year - 1 ? 1 : -1;
    if (i < 0) continue;
    if (ALL[k].closed) continue; // 休息日不算进日均
    const w = (parse(k).getDay() + 6) % 7;
    sum[i][w] += total(ALL[k]); cnt[i][w]++;
  }
  const avg = i => sum[i].map((s, w) => cnt[i][w] ? round(s / cnt[i][w]) : 0);
  const values = avg(0), compare = avg(1);
  let best = -1;
  values.forEach((v, i) => { if (best < 0 || v > values[best]) best = i; });
  return {
    labels: WD.slice(), values, compare,
    titles: WD.map((w, i) => w + '日均（' + cnt[0][i] + '天）'),
    best: values[best] > 0 ? WD[best] : '', counts: cnt[0]
  };
}

// 多家店合计：把几家店的记录按日期加在一起
export function mergeShops(maps) {
  const out = {};
  maps.forEach(m => {
    for (const k in m) {
      const r = m[k];
      if (!out[k]) out[k] = { cash: 0, card: 0, note: '', by: '', closed: !!r.closed };
      else out[k].closed = out[k].closed && !!r.closed;
      out[k].cash = round(out[k].cash + r.cash);
      out[k].card = round(out[k].card + r.card);
    }
  });
  return out;
}

// 按月汇总（导出用）
export function monthly() {
  const m = {};
  for (const k in ALL) {
    const ym = k.slice(0, 7);
    if (!m[ym]) m[ym] = { cash: 0, card: 0, days: 0 };
    m[ym].cash += ALL[k].cash || 0; m[ym].card += ALL[k].card || 0; if (!ALL[k].closed) m[ym].days++;
  }
  return Object.keys(m).sort().map(ym => ({ ym, cash: round(m[ym].cash), card: round(m[ym].card), days: m[ym].days }));
}

// 这个月 vs 去年这个月：本月至今、去年同期（同样天数）、去年整月
export function monthVsLastYear(month) {
  const y = +month.slice(0, 4), m = +month.slice(5, 7);
  const n = daysInMonth(y, m);
  const t = today();
  const isNow = month === t.slice(0, 7);
  const end = isNow ? t : month + '-' + pad(n);
  const lm = (y - 1) + '-' + pad(m);
  const cur = sumBetween(month + '-01', end);
  const prevSame = sumBetween(lm + '-01', lastYear(end));
  const prevFull = sumBetween(lm + '-01', lm + '-' + pad(daysInMonth(y - 1, m)));
  const days = Object.keys(ALL).filter(k => k >= month + '-01' && k <= end && !ALL[k].closed).length;
  return { cur, prevSame, prevFull, pct: pct(cur, prevSame), isNow, m, y, days,
           remain: isNow ? round(prevFull - cur) : 0 };
}
