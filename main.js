import * as S from './stats.js';
import { BarChart } from './chart.js';
import { buildXlsx } from './xlsx.js';
import * as db from './db.js';

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => parseFloat(String(v || '').replace(/\s/g, '').replace(',', '.')) || 0;
const pad = n => (n < 10 ? '0' : '') + n;
const int = n => Math.round(Number(n) || 0).toLocaleString('en-US');
const f2 = n => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const initial = s => (String(s || '').trim()[0] || '?').toUpperCase();
function hm(t) { const d = new Date(t); return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }

// ---------- 状态 ----------
let user = null;
let mine = { shopIds: [], current: null };
const shops = {};        // 店铺 id → 店铺资料
const shopUnsub = {};    // 店铺 id → 取消监听
const recs = {};         // 店铺 id → { 日期: 记录 }
const recUnsub = {};     // 店铺 id → { mode, fn }
const metas = {};        // 店铺 id → 同步状态
let cur = null, inApp = false;
let dayLogUnsub = null, recentUnsub = null;

const roleOf = id => {
  const s = shops[id];
  if (!s || !user) return 'staff';
  if (s.owner === user.uid) return 'owner';
  return (s.members && s.members[user.uid] && s.members[user.uid].role) || 'manager';
};
const isFull = id => roleOf(id) !== 'staff';
const ROLE_TEXT = { owner: '店主', manager: '管理员', staff: '店员' };
const myName = () => { const s = shops[cur]; return (s && s.members && s.members[user.uid] && s.members[user.uid].name) || ''; };
const fullShops = () => mine.shopIds.filter(id => shops[id] && isFull(id));

// ---------- 通用 ----------
let toastTimer;
function toast(msg, ms = 2000) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
function show(name) {
  ['loading', 'config', 'login', 'setup', 'app'].forEach(n => { $('s-' + n).hidden = n !== name; });
  window.scrollTo(0, 0);
}
function errText(e) {
  const map = {
    'auth/invalid-credential': '邮箱或密码不对', 'auth/wrong-password': '邮箱或密码不对',
    'auth/user-not-found': '这个邮箱还没注册', 'auth/email-already-in-use': '这个邮箱已经注册过，直接登录就行',
    'auth/weak-password': '密码至少 6 位', 'auth/invalid-email': '邮箱格式不对', 'auth/missing-password': '请输入密码',
    'auth/too-many-requests': '尝试次数太多，请稍后再试', 'auth/network-request-failed': '网络不通，请检查网络',
    'auth/unauthorized-domain': '这个网址还没加到 Firebase 的授权域名里', 'auth/popup-closed-by-user': '', 'auth/cancelled-popup-request': '',
    'permission-denied': '没有权限（店员只能记今天和昨天）', 'unavailable': '网络不通，请检查网络'
  };
  const c = (e && e.code) || '';
  if (c in map) return map[c];
  return (e && e.message) || String(e);
}

// ---------- 启动 ----------
function start() {
  if (!db.configured()) { show('config'); return; }
  db.init();
  db.onUser(async u => {
    resetAll();
    user = u;
    if (!u) { show('login'); return; }
    try {
      mine = await db.getMyShops(u.uid);
      mine.shopIds.forEach(watchShopDoc);
      if (mine.current) enterShop(mine.current); else showSetup();
    } catch (e) {
      toast('读取失败：' + errText(e)); showSetup();
    }
  });
}

function resetAll() {
  Object.keys(shopUnsub).forEach(id => { shopUnsub[id](); delete shopUnsub[id]; delete shops[id]; });
  Object.keys(recUnsub).forEach(detachRecords);
  if (dayLogUnsub) dayLogUnsub(); if (recentUnsub) recentUnsub();
  dayLogUnsub = recentUnsub = null;
  cur = null; inApp = false; mine = { shopIds: [], current: null };
  S.setRecords({});
}

// 监听店铺资料（名字、成员、角色）
function watchShopDoc(id) {
  if (shopUnsub[id]) return;
  shopUnsub[id] = db.watchShop(id, s => {
    if (!s.memberIds || !s.memberIds.includes(user.uid)) { removedFrom(id); return; }
    const before = shops[id] ? roleOf(id) : null;
    shops[id] = s;
    if (id === cur) {
      if (before !== roleOf(id)) attachRecords(id);
      if (!inApp) { inApp = true; show('app'); setDate(entry.date || S.today()); }
      applyRole(); renderHeader(); renderShop();
    }
    if (view === 'charts' && charts.scope === 'all') renderCharts();
  }, e => {
    if (e && (e.code === 'permission-denied' || e.code === 'not-found')) removedFrom(id);
  });
}

