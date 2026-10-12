import * as S from './stats.js';
import { BarChart } from './chart.js';
import * as db from './db.js';

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => parseFloat(String(v || '').replace(/\s/g, '').replace(',', '.')) || 0;

let user = null, shopId = null, shop = null, records = {}, meta = { pending: false, fromCache: true };
let unsubShop = null, unsubRec = null, inApp = false;

// ---------- 通用 ----------
let toastTimer;
function toast(msg, ms = 2000) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
function show(name) {
  ['loading', 'config', 'login', 'setup', 'app'].forEach(n => { $('s-' + n).hidden = n !== name; });
  window.scrollTo(0, 0);
}
function errText(e) {
  const c = (e && e.code) || '';
  const map = {
    'auth/invalid-credential': '邮箱或密码不对',
    'auth/wrong-password': '邮箱或密码不对',
    'auth/user-not-found': '这个邮箱还没注册',
    'auth/email-already-in-use': '这个邮箱已经注册过，直接登录就行',
    'auth/weak-password': '密码至少 6 位',
    'auth/invalid-email': '邮箱格式不对',
    'auth/missing-password': '请输入密码',
    'auth/too-many-requests': '尝试次数太多，请稍后再试',
    'auth/network-request-failed': '网络不通，请检查网络',
    'auth/unauthorized-domain': '这个网址还没加到 Firebase 的授权域名里（见使用说明）',
    'auth/popup-closed-by-user': '',
    'auth/cancelled-popup-request': '',
    'permission-denied': '没有权限（邀请码不对或已被更换？）',
    'unavailable': '网络不通，请检查网络'
  };
  if (c in map) return map[c];
  return (e && e.message) || String(e);
}
async function copyText(s) {
  try { await navigator.clipboard.writeText(s); }
  catch (e) {
    const ta = document.createElement('textarea');
    ta.value = s; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove();
  }
}
function myName() { return (shop && shop.members && shop.members[user.uid] && shop.members[user.uid].name) || ''; }

// ---------- 启动 ----------
function start() {
  if (!db.configured()) { show('config'); return; }
  db.init();
  db.onUser(async u => {
    cleanup();
    user = u;
    if (!u) { show('login'); return; }
    try {
      const sid = await db.getMyShopId(u.uid);
      if (sid) enterShop(sid); else showSetup();
    } catch (e) {
      toast('读取失败：' + errText(e));
      showSetup();
    }
  });
}

function cleanup() {
  if (unsubShop) unsubShop();
  if (unsubRec) unsubRec();
  unsubShop = unsubRec = null;
  shop = null; shopId = null; records = {}; inApp = false;
  S.setRecords({});
}

function enterShop(sid) {
  shopId = sid;
  unsubShop = db.watchShop(sid, s => {
    if (!s.memberIds || !s.memberIds.includes(user.uid)) { removed(); return; }
    shop = s;
    if (!inApp) { inApp = true; show('app'); setDate(entry.date || S.today()); }
    renderHeader(); renderShop();
  }, () => removed());
  unsubRec = db.watchRecords(sid, (map, m) => {
    records = map; meta = m;
    S.setRecords(map);
    onRecords();
  }, () => {});
}

function removed() {
  const uid = user && user.uid;
  cleanup();
  if (uid) db.forgetShop(uid);
  toast('你已不在这个店铺', 3000);
  showSetup();
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
  show('setup');
}
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
      sid = await db.joinShop(user.uid, code, name);
    }
    enterShop(sid);
  } catch (e) {
    toast(errText(e), 3000);
  }
  b.disabled = false;
};
$('lnk-logout1').onclick = () => db.logout();

// ---------- 底部导航 ----------
let view = 'entry';
document.querySelector('.tabbar').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  go(b.dataset.v);
};
function go(v) {
  view = v;
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  ['entry', 'charts', 'shop'].forEach(n => { $('v-' + n).hidden = n !== v; });
  window.scrollTo(0, 0);
  if (v === 'charts') renderCharts();
  if (v === 'shop') renderShop();
}

// ---------- 同步状态 ----------
function syncState() {
  if (!navigator.onLine) return { t: '离线 · 有网自动同步', c: 'warn' };
  if (meta.pending) return { t: '同步中…', c: 'warn' };
  if (meta.fromCache) return { t: '连接中…', c: '' };
  return { t: '已同步 ✓', c: 'ok' };
}
function renderHeader() {
  if (!shop) return;
  $('hdr-shop').textContent = shop.name;
  const s = syncState();
  $('hdr-sync').textContent = s.t;
  $('sh-sync').textContent = s.t;
  $('sh-sync').className = s.c;
}
window.addEventListener('online', renderHeader);
window.addEventListener('offline', renderHeader);

function onRecords() {
  renderHeader();
  if (!entry.editing) fillForm();
  renderEntryInfo();
  if (view === 'charts') renderCharts();
  $('sh-count').textContent = Object.keys(records).length + ' 天';
}

// ---------- 记账 ----------
const entry = { date: '', editing: false };

