// かぞく手帳 Service Worker：アプリ本体をキャッシュしてオフラインでも開けるようにする
// ファイルを更新したら VERSION を上げてください
const VERSION = 'kazoku-v4';
const ASSETS = [
  './', './index.html', './style.css', './app.js', './sync.js', './manifest.webmanifest',
  './vendor/firebase-10.14.1.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// 同じサイトのファイルだけ扱う（Firebaseの通信には触れない）
// キャッシュをすぐ返しつつ、裏で最新版を取りに行く（次に開いたとき反映）
self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(caches.open(VERSION).then(async cache => {
    const cached = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    const network = fetch(req).then(res => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    if (cached) { e.waitUntil(network); return cached; }
    const res = await network;
    return res || (req.mode === 'navigate' ? cache.match('./index.html') : Response.error());
  }));
});