function removedFrom(id) {
  const name = shops[id] ? shops[id].name : '';
  if (shopUnsub[id]) { shopUnsub[id](); delete shopUnsub[id]; }
  detachRecords(id);
  delete shops[id]; delete recs[id];
  mine.shopIds = mine.shopIds.filter(x => x !== id);
  db.forgetShop(user.uid, id);
  if (id === cur) {
    toast('你已不在' + (name ? '「' + name + '」' : '这个店铺'), 3000);
    cur = null; inApp = false;
    if (mine.shopIds.length) enterShop(mine.shopIds[0]); else showSetup();
  }
}

function enterShop(id) {
  if (dayLogUnsub) { dayLogUnsub(); dayLogUnsub = null; }
  if (recentUnsub) { recentUnsub(); recentUnsub = null; }
  if (cur && cur !== id) {
    // 换店：只保留新店的记录监听（合计模式需要时再挂）
    Object.keys(recUnsub).forEach(detachRecords);
    charts.scope = 'shop';
  }
  cur = id;
  if (!mine.shopIds.includes(id)) mine.shopIds.push(id);
  if (mine.current !== id) { mine.current = id; db.setCurrent(user.uid, id).catch(() => {}); }
  watchShopDoc(id);
  if (shops[id]) {
    attachRecords(id);
    inApp = true; show('app'); applyRole(); renderHeader(); renderShop();
    setDate(S.today());
  } else {
    inApp = false; // 等店铺资料到了再显示
  }
}

// 管理员/店主：监听整家店；店员：只监听今天和昨天
function attachRecords(id) {
  const mode = isFull(id) ? 'full' : 'staff';
  if (recUnsub[id] && recUnsub[id].mode === mode) return;
  detachRecords(id);
  const onData = (map, m) => { recs[id] = map; metas[id] = m; onRecords(id); };
  const fn = mode === 'full'
    ? db.watchRecords(id, onData, () => {})
    : db.watchDays(id, [S.addDays(S.today(), -1), S.today()], onData, () => {});
  recUnsub[id] = { mode, fn };
}
function detachRecords(id) {
  if (recUnsub[id]) { recUnsub[id].fn(); delete recUnsub[id]; }
}

// ---------- 登录 ----------
let registerMode = false;
$('btn-google').onclick = () => db.loginGoogle().catch(e => { const t = errText(e); if (t) toast(t, 3000); });
$('lnk-register').onclick = () => {
  registerMode = !registerMode;
  $('btn-login').textContent = registerMode ? '注册并登录' : '登录';
  $('lnk-register').textContent = registerMode ? '已有账号？登录' : '没有账号？注册';
  $('in-pw').autocomplete = registerMode ? 'new-password' : 'current-password';
};
$('btn-login').onclick = async () => {
  const email = $('in-email').value, pw = $('in-pw').value;
  if (!email.trim()) { toast('请输入邮箱'); return; }
  const b = $('btn-login'); b.disabled = true;
  try { await (registerMode ? db.registerEmail(email, pw) : db.loginEmail(email, pw)); }
  catch (e) { toast(errText(e), 3000); }
  b.disabled = false;
};
$('lnk-forgot').onclick = async () => {
  const email = $('in-email').value.trim();
  if (!email) { toast('先在上面填你的邮箱'); return; }
  try { await db.resetPassword(email); toast('重置密码邮件已发送，请查收（也看看垃圾邮件）', 3500); }
  catch (e) { toast(errText(e), 3000); }
};

