// 罗马尼亚法定节假日（Codul muncii）+ 两个零售旺日（非法定）
const pad = n => (n < 10 ? '0' : '') + n;
const key = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());

// 东正教复活节（Meeus 儒略历算法，+13 天换成公历，适用 1900–2099）
export function orthodoxEaster(y) {
  const a = y % 4, b = y % 7, c = y % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;
  const dt = new Date(y, month - 1, day);
  dt.setDate(dt.getDate() + 13);
  return dt;
}

const cache = {};
export function holidaysOf(y) {
  if (cache[y]) return cache[y];
  const h = {};
  const fixed = [
    ['01-01', '元旦 Anul Nou'], ['01-02', '元旦 Anul Nou'],
    ['01-06', '主显节 Boboteaza'], ['01-07', '圣约翰节 Sf. Ioan'],
    ['01-24', '统一日 Ziua Unirii'],
    ['03-01', '春天节 Mărțișor（非法定）'], ['03-08', '妇女节 8 Martie（非法定）'],
    ['05-01', '劳动节 1 Mai'], ['06-01', '儿童节 Ziua Copilului'],
    ['08-15', '圣母升天节 Sf. Maria'], ['11-30', '圣安德烈节 Sf. Andrei'],
    ['12-01', '国庆节 Ziua Națională'],
    ['12-25', '圣诞节 Crăciun'], ['12-26', '圣诞节 Crăciun']
  ];
  fixed.forEach(([md, n]) => { h[y + '-' + md] = n; });
  const e = orthodoxEaster(y);
  const off = (n, name) => {
    const d = new Date(e); d.setDate(e.getDate() + n);
    const k = key(d);
    h[k] = h[k] ? h[k] + ' / ' + name : name;
  };
  off(-2, '耶稣受难日 Vinerea Mare');
  off(0, '复活节 Paște');
  off(1, '复活节 Paște');
  off(49, '圣灵降临节 Rusalii');
  off(50, '圣灵降临节 Rusalii');
  return (cache[y] = h);
}

export function holiday(date) {
  return holidaysOf(+date.slice(0, 4))[date] || '';
}
