// Nanashi サービスワーカー — 静的ファイルをキャッシュ
const CACHE = 'nanashi-v2';
const STATIC = ['/index.html', '/style.css', '/app.js', '/manifest.json', '/icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Supabase API・CDN はキャッシュしない
  if (e.request.url.includes('supabase.co')) return;
  if (e.request.url.includes('cdn.jsdelivr.net')) return;

  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