// ---------- 创建 / 加入 ----------
let setupMode = 'create';
function showSetup() {
  $('setup-email').textContent = user.email || '';
  $('setup-back').hidden = !mine.shopIds.length;
  $('in-shopname').value = ''; $('in-code').value = '';
  show('setup');
}
$('setup-back').onclick = () => { if (cur) { show('app'); } else if (mine.shopIds.length) enterShop(mine.shopIds[0]); };
$('setup-seg').onclick = e => {
  const m = e.target.dataset.m; if (!m) return;
  setupMode = m;
  [...$('setup-seg').children].forEach(b => b.classList.toggle('on', b.dataset.m === m));
  $('f-shopname').hidden = m !== 'create';
  $('f-code').hidden = m !== 'join';
  $('btn-setup').textContent = m === 'create' ? '创建店铺' : '加入店铺';
};
$('btn-setup').onclick = async () => {
  const name = $('in-myname').value.trim();
  if (!name) { toast('请填写你的名字'); return; }
  if (!navigator.onLine) { toast('需要联网才能创建或加入店铺'); return; }
  const b = $('btn-setup'); b.disabled = true;
  try {
    let sid;
    if (setupMode === 'create') {
      const sn = $('in-shopname').value.trim();
      if (!sn) { toast('请填写店名'); b.disabled = false; return; }
      sid = await db.createShop(user.uid, sn, name);
    } else {
      const code = $('in-code').value.trim().toUpperCase();
      if (code.length !== 6) { toast('邀请码是 6 位'); b.disabled = false; return; }
      if (mine.shopIds.some(id => shops[id] && shops[id].code === code)) { toast('你已经在这家店了'); b.disabled = false; return; }
      sid = await db.joinShop(user.uid, code, name);
    }
    enterShop(sid);
  } catch (e) {
    toast(e.code === 'permission-denied' ? '加入失败：邀请码不对或已更换' : errText(e), 3000);
  }
  b.disabled = false;
};
$('lnk-logout1').onclick = () => db.logout();

// ---------- 切换店铺 ----------
function openSheet() {
  $('sheet-list').innerHTML = mine.shopIds.map(id => {
    const s = shops[id];
    return `<div class="shop-item${id === cur ? ' on' : ''}" data-id="${esc(id)}">
      <span>${esc(s ? s.name : '…')}<span class="tag me">${ROLE_TEXT[roleOf(id)]}</span></span>${id === cur ? '✓' : '›'}</div>`;
  }).join('');
  $('sheet').hidden = false;
}
$('hdr-shop').onclick = openSheet;
$('btn-switch').onclick = openSheet;
$('sheet-close').onclick = () => { $('sheet').hidden = true; };
document.querySelector('.sheet-bg').onclick = () => { $('sheet').hidden = true; };
$('sheet-list').onclick = e => {
  const it = e.target.closest('.shop-item'); if (!it) return;
  $('sheet').hidden = true;
  if (it.dataset.id !== cur) { enterShop(it.dataset.id); go('entry'); }
};
$('sheet-new').onclick = () => { $('sheet').hidden = true; showSetup(); };

// ---------- 角色 ----------
function applyRole() {
  const staff = !isFull(cur);
  document.body.classList.toggle('staff', staff);
  if (staff && view === 'charts') go('entry');
  const t = S.today();
  $('in-date').max = t;
  $('in-date').min = staff ? S.addDays(t, -1) : '';
  if (staff && entry.date && entry.date < S.addDays(t, -1)) setDate(t);
  $('scope-seg').hidden = fullShops().length < 2;
}

// ---------- 底部导航 ----------
let view = 'entry';
document.querySelector('.tabbar').onclick = e => { const b = e.target.closest('button'); if (b) go(b.dataset.v); };
function go(v) {
  if (v === 'charts' && !isFull(cur)) v = 'entry';
  view = v;
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  ['entry', 'charts', 'shop'].forEach(n => { $('v-' + n).hidden = n !== v; });
  window.scrollTo(0, 0);
  if (v === 'charts') renderCharts();
  if (v === 'shop') renderShop();
}

// ---------- 同步状态 ----------
function syncState() {
  const m = metas[cur] || { pending: false, fromCache: true };
  if (!navigator.onLine) return { t: '离线', c: 'warn' };
  if (m.pending) return { t: '同步中', c: 'warn' };
  if (m.fromCache) return { t: '连接中', c: '' };
  return { t: '已同步', c: 'ok' };
}
function renderHeader() {
  if (!shops[cur]) return;
  $('hdr-shop-name').textContent = shops[cur].name;
  $('hdr-caret').hidden = false;
  const s = syncState();
  $('hdr-sync').className = 'syncdot ' + s.c;
  $('hdr-sync').title = s.t;
  $('me-initial').textContent = initial(myName());
  $('sh-sync').textContent = s.t;
}
window.addEventListener('online', renderHeader);
window.addEventListener('offline', renderHeader);

function onRecords(id) {
  if (id === cur) {
    renderHeader();
    if (!entry.editing) fillForm();
    renderEntryInfo();
    $('sh-count').textContent = Object.keys(recs[cur] || {}).length + ' 天';
  }
  if (view === 'charts' && (id === cur || charts.scope === 'all')) renderCharts();
}
const curRecs = () => recs[cur] || {};
const useShopData = () => S.setRecords(curRecs());

