const CACHE_VERSION = 'v1';
const CORE_CACHE = `lemmings-core-${CACHE_VERSION}`;
const RUNTIME_CACHE = `lemmings-runtime-${CACHE_VERSION}`;
const CORE_PATHS = [
  'index.html',
  'editor.html',
  'css/game.css',
  'css/editor.css',
  'js/vendor/jquery.js',
  'js/vendor/webmidi.js',
  'js/app/boot.js',
  'js/app/editorBoot.js',
  'js/app/registerServiceWorker.js',
  'site.webmanifest',
  'img/favicon.png',
  'img/touch-icon-152.png',
  'img/touch-icon-180.png',
  'img/touch-icon-192.png'
];

const toUrl = (path) => new URL(path, self.registration.scope).toString();
const CORE_ASSETS = CORE_PATHS.map(toUrl);

const isSameOrigin = (url) => url.origin === self.location.origin;
const isHtmlRequest = (request) => request.mode === 'navigate' ||
  (request.headers.get('accept') || '').includes('text/html');

const fetchFresh = (request) => fetch(new Request(request, { cache: 'no-store' }));

const cacheFirst = async (request) => {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.status === 200) {
    cache.put(request, response.clone());
  }
  return response;
};

const networkFirst = async (request, fallbackUrl = null, { bypassCache = false } = {}) => {
  try {
    const response = await (bypassCache ? fetchFresh(request) : fetch(request));
    if (response && response.status === 200) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cache = await caches.open(RUNTIME_CACHE);
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (fallbackUrl) {
      const core = await caches.open(CORE_CACHE);
      const fallback = await core.match(fallbackUrl);
      if (fallback) return fallback;
    }
    throw error;
  }
};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CORE_CACHE).then(cache => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(key => ![CORE_CACHE, RUNTIME_CACHE].includes(key))
        .map(key => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (!isSameOrigin(url)) return;

  if (isHtmlRequest(request)) {
    const fallbackPath = url.pathname.endsWith('/editor.html') ? 'editor.html' : 'index.html';
    const fallbackUrl = toUrl(fallbackPath);
    event.respondWith(networkFirst(request, fallbackUrl, { bypassCache: true }));
    return;
  }

  const destination = request.destination;
  if (destination === 'script' || destination === 'style') {
    event.respondWith(networkFirst(request, null, { bypassCache: true }));
    return;
  }
  const isStatic = destination === 'image' ||
    destination === 'font' ||
    destination === 'audio';
  if (isStatic) {
    event.respondWith(cacheFirst(request));
  }
});

self.addEventListener('message', (event) => {
  if (event?.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
