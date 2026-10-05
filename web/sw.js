// オフライン用（Service Worker）。画面のファイルと写真を端末に保存しておき、電波がなくても開けるようにする。
// データ（API）はここでは扱わない。最後に取れたデータは app.js が端末の保存場所に置いている。
// 画面のファイルを直したら VERSION を上げる（古い保存を消して、新しいものを取り直すため）。

const VERSION = 'kakeibo-v7';
const SHELL = [
  './', 'index.html', 'style.css', 'manifest.webmanifest',
  'js/app.js', 'js/api.js', 'js/calc.js', 'js/theme.js', 'js/icons.js', 'js/ui.js',
  'js/views/home.js', 'js/views/stats.js', 'js/views/sheets.js', 'js/views/pages.js',
  'images/icon-192.png', 'images/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // このサイトのファイルだけ。API（script.google.com）や文字（Google Fonts）は通常どおり
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // 先に保存したものを返し、裏で新しいものを取って保存し直す
  e.respondWith(caches.open(VERSION).then(async cache => {
    const hit = await cache.match(e.request);
    const fresh = fetch(e.request).then(res => {
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    }).catch(() => hit);
    return hit || fresh;
  }));
});