// ---------- 记账 ----------
const entry = { date: '', editing: false };
let logOpen = false;
$('log-toggle').onclick = () => {
  logOpen = !logOpen;
  $('card-log').hidden = !logOpen;
  $('log-toggle').textContent = $('log-toggle').textContent.replace(/[▾▴]$/, logOpen ? '▴' : '▾');
};
// 回车跳到下一个输入框
$('in-cash').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('in-card').focus(); } });
$('in-card').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('in-note').focus(); } });
$('in-note').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('btn-save').click(); } });
function setDate(d) {
  entry.date = d; entry.editing = false;
  $('in-date').value = d;
  fillForm(); renderEntryInfo();
  if (dayLogUnsub) { dayLogUnsub(); dayLogUnsub = null; }
  logOpen = false;
  $('card-log').hidden = true; $('log-toggle').hidden = true;
  if (cur && isFull(cur)) {
    dayLogUnsub = db.watchDayLogs(cur, d, logs => {
      $('log-toggle').hidden = !logs.length;
      $('log-toggle').textContent = '修改记录（' + logs.length + '）' + (logOpen ? ' ▴' : ' ▾');
      $('day-logs').innerHTML = logs.map(logHtml).join('');
    });
  }
}
function logHtml(l, withDate) {
  const what = l.action === 'delete'
    ? '<span class="del">删除了</span>'
    : '现金 ' + S.money(l.cash) + ' · 刷卡 ' + S.money(l.card) + (l.note ? ' · ' + esc(l.note) : '');
  return `<div class="log"><span>${withDate ? '<b>' + esc(l.date.slice(5)) + '</b> ' : ''}${what}</span><span class="who">${esc(l.by)} · ${hm(l.at)}</span></div>`;
}
function fillForm() {
  const r = curRecs()[entry.date];
  $('in-cash').value = r ? String(r.cash) : '';
  $('in-card').value = r ? String(r.card) : '';
  $('in-note').value = r ? r.note : '';
  calc();
}
function renderEntryInfo() {
  const d = entry.date; if (!d || !cur) return;
  useShopData();
  const t = S.today();
  $('d-text').textContent = d + ' ' + S.weekday(d) + (d === t ? '（今天）' : '');
  $('d-next').disabled = d >= t;
  $('d-prev').disabled = !isFull(cur) && d <= S.addDays(t, -1);
  const hd = S.holiday(d);
  $('d-holiday').hidden = !hd;
  $('d-holiday').textContent = '🎉 ' + hd;
  const r = curRecs()[d];
  $('d-status').textContent = r ? '已记录 · ' + (r.by ? r.by + ' · ' : '') + hm(r.at) : '还没记录';
  $('btn-del').hidden = !r;
  if (isFull(cur)) {
    const mv = S.monthVsLastYear(d.slice(0, 7));
    $('mo-cur-t').textContent = mv.m + '月' + (mv.isNow ? '至今' : '合计');
    renderRecent();
    $('mo-cur').textContent = f2(mv.cur);
    $('mo-pct').textContent = mv.pct;
    $('mo-pct').className = 'pct ' + (mv.cur < mv.prevSame ? 'down' : 'up');
    $('mo-sub').textContent = '去年' + (mv.isNow ? '同期 ' + int(mv.prevSame) + ' · 全月 ' : '全月 ') + int(mv.prevFull);
  }
  calc();
}
function calc() {
  const tot = num($('in-cash').value) + num($('in-card').value);
  $('t-total').textContent = f2(tot);
  if (!cur || !isFull(cur)) return;
  useShopData();
  const ly = S.lastYearToday(entry.date);
  const lyh = S.holiday(ly.lyDate), lwh = S.holiday(ly.lwDate);
  $('ly-date').textContent = '去年今天';
  $('ly-sub').textContent = ly.lyDate + ' ' + ly.lyWeekday + (lyh ? ' · ' + lyh.split(' ')[0] : '');
  $('lw-date').textContent = '去年同一个' + ly.lwWeekday;
  $('lw-sub').textContent = ly.lwDate + (lwh ? ' · ' + lwh.split(' ')[0] : '');
  const vc = $('vs-chip');
  vc.hidden = !(ly.lyTotal && tot);
  if (!vc.hidden) {
    const p = S.pct(tot, ly.lyTotal);
    vc.textContent = '比去年今天 ' + p;
    vc.className = 'chip ' + (tot < ly.lyTotal ? 'down' : 'up');
  }
  const put = (id, val) => {
    $(id + '-val').textContent = val === null ? '—' : f2(val);
    const p = $(id + '-pct');
    p.textContent = val && tot ? S.pct(tot, val) : '';
    p.className = 'pct ' + (tot < val ? 'down' : 'up');
  };
  put('ly', ly.lyTotal); put('lw', ly.lwTotal);
}
['in-cash', 'in-card', 'in-note'].forEach(id => $(id).addEventListener('input', () => { entry.editing = true; calc(); }));
$('in-date').onchange = e => {
  let v = e.target.value; if (!v) return;
  const t = S.today();
  if (v > t) v = t;
  if (!isFull(cur) && v < S.addDays(t, -1)) { toast('店员只能记今天和昨天'); v = t; }
  setDate(v);
};
$('d-prev').onclick = () => setDate(S.addDays(entry.date, -1));
$('d-next').onclick = () => { if (entry.date < S.today()) setDate(S.addDays(entry.date, 1)); };
const me = () => ({ uid: user.uid, name: myName() });
function dayHtml(r) {
  const hd = S.holiday(r.date);
  const md = +r.date.slice(5, 7) + '月' + (+r.date.slice(8)) + '日';
  return `<div class="day" data-date="${r.date}">
    <div class="dnum${hd ? ' hd' : ''}"><b>${+r.date.slice(8)}</b><span>${S.weekday(r.date)}</span></div>
    <div class="grow"><b>${md}${hd ? '<span class="hol">' + esc(hd.split(' ')[0]) + '</span>' : ''}</b>
      <small>现金 ${f2(r.cash)} · 刷卡 ${f2(r.card)}${r.note ? ' · ' + esc(r.note) : ''}</small></div>
    <div class="amt2">${f2(S.total(r))}</div></div>`;
}
function renderRecent() {
  const m = curRecs();
  const days = Object.keys(m).sort().reverse().slice(0, 5).map(d => Object.assign({ date: d }, m[d]));
  $('recent-card').hidden = !days.length;
  $('recent-days').innerHTML = days.map(dayHtml).join('');
}
$('recent-days').onclick = e => { const it = e.target.closest('.day'); if (it) { setDate(it.dataset.date); window.scrollTo({ top: 0, behavior: 'smooth' }); } };
$('see-all').onclick = () => go('charts');
$('go-shop').onclick = () => go('shop');
window.addEventListener('scroll', () => document.querySelector('.topnav').classList.toggle('scrolled', window.scrollY > 8), { passive: true });
$('btn-save').onclick = () => {
  const cash = num($('in-cash').value), card = num($('in-card').value);
  if (cash === 0 && card === 0) { toast('请输入金额'); return; }
  db.saveRecord(cur, entry.date, { cash, card, note: $('in-note').value.trim() }, me())
    .catch(e => toast('保存失败：' + errText(e), 3000));
  entry.editing = false;
  document.activeElement && document.activeElement.blur();
  toast(navigator.onLine ? '已保存 ✓' : '已存本机，有网后自动同步', 1500);
};
$('btn-del').onclick = () => {
  if (!confirm('确定删除 ' + entry.date + ' 的营业额？所有手机都会删除（会留下删除记录）。')) return;
  db.deleteRecord(cur, entry.date, curRecs()[entry.date], me()).catch(e => toast('删除失败：' + errText(e), 3000));
  entry.editing = false;
  toast('已删除');
};

