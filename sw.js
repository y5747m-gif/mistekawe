/* غلاف التطبيق فقط. الشبكة أولًا حتى لا يعلق صوت أو صفحة على نسخة قديمة. */
const CACHE = 'majlis-shell-v8-raheeq-yaseen';
const SHELL = [
  './',
  './majlis.html',
  './hall.html',
  './sound/css/hall.css',
  './sound/css/simple.css',
  './sound/app/main.js',
  './sound/app/simple.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './css/intro.css',
  './js/intro.js',
  './css/raheeq.css',
  './js/settings.js',
  './js/i18n.js',
  './js/whatsapp.js',
  './js/app.js',
  './index.html',
  './assets/brand/raheeq-mark-vector.svg',
  './assets/brand/raheeq-mark-white.png',
  './assets/brand/raheeq-icon-192.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  /* واجهات الخادم ولوحة مدير رحيق لا تُخزَّن أبدًا (مفتاح الإيقاف يجب أن يسري فورًا) */
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin-yaseen')) return;
  event.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      if (fresh.ok && req.url.startsWith(self.location.origin)) {
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
      }
      return fresh;
    } catch {
      const cached = await caches.match(req);
      if (cached) return cached;
      if (req.mode === 'navigate') {
        const home = await caches.match('./majlis.html');
        if (home) return home;
      }
      throw new Error('offline');
    }
  })());
});
