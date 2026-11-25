// SpendWise service worker: offline support + best-effort daily reminder
const CACHE = 'spendwise-app-v1';
const APP_FILES = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];
const LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(async c => {
    await c.addAll(APP_FILES);
    await Promise.all(LIBS.map(u => fetch(u, { mode: 'cors' }).then(r => r.ok && c.put(u, r)).catch(() => {})));
  }).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('spendwise-app-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const isLib = LIBS.includes(e.request.url);
  if (url.origin !== location.origin && !isLib) return;
  // network first for app files (so updates arrive), cache fallback when offline
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});

function dstr(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

self.addEventListener('periodicsync', e => {
  if (e.tag !== 'daily-checkin') return;
  e.waitUntil((async () => {
    let logged = [];
    try { const r = await (await caches.open('spendwise-state')).match('state.json'); if (r) logged = (await r.json()).logged || []; } catch (err) {}
    const now = new Date(), today = dstr(now);
    const y = new Date(now); y.setDate(y.getDate() - 1);
    const yesterday = dstr(y);
    let body = null;
    if (now.getHours() >= 18 && !logged.includes(today)) body = 'How much did you spend today, and where? Tap to add.';
    else if (!logged.includes(yesterday)) body = "You haven't logged yesterday's spending yet. Tap to add.";
    if (body) await self.registration.showNotification('SpendWise daily check-in', { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'checkin' });
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(list => list.length ? list[0].focus() : self.clients.openWindow('./')));
});
