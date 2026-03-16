// This app was built by CeeJay for Chinedum Aranotu – 2026
// BookVoice Service Worker — enables PWA install + background audio keep-alive

const CACHE = 'bookvoice-v1'
const PRECACHE = ['/', '/index.html']

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()))
})

self.addEventListener('fetch', e => {
  // Cache-first for static assets, network-first for API
  if (e.request.url.includes('/api/')) {
    e.respondWith(fetch(e.request).catch(() => new Response('Offline', { status: 503 })))
  } else {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
        if (res.ok && e.request.method === 'GET') {
          const clone = res.clone()
          caches.open(CACHE).then(c => c.put(e.request, clone))
        }
        return res
      }))
    )
  }
})