// ---------- 图表 ----------
const charts = { tab: 'day', scope: 'shop', month: S.today().slice(0, 7), year: +S.today().slice(0, 4) };
const mainChart = new BarChart($('chart-main'), { height: 220 });
const wdChart = new BarChart($('chart-wd'), { height: 180 });
$('in-month').value = charts.month;
$('in-month').max = charts.month;

function useScopeData() {
  if (charts.scope === 'all') {
    fullShops().forEach(attachRecords);
    S.setRecords(S.mergeShops(fullShops().map(id => recs[id] || {})));
  } else useShopData();
}
$('scope-seg').onclick = e => {
  const s = e.target.dataset.s; if (!s) return;
  charts.scope = s;
  [...$('scope-seg').children].forEach(b => b.classList.toggle('on', b.dataset.s === s));
  renderCharts();
};
$('chart-seg').onclick = e => {
  const t = e.target.dataset.t; if (!t) return;
  charts.tab = t;
  [...$('chart-seg').children].forEach(b => b.classList.toggle('on', b.dataset.t === t));
  renderCharts();
};
$('in-month').onchange = e => { if (e.target.value) { charts.month = e.target.value; renderCharts(); } };
$('in-year').onchange = e => { charts.year = +e.target.value; renderCharts(); };

function setSum(curT, curV, prevT, prevV, pctV, down, note) {
  $('sum-cur-t').textContent = curT; $('sum-cur').textContent = f2(parseFloat(curV));
  $('sum-prev-t').textContent = prevT; $('sum-prev').textContent = f2(parseFloat(prevV));
  $('sum-pct').textContent = pctV || '—'; $('sum-pct').className = 'pct big ' + (pctV ? (down ? 'down' : 'up') : '');
  $('sum-note').textContent = note || '';
}
function renderMvs(month) {
  const mv = S.monthVsLastYear(month);
  $('card-mvs').hidden = false;
  $('mvs-title').textContent = mv.m + '月 vs 去年' + mv.m + '月';
  $('mvs-cur-t').textContent = mv.y + '年' + mv.m + '月' + (mv.isNow ? '至今' : '');
  $('mvs-cur').textContent = S.money(mv.cur) + ' lei';
  $('mvs-same-t').textContent = (mv.y - 1) + '年' + mv.m + '月' + (mv.isNow ? '同期' : '');
  $('mvs-same').textContent = S.money(mv.prevSame) + ' lei';
  $('mvs-pct').textContent = mv.pct; $('mvs-pct').className = 'pct ' + (mv.cur < mv.prevSame ? 'down' : 'up');
  $('mvs-full-t').textContent = (mv.y - 1) + '年' + mv.m + '月全月';
  $('mvs-full').textContent = S.money(mv.prevFull) + ' lei';
}

