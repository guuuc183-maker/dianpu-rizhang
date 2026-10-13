// 柱状图：values 本期，compare 去年同期（可选）。点柱子显示金额。
const PAD_L = 38, PAD_R = 6, PAD_T = 14, PAD_B = 26;
const C_CUR = '#C8102E', C_CMP = '#F4B6C1';

const money = n => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
function short(v) {
  if (v >= 1000000) return (v / 1000000).toFixed(v >= 10000000 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (v >= 1000) return (v / 1000).toFixed(v >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k';
  return String(Math.round(v));
}
function niceStep(raw) {
  if (raw <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

export class BarChart {
  constructor(el, opts = {}) {
    this.el = el;
    this.opts = Object.assign({ height: 200, minGroup: 0, legendA: '今年', legendB: '去年', hint: '点柱子查看金额' }, opts);
    el.classList.add('chart');
    el.innerHTML = '<div class="chart-head"><div class="chart-tip"></div><div class="chart-legend"></div></div>' +
      '<div class="chart-scroll"><canvas></canvas></div>';
    this.tipEl = el.querySelector('.chart-tip');
    this.legendEl = el.querySelector('.chart-legend');
    this.scrollEl = el.querySelector('.chart-scroll');
    this.canvas = el.querySelector('canvas');
    this.canvas.addEventListener('pointerdown', e => this.onTap(e));
    this.data = { labels: [], values: [], compare: [], titles: [], focus: -1 };
    this.sel = -1;
    this.ro = new ResizeObserver(() => { if (this.el.clientWidth !== this.lastW) this.layout(); });
    this.ro.observe(el);
  }

  set(data, opts) {
    this.data = Object.assign({ compare: [], titles: [], marks: [], focus: -1 }, data);
    if (opts) Object.assign(this.opts, opts);
    this.sel = -1;
    this.layout(true);
  }

  layout(scrollToFocus) {
    const vw = this.el.clientWidth;
    if (!vw) return;
    this.lastW = vw;
    const d = this.data, o = this.opts;
    const n = Math.max(d.labels.length, 1);
    this.hasCompare = d.compare.some(v => v > 0);
    this.W = Math.max(vw, Math.ceil(PAD_L + n * o.minGroup + PAD_R));
    this.H = o.height;
    this.legendEl.innerHTML = this.hasCompare
      ? `<i class="dot a"></i>${esc(o.legendA)}<i class="dot b"></i>${esc(o.legendB)}` : '';
    this.setTip('');
    this.draw();
    if (scrollToFocus) {
      let left = 0;
      if (d.focus >= 0 && this.W > vw) {
        const gw = (this.W - PAD_L - PAD_R) / n;
        left = Math.max(0, Math.min(this.W - vw, PAD_L + gw * (d.focus + 0.5) - vw / 2));
      }
      this.scrollEl.scrollLeft = left;
    }
  }

  setTip(t) {
    this.tipEl.textContent = t || this.opts.hint;
    this.tipEl.classList.toggle('on', !!t);
  }

  draw() {
    const { W, H } = this;
    const dpr = window.devicePixelRatio || 1;
    const canvas = this.canvas;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const d = this.data, vals = d.values, cmp = d.compare, hasCompare = this.hasCompare;
    const n = Math.max(d.labels.length, 1);
    const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
    const font = s => s + 'px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';

    let max = 0;
    vals.forEach(v => { if (v > max) max = v; });
    if (hasCompare) cmp.forEach(v => { if (v > max) max = v; });
    const step = niceStep((max || 100) / 4);
    const ticks = Math.max(1, Math.ceil((max || 100) / step));
    const top = step * ticks;

    ctx.font = font(10);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= ticks; i++) {
      const y = PAD_T + plotH * (1 - i / ticks);
      ctx.strokeStyle = i === 0 ? '#ddd' : '#f0f0f0';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(PAD_L, Math.round(y) + 0.5); ctx.lineTo(W - PAD_R, Math.round(y) + 0.5); ctx.stroke();
      ctx.fillStyle = '#aaa';
      ctx.fillText(short(step * i), PAD_L - 5, y);
    }

    const gw = plotW / n;
    const bw = hasCompare ? Math.min(gw * 0.36, 16) : Math.min(gw * 0.6, 26);
    const sel = this.sel;
    const yOf = v => PAD_T + plotH * (1 - Math.max(v, 0) / top);
    const bar = (x, v, color) => {
      if (!(v > 0)) return;
      const y = yOf(v);
      const h = Math.max(PAD_T + plotH - y, 1);
      const rr = Math.min(3, bw / 2, h);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x, y + h);
      ctx.lineTo(x, y + rr);
      ctx.arcTo(x, y, x + rr, y, rr);
      ctx.lineTo(x + bw - rr, y);
      ctx.arcTo(x + bw, y, x + bw, y + rr, rr);
      ctx.lineTo(x + bw, y + h);
      ctx.closePath();
      ctx.fill();
    };

    if (sel >= 0) {
      ctx.fillStyle = 'rgba(200,16,46,0.06)';
      ctx.fillRect(PAD_L + gw * sel, PAD_T, gw, plotH);
    }
    for (let i = 0; i < n; i++) {
      const cx = PAD_L + gw * (i + 0.5);
      ctx.globalAlpha = sel >= 0 && sel !== i ? 0.45 : 1;
      if (hasCompare) { bar(cx - bw - 1, cmp[i], C_CMP); bar(cx + 1, vals[i], C_CUR); }
      else bar(cx - bw / 2, vals[i], C_CUR);
    }
    ctx.globalAlpha = 1;

    if (gw >= 30) {
      ctx.font = font(9);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = '#555';
      for (let i = 0; i < n; i++) {
        if (!(vals[i] > 0)) continue;
        const cx = PAD_L + gw * (i + 0.5) + (hasCompare ? 1 + bw / 2 : 0);
        ctx.fillText(short(vals[i]), cx, yOf(vals[i]) - 2);
      }
    }

    ctx.font = font(10);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    let lw = 0;
    d.labels.forEach(l => { lw = Math.max(lw, ctx.measureText(l).width); });
    const every = Math.max(1, Math.ceil((lw + 6) / gw));
    d.labels.forEach((l, i) => {
      const nearSel = sel >= 0 && i !== sel && Math.abs(i - sel) < every;
      if ((i % every === 0 && !nearSel) || i === sel) {
        ctx.fillStyle = i === sel ? C_CUR : '#888';
        ctx.fillText(l, PAD_L + gw * (i + 0.5), PAD_T + plotH + 5);
      }
    });
    // 节假日：日期下面画个小红点
    (d.marks || []).forEach((m, i) => {
      if (!m) return;
      ctx.fillStyle = C_CUR;
      ctx.beginPath(); ctx.arc(PAD_L + gw * (i + 0.5), H - 3, 2, 0, Math.PI * 2); ctx.fill();
    });
    this.gw = gw; this.n = n;
  }

  onTap(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const i = Math.floor((x - PAD_L) / this.gw);
    if (i < 0 || i >= this.n) return;
    this.sel = i;
    const d = this.data;
    let tip = (d.titles[i] || d.labels[i]) + '：' + money(d.values[i]) + ' lei';
    if (this.hasCompare) {
      const c = d.compare[i] || 0;
      tip += '　' + this.opts.legendB + ' ' + money(c);
      if (c > 0) {
        const p = Math.round(((d.values[i] || 0) - c) / c * 100);
        tip += '（' + (p >= 0 ? '+' : '') + p + '%）';
      }
    }
    this.setTip(tip);
    this.draw();
  }
}