function setDate(d) {
  entry.date = d;
  entry.editing = false;
  $('in-date').value = d;
  $('in-date').max = S.today();
  fillForm();
  renderEntryInfo();
}
function fillForm() {
  const r = records[entry.date];
  $('in-cash').value = r ? String(r.cash) : '';
  $('in-card').value = r ? String(r.card) : '';
  $('in-note').value = r ? r.note : '';
  calc();
}
function renderEntryInfo() {
  const d = entry.date; if (!d) return;
  const t = S.today();
  $('d-text').textContent = d + ' ' + S.weekday(d) + (d === t ? '（今天）' : '');
  $('d-next').disabled = d >= t;
  const r = records[d];
  $('d-status').textContent = r ? '已记录' + (r.by ? '（' + r.by + '）' : '') + '，修改后保存会覆盖' : '';
  $('btn-del').hidden = !r;
  calc();
}
function calc() {
  const tot = num($('in-cash').value) + num($('in-card').value);
  $('t-total').textContent = S.money(tot);
  const ly = S.lastYearToday(entry.date);
  $('ly-date').textContent = ly.lyDate + ' ' + ly.lyWeekday;
  $('lw-date').innerHTML = '去年同一个' + ly.lwWeekday + ' <span class="muted small">' + ly.lwDate + '</span>';
  const put = (id, val) => {
    $(id + '-val').textContent = val === null ? '没有记录' : S.money(val) + ' lei';
    const p = $(id + '-pct');
    p.textContent = val && tot ? S.pct(tot, val) : '';
    p.className = 'pct ' + (tot < val ? 'down' : 'up');
  };
  put('ly', ly.lyTotal);
  put('lw', ly.lwTotal);
}
['in-cash', 'in-card', 'in-note'].forEach(id => $(id).addEventListener('input', () => { entry.editing = true; calc(); }));
$('in-date').onchange = e => { if (e.target.value) setDate(e.target.value > S.today() ? S.today() : e.target.value); };
$('d-prev').onclick = () => setDate(S.addDays(entry.date, -1));
$('d-next').onclick = () => { if (entry.date < S.today()) setDate(S.addDays(entry.date, 1)); };

$('btn-save').onclick = () => {
  const cash = num($('in-cash').value), card = num($('in-card').value);
  if (cash === 0 && card === 0) { toast('请输入金额'); return; }
  db.saveRecord(shopId, entry.date, { cash, card, note: $('in-note').value.trim(), by: myName() })
    .catch(e => toast('保存失败：' + errText(e), 3000));
  entry.editing = false;
  document.activeElement && document.activeElement.blur();
  toast(navigator.onLine ? '已保存 ✓' : '已存本机，有网后自动同步');
};
$('btn-del').onclick = () => {
  if (!confirm('确定删除 ' + entry.date + ' 的营业额？所有手机都会删除。')) return;
  db.deleteRecord(shopId, entry.date).catch(e => toast('删除失败：' + errText(e), 3000));
  entry.editing = false;
  toast('已删除');
};

// ---------- 图表 ----------
const charts = { tab: 'day', month: S.today().slice(0, 7), year: +S.today().slice(0, 4) };
const mainChart = new BarChart($('chart-main'), { height: 220 });
const yearsChart = new BarChart($('chart-years'), { height: 180 });
$('in-month').value = charts.month;
$('in-month').max = charts.month;

$('chart-seg').onclick = e => {
  const t = e.target.dataset.t; if (!t) return;
  charts.tab = t;
  [...$('chart-seg').children].forEach(b => b.classList.toggle('on', b.dataset.t === t));
  renderCharts();
};
$('in-month').onchange = e => { if (e.target.value) { charts.month = e.target.value; renderCharts(); } };
$('in-year').onchange = e => { charts.year = +e.target.value; renderCharts(); };