function renderCharts() {
  if (!cur || !isFull(cur)) return;
  useScopeData();
  const { tab, month, year } = charts;
  const thisYear = +S.today().slice(0, 4);
  $('pick-month').hidden = tab !== 'day';
  $('pick-year').hidden = tab === 'day' || tab === 'year';
  const first = Math.min(S.firstYear(), thisYear);
  let opts = '';
  for (let y = thisYear; y >= first; y--) opts += `<option value="${y}"${y === year ? ' selected' : ''}>${y}</option>`;
  $('in-year').innerHTML = opts;
  $('month-text').textContent = +month.slice(0, 4) + '年' + +month.slice(5) + '月';
  $('year-text').textContent = year + '年';
  $('card-mvs').hidden = true;
  $('card-wd').hidden = tab !== 'week';
  const scopeName = charts.scope === 'all' ? '（全部店铺）' : '';
  let data, opt = { minGroup: 0, legendA: '今年', legendB: '去年' };

  if (tab === 'day') {
    data = S.byDay(month);
    const mv = S.monthVsLastYear(month);
    setSum(mv.isNow ? '至今' : '全月', S.money(mv.cur), '去年' + mv.m + '月' + (mv.isNow ? '同期' : ''), S.money(mv.prevSame),
      mv.pct, mv.cur < mv.prevSame, '去年' + mv.m + '月全月：' + S.money(mv.prevFull) + ' lei' + (mv.isNow && mv.remain > 0 ? '，还差 ' + S.money(mv.remain) + ' 追平' : ''));
    $('chart-title').textContent = '每天营业额' + scopeName + ' · 红点=节假日';
  } else if (tab === 'week' || tab === 'month') {
    data = tab === 'week' ? S.byWeek(year) : S.byMonth(year);
    setSum(data.isNow ? '至今' : '全年', S.money(data.cur), (year - 1) + '年' + (data.isNow ? '同期' : '全年'),
      S.money(data.prev), data.pct, data.cur < data.prev, '');
    $('chart-title').textContent = (tab === 'week' ? '每周营业额（左右滑动）' : '每月营业额') + scopeName;
    opt = { minGroup: tab === 'week' ? 26 : 0, legendA: year + '年', legendB: (year - 1) + '年' };
    if (tab === 'month') renderMvs(year === thisYear ? S.today().slice(0, 7) : year + '-12');
    if (tab === 'week') {
      const wd = S.byWeekday(year);
      const bi = wd.values.indexOf(Math.max(...wd.values));
      $('wd-note').textContent = wd.best
        ? year + '年生意最好的是' + wd.best + '，日均 ' + S.money(wd.values[bi]) + ' lei' + (wd.compare[bi] ? '（去年' + wd.labels[bi] + ' ' + S.money(wd.compare[bi]) + '）' : '') + '。可以用来排班和安排进货。'
        : '还没有足够的记录';
      wdChart.set(wd, { legendA: year + '年', legendB: (year - 1) + '年' });
    }
  } else if (tab === 'year') {
    const y = S.byMonth(thisYear);
    setSum(thisYear + '年至今', S.money(y.cur), (thisYear - 1) + '年同期', S.money(y.prev), y.pct, y.cur < y.prev, '');
    data = S.byYear();
    $('chart-title').textContent = '历年总营业额' + scopeName;
  }
  mainChart.set(data, opt);

  const showList = tab === 'day';
  $('day-list').hidden = !showList;
  $('list-name').textContent = showList ? '每天明细' : '导出数据';
  if (showList) {
    const list = S.listMonth(month);
    $('day-list').innerHTML = list.length ? list.map(dayHtml).join('') : '<div class="empty">这个月还没有记录</div>';
  }
}
$('day-list').onclick = e => {
  const it = e.target.closest('.day'); if (!it || charts.scope === 'all') return;
  setDate(it.dataset.date); go('entry');
};

