// 离线缓存：没网也能打开 App；有新版本时后台更新，下次打开生效
const CACHE = 'rizhang-v3';
const SHELL = [
  './', 'index.html', 'app.css', 'config.js', 'manifest.webmanifest',
  'main.js', 'db.js', 'stats.js', 'chart.js', 'firebase.js',
  'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return; // Firebase 请求不拦截
  // 先用缓存秒开，同时联网更新缓存
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(req, { ignoreSearch: true });
    const net = fetch(req).then(res => {
      if (res.ok) c.put(req, res.clone());
      return res;
    }).catch(() => hit);
    return hit || net;
  }));
});