function renderCharts() {
  const { tab, month, year } = charts;
  $('pick-month').hidden = tab !== 'day';
  $('pick-year').hidden = tab === 'day';

  // 年份下拉
  const now = +S.today().slice(0, 4), first = Math.min(S.firstYear(), now);
  let opts = '';
  for (let y = now; y >= first; y--) opts += `<option value="${y}"${y === year ? ' selected' : ''}>${y}</option>`;
  $('in-year').innerHTML = opts;

  let c, curT, prevT;
  if (tab === 'day') {
    c = S.byDay(month);
    const m = +month.slice(5);
    curT = m + '月' + (c.isNow ? '至今' : '合计');
    prevT = '去年' + m + '月' + (c.isNow ? '同期' : '');
    $('chart-title').textContent = '每天营业额';
  } else {
    c = tab === 'week' ? S.byWeek(year) : S.byMonth(year);
    curT = year + '年' + (c.isNow ? '至今' : '全年');
    prevT = (year - 1) + '年' + (c.isNow ? '同期' : '全年');
    $('chart-title').textContent = tab === 'week' ? '每周营业额（左右滑动）' : '每月营业额';
  }
  $('sum-cur-t').textContent = curT;
  $('sum-cur').textContent = S.money(c.cur);
  $('sum-prev-t').textContent = prevT;
  $('sum-prev').textContent = S.money(c.prev);
  $('sum-pct').textContent = c.pct;
  $('sum-pct').className = 'pct ' + (c.cur < c.prev ? 'down' : 'up');

  mainChart.set(c, {
    minGroup: tab === 'week' ? 26 : 0,
    legendA: tab === 'day' ? '今年' : year + '年',
    legendB: tab === 'day' ? '去年' : (year - 1) + '年'
  });

  $('card-years').hidden = tab !== 'year';
  if (tab === 'year') yearsChart.set(S.byYear());

  $('btn-copy').textContent = '复制' + (tab === 'day' ? '本月' : year + '年') + '明细（可贴到 Excel）';

  const list = tab === 'day' ? S.listMonth(month) : null;
  $('day-list').hidden = !list;
  if (list) {
    $('day-list').innerHTML = list.length ? list.map(r => `
      <div class="item" data-date="${r.date}">
        <div class="top"><span>${+r.date.slice(8)}日 <span class="muted small">${S.weekday(r.date)}</span></span><span class="t">${S.money(S.total(r))}</span></div>
        <div class="muted small">现金 ${S.money(r.cash)} · 刷卡 ${S.money(r.card)}${r.note ? ' · ' + esc(r.note) : ''}${r.by ? ' · ' + esc(r.by) + '记' : ''}</div>
      </div>`).join('') : '<div class="center muted">这个月还没有记录</div>';
  }
}
$('day-list').onclick = e => {
  const it = e.target.closest('.item'); if (!it) return;
  setDate(it.dataset.date);
  go('entry');
};
$('btn-copy').onclick = async () => {
  const prefix = charts.tab === 'day' ? charts.month : String(charts.year);
  const keys = Object.keys(records).filter(k => k.startsWith(prefix)).sort();
  if (!keys.length) { toast('没有记录'); return; }
  let s = '日期\t星期\t现金\t刷卡\t合计\t备注\n', cash = 0, card = 0;
  keys.forEach(k => {
    const r = records[k];
    cash += r.cash; card += r.card;
    s += [k, S.weekday(k), S.money(r.cash), S.money(r.card), S.money(r.cash + r.card), r.note || ''].join('\t') + '\n';
  });
  s += ['合计', '', S.money(cash), S.money(card), S.money(cash + card), ''].join('\t') + '\n';
  await copyText(s);
  toast('已复制 ' + keys.length + ' 天，可直接粘贴到 Excel');
};

// ---------- 店铺 ----------
function renderShop() {
  if (!shop) return;
  const isOwner = shop.owner === user.uid;
  $('sh-name').textContent = shop.name;
  $('lnk-rename').hidden = !isOwner;
  $('sh-code').textContent = shop.code;
  $('btn-recode').hidden = !isOwner;
  $('btn-leave').hidden = isOwner;
  $('sh-email').textContent = user.email || '';
  const ms = Object.entries(shop.members || {}).sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0));
  $('sh-members-t').textContent = '成员（' + ms.length + ' 人）';
  $('sh-members').innerHTML = ms.map(([uid, m]) => `
    <div class="row">
      <span>${esc(m.name)}${uid === shop.owner ? '<span class="tag">店主</span>' : ''}${uid === user.uid ? '<span class="tag me">我</span>' : ''}</span>
      ${isOwner && uid !== user.uid ? `<span class="kick" data-uid="${esc(uid)}" data-name="${esc(m.name)}">移除</span>` : ''}
    </div>`).join('');
  $('sh-count').textContent = Object.keys(records).length + ' 天';
  renderHeader();
}
$('sh-members').onclick = e => {
  const k = e.target.closest('.kick'); if (!k) return;
  if (!confirm('确定把「' + k.dataset.name + '」移出店铺？他将看不到数据。')) return;
  db.kick(shopId, k.dataset.uid).catch(err => toast(errText(err), 3000));
};
$('lnk-rename').onclick = () => {
  const n = prompt('新的店名', shop.name);
  if (n && n.trim()) db.renameShop(shopId, n.trim().slice(0, 40)).catch(e => toast(errText(e), 3000));
};
$('btn-invite').onclick = async () => {
  const url = location.origin + location.pathname.replace(/index\.html$/, '');
  await copyText('邀请你加入「' + shop.name + '」营业额记账：\n1. 用手机打开 ' + url + '\n2. 登录后选「用邀请码加入」，输入：' + shop.code);
  toast('已复制，发到微信/WhatsApp 给对方');
};
$('btn-recode').onclick = async () => {
  if (!confirm('更换后旧邀请码失效，已加入的人不受影响。')) return;
  try { await db.resetCode(shop); toast('已更换'); } catch (e) { toast(errText(e), 3000); }
};
$('btn-leave').onclick = async () => {
  if (!confirm('退出后你将看不到这个店铺的数据。确定退出？')) return;
  const uid = user.uid, sid = shopId;
  cleanup();
  try { await db.leave(sid, uid); } catch (e) { toast(errText(e), 3000); }
  showSetup();
};
$('btn-logout').onclick = () => { if (confirm('确定退出登录？')) db.logout(); };

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
