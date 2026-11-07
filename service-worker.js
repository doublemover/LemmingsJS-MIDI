const CACHE_VERSION = 1;
const SCOPE_URL = new URL(self.registration.scope);
const CACHE_SCOPE = encodeURIComponent(SCOPE_URL.pathname);
const CORE_CACHE = `lemmings-core-${CACHE_SCOPE}-v${CACHE_VERSION}`;
const RUNTIME_CACHE = `lemmings-runtime-${CACHE_SCOPE}-v${CACHE_VERSION}`;
const obsoleteOwnedCache = key => {
  for (const prefix of ['lemmings-core-', 'lemmings-runtime-']) {
    const stem = `${prefix}${CACHE_SCOPE}-v`;
    if (key.startsWith(stem)) {
      const version = key.slice(stem.length);
      return /^[0-9]+$/.test(version) && Number(version) < CACHE_VERSION;
    }
  }
  return false;
};
const CORE_PATHS = [
  'index.html',
  'editor.html',
  'procgen.html',
  'css/game.css',
  'css/editor.css',
  'css/procgen.css',
  'css/procgen-workstation.css',
  'css/procgen-world-inspector.css',
  'css/character-controls.css',
  'css/midi-spans.css',
  'css/icons.css',
  'js/vendor/jquery.js',
  'js/vendor/webmidi.js',
  'js/app/boot.js',
  'js/app/editorBoot.js',
  'js/app/procgenBoot.js',
  'js/app/registerServiceWorker.js',
  'site.webmanifest',
  'img/favicon.png',
  'img/touch-icon-152.png',
  'img/touch-icon-180.png',
  'img/touch-icon-192.png'
];

const toUrl = (path) => new URL(path, self.registration.scope).toString();
const CORE_ASSETS = CORE_PATHS.map(toUrl);

const isOwnedUrl = url => url.origin === self.location.origin && url.pathname.startsWith(SCOPE_URL.pathname);
const isHtmlRequest = (request) => request.mode === 'navigate' ||
  (request.headers.get('accept') || '').includes('text/html');

const fetchFresh = (request) => fetch(new Request(request, { cache: 'no-store' }));

const cacheFirst = async (request) => {
  let cache;
  try { cache = await caches.open(RUNTIME_CACHE); const cached = await cache.match(request); if (cached) return cached; } catch { /* Runtime caching is optional. */ }
  const response = await fetch(request);
  if (cache && response && response.status === 200) {
    try { cache.put(request, response.clone()).catch(() => {}); } catch { /* Runtime caching is optional. */ }
  }
  return response;
};

const networkFirst = async (request, fallbackUrl = null, { bypassCache = false } = {}) => {
  try {
    const response = await (bypassCache ? fetchFresh(request) : fetch(request));
    if (response && response.status === 200) {
      try { const cache = await caches.open(RUNTIME_CACHE); cache.put(request, response.clone()).catch(() => {}); } catch { /* Runtime caching is optional. */ }
    }
    return response;
  } catch (error) {
    const cache = await caches.open(RUNTIME_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    const core = await caches.open(CORE_CACHE), exact = await core.match(request);
    if (exact) return exact;
    const url = new URL(request.url);
    if (fallbackUrl && !['rev', 'cb', 'cacheBust'].some(key => url.searchParams.has(key))) {
      const fallback = await core.match(fallbackUrl);
      if (fallback) return fallback;
    }
    throw error;
  }
};

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CORE_CACHE);
      await Promise.all(
        CORE_ASSETS.map(async (asset) => {
          try {
            const response = await fetchFresh(asset);
            if (response && response.status === 200) {
              await cache.put(asset, response.clone());
            }
          } catch {
            // Ignore failures during install; fetch handlers will recover.
          }
        })
      );
    })()
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // A newer candidate may already be installing. Its versioned cache must
    // survive activation of this worker, as must sibling applications' caches.
    if (!self.registration.installing && !self.registration.waiting) {
      const keys = await caches.keys();
      await Promise.all(keys.filter(obsoleteOwnedCache).map(key => caches.delete(key)));
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (!isOwnedUrl(url)) return;

  if (isHtmlRequest(request)) {
    const path = url.pathname.slice(SCOPE_URL.pathname.length), fallbackPath = path === '' ? 'index.html' :
      ['index.html', 'editor.html', 'procgen.html'].includes(path) ? path : null;
    const fallbackUrl = fallbackPath ? toUrl(fallbackPath) : null;
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
  if (event?.data?.type === 'OFFLINE_STATUS') event.ports?.[0]?.postMessage({ schemaVersion: 1,
    status: 'unqualified-shell', offlineReady: false, reason: 'unversioned-shell-cache-is-not-a-complete-runtime-generation' });
  if (event?.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
