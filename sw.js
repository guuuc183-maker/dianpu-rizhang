// 离线缓存：有网时总是取最新版本，没网时用手机上的缓存，保证离线也能打开
const CACHE = 'rizhang-v29';
const SHELL = [
  './', 'index.html', 'app.css', 'config.js', 'manifest.webmanifest',
  'main.js', 'db.js', 'stats.js', 'chart.js', 'firebase.js', 'holidays.js', 'xlsx.js',
  'bc-600.woff2', 'bc-700.woff2', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'
];

self.addEventListener('install', e => {
  // cache: 'reload' 绕过浏览器自己的缓存，确保装进去的是最新文件
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return; // Firebase 请求不拦截
  // 先联网取最新（不用浏览器旧缓存），失败了（没网）再用本机缓存
  e.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match('index.html')))
  );
});