// ---------- 导出 Excel ----------
function exportExcel(scope) {
  const ids = scope === 'all' ? fullShops() : [cur];
  if (scope === 'all') ids.forEach(attachRecords);
  const many = ids.length > 1;
  const head = (many ? ['店铺'] : []).concat(['日期', '星期', '节日', '现金', '刷卡', '合计', '备注', '记录人']);
  const rows = [head];
  ids.forEach(id => {
    const m = recs[id] || {};
    Object.keys(m).sort().forEach(k => {
      const r = m[k];
      rows.push((many ? [shops[id].name] : []).concat([k, S.weekday(k), S.holiday(k), r.cash, r.card, Math.round((r.cash + r.card) * 100) / 100, r.note, r.by]));
    });
  });
  if (rows.length === 1) { toast('还没有记录'); return; }
  S.setRecords(many ? S.mergeShops(ids.map(id => recs[id] || {})) : recs[cur] || {});
  const mrows = [['月份', '现金', '刷卡', '合计', '记录天数', '日均']].concat(S.monthly().map(m =>
    [m.ym, m.cash, m.card, Math.round((m.cash + m.card) * 100) / 100, m.days, Math.round((m.cash + m.card) / m.days * 100) / 100]));
  const years = [...new Set(S.monthly().map(m => +m.ym.slice(0, 4)))];
  const wrows = [['年份', '周一', '周二', '周三', '周四', '周五', '周六', '周日']].concat(years.map(y => [String(y)].concat(S.byWeekday(y).values)));
  const blob = buildXlsx([
    { name: '每日明细', cols: (many ? [16] : []).concat([12, 6, 18, 11, 11, 11, 20, 10]), rows },
    { name: '按月汇总', cols: [10, 12, 12, 12, 10, 11], rows: mrows },
    { name: '按星期日均', cols: [8, 10, 10, 10, 10, 10, 10, 10], rows: wrows }
  ]);
  const fname = '店铺日账_' + (many ? '全部店铺' : shops[cur].name.replace(/[\\/:*?"<>|]/g, '')) + '_' + S.today() + '.xlsx';
  const file = new File([blob], fname, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] }) && /iphone|ipad|android/i.test(navigator.userAgent)) {
    navigator.share({ files: [file], title: fname }).catch(() => {});
  } else {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = fname;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  if (view === 'charts') renderCharts();
}
$('btn-export').onclick = () => exportExcel(charts.scope);
$('btn-export2').onclick = () => exportExcel('shop');

// ---------- 店铺 ----------
function renderShop() {
  const s = shops[cur]; if (!s) return;
  const role = roleOf(cur), isOwner = role === 'owner';
  $('sh-name').textContent = s.name;
  $('sh-avatar').textContent = initial(s.name);
  $('lnk-rename').hidden = !isOwner;
  $('sh-role').textContent = '我是' + ROLE_TEXT[role] + (mine.shopIds.length > 1 ? ' · 共 ' + mine.shopIds.length + ' 家店' : '');
  $('sh-code').textContent = s.code;
  $('btn-recode').hidden = !isOwner;
  $('btn-leave').hidden = isOwner;
  $('sh-email').textContent = user.email || '';
  const ms = Object.entries(s.members || {}).sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0));
  $('sh-members-t').textContent = '成员';
  $('sh-mcount').textContent = ms.length + ' 人';
  $('sh-members').innerHTML = ms.map(([uid, m]) => {
    const r = uid === s.owner ? 'owner' : (m.role || 'manager');
    const tag = uid === s.owner ? '<span class="tag">店主</span>' : '';
    const meTag = uid === user.uid ? '<span class="tag me">我</span>' : '';
    const acts = isOwner && uid !== user.uid
      ? `<button class="role" data-uid="${esc(uid)}" data-name="${esc(m.name)}" data-role="${r}">${ROLE_TEXT[r]} ⇄</button><span class="kick" data-uid="${esc(uid)}" data-name="${esc(m.name)}">移除</span>`
      : (uid !== s.owner ? `<span class="muted small">${ROLE_TEXT[r]}</span>` : '');
    return `<div class="mrow"><span class="who"><span class="mav">${esc(initial(m.name))}</span><span>${esc(m.name)}${tag}${meTag}</span></span><span class="acts">${acts}</span></div>`;
  }).join('');
  $('sh-count').textContent = Object.keys(curRecs()).length + ' 天';
  if (isFull(cur) && !recentUnsub) {
    recentUnsub = db.watchRecentLogs(cur, 20, logs => {
      $('recent-logs').innerHTML = logs.length ? logs.map(l => logHtml(l, true)).join('') : '<div class="muted small">还没有记录</div>';
    });
  }
  renderHeader();
}
$('sh-members').onclick = e => {
  const k = e.target.closest('.kick');
  if (k) {
    if (!confirm('确定把「' + k.dataset.name + '」移出店铺？他将看不到数据。')) return;
    db.kick(cur, k.dataset.uid).catch(err => toast(errText(err), 3000));
    return;
  }
  const r = e.target.closest('.role');
  if (r) {
    const to = r.dataset.role === 'staff' ? 'manager' : 'staff';
    const tip = to === 'manager' ? '改成「管理员」：能看全部数据、图表和修改记录。' : '改成「店员」：只能记今天和昨天，看不到历史和图表。';
    if (!confirm('把「' + r.dataset.name + '」' + tip)) return;
    db.setRole(cur, r.dataset.uid, to).then(() => toast('已修改')).catch(err => toast(errText(err), 3000));
  }
};
$('lnk-rename').onclick = () => {
  const n = prompt('新的店名', shops[cur].name);
  if (n && n.trim()) db.renameShop(cur, n.trim().slice(0, 40)).catch(e => toast(errText(e), 3000));
};
$('btn-invite').onclick = async () => {
  const url = location.origin + location.pathname.replace(/index\.html$/, '');
  const text = '邀请你加入「' + shops[cur].name + '」营业额记账：\n1. 用手机打开 ' + url + '\n2. 登录后选「用邀请码加入」，输入：' + shops[cur].code;
  try { await navigator.clipboard.writeText(text); } catch (e) {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  toast('已复制，发到微信/WhatsApp 给对方');
};
$('btn-recode').onclick = async () => {
  if (!confirm('更换后旧邀请码失效，已加入的人不受影响。')) return;
  try { await db.resetCode(shops[cur]); toast('已更换'); } catch (e) { toast(errText(e), 3000); }
};
$('btn-leave').onclick = async () => {
  if (!confirm('退出后你将看不到「' + shops[cur].name + '」的数据。确定退出？')) return;
  const id = cur;
  try { await db.leave(id, user.uid); } catch (e) { toast(errText(e), 3000); return; }
  removedFrom(id);
};
$('logs-toggle2').onclick = () => { $('recent-logs').hidden = !$('recent-logs').hidden; };
$('btn-logout').onclick = () => { if (confirm('确定退出登录？')) db.logout(); };

// ---------- 外观：浅色 / 深色 ----------
const darkMQ = matchMedia('(prefers-color-scheme: dark)');
function effectiveTheme() { return document.documentElement.dataset.theme || (darkMQ.matches ? 'dark' : 'light'); }
function paintTheme() {
  const t = effectiveTheme();
  document.querySelectorAll('#theme-toggle button').forEach(b => b.classList.toggle('on', b.dataset.th === t));
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = t === 'dark' ? '#000000' : '#F2F2F7';
  mainChart.redraw(); wdChart.redraw();
}
$('theme-toggle').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  document.documentElement.dataset.theme = b.dataset.th;
  try { localStorage.setItem('theme', b.dataset.th); } catch (err) {}
  paintTheme();
};
darkMQ.addEventListener && darkMQ.addEventListener('change', paintTheme);
paintTheme();

// 安装到主屏幕提示
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
if (!standalone) {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  $('install-tip').textContent = ios
    ? '提示：在 Safari 点底部「分享」→「添加到主屏幕」，以后像 App 一样打开'
    : '提示：在 Chrome 菜单里选「添加到主屏幕」或「安装应用」，以后像 App 一样打开';
}

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

start();
