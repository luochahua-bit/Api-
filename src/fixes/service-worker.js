const CACHE_NAME = 'llm-relay-v1';
const STATIC_ASSETS = [
  '/fixes/dashboard-styles.css',
  '/fixes/marketplace-styles.css',
  '/fixes/icon-192.svg',
  '/fixes/icon-512.svg',
  '/fixes/manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { url } = event.request;
  // Only cache same-origin GET requests
  if (event.request.method !== 'GET' || !url.startsWith(self.location.origin)) return;
  // Cache-first for static assets
  if (url.includes('/fixes/') || url.includes('/public/')) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
  }
});
