/* ============================================================
   sw.js – Step Out Service Worker v1.0.6
   - Never caches index.html (always network-first)
   - Never caches lang/*.json (always network-first)
   - Uses versioned URLs for JS/CSS assets
   ============================================================ */

const CACHE_VERSION = 'v1.0.6';
const STATIC_CACHE  = `stepout-static-${CACHE_VERSION}`;
const DYNAMIC_CACHE = `stepout-dynamic-${CACHE_VERSION}`;
const API_CACHE     = `stepout-api-${CACHE_VERSION}`;

// NOTE: index.html and lang/*.json are intentionally excluded —
// they use network-first so stale content never blocks the app.
const PRECACHE_ASSETS = [
  './offline.html',
  './style.css',
  './app.js?v=1.0.6',
  './manifest.json',
  './libs/leaflet.js?v=1.0.6',
  './libs/leaflet.css?v=1.0.6',
  './components/ui.js?v=1.0.6',
  './components/weather.js?v=1.0.6',
  './components/drywindow.js?v=1.0.6',
  './components/map.js?v=1.0.6',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/logo.png',

  // Lang files with version so old cached versions are ignored
  './lang/en.json?v=1.0.6',
  './lang/fr.json?v=1.0.6',
  './lang/de.json?v=1.0.6',
  './lang/es.json?v=1.0.6',
];

const API_HOSTS = [
  'api.open-meteo.com',
  'api.met.no',
  'nominatim.openstreetmap.org',
];

const API_CACHE_MAX_AGE = 30 * 60 * 1000;

// ── Install ──────────────────────────────────────────────────
self.addEventListener('install', event => {
  // Skip waiting immediately — don't block on precaching
  self.skipWaiting();

  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache =>
      Promise.allSettled(
        PRECACHE_ASSETS.map(url =>
          cache.add(url).catch(err =>
            console.warn('[SW] Failed to cache', url, err.message)
          )
        )
      )
    ).then(() => console.log('[SW] Install complete:', CACHE_VERSION))
  );
});

// ── Activate ─────────────────────────────────────────────────
self.addEventListener('activate', event => {
  const valid = [STATIC_CACHE, DYNAMIC_CACHE, API_CACHE];
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => !valid.includes(k)).map(k => {
          console.log('[SW] Deleting old cache:', k);
          return caches.delete(k);
        })
      ))
      .then(() => self.clients.claim())
      .then(() => console.log('[SW] Activated:', CACHE_VERSION))
  );
});

// ── Fetch ─────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;

  if (isApiRequest(url)) {
    event.respondWith(handleApiRequest(request));
    return;
  }
  if (isMapTile(url)) {
    event.respondWith(handleTileRequest(request));
    return;
  }
  // HTML navigations and lang files: always network-first, never serve stale
  if (request.mode === 'navigate' || isLangFile(url)) {
    event.respondWith(handleNetworkFirst(request));
    return;
  }
  event.respondWith(handleStaticRequest(request));
});

// ── Network-first for API ─────────────────────────────────────
async function handleApiRequest(request) {
  const cache = await caches.open(API_CACHE);
  try {
    const response = await fetchWithTimeout(request.clone(), 8000);
    if (response.ok) {
      const headers = new Headers(response.headers);
      headers.set('sw-cached-at', Date.now().toString());
      const body = await response.clone().arrayBuffer();
      cache.put(request, new Response(body, { status: response.status, headers }));
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'offline' }), {
      status: 503, headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ── Cache-first for map tiles ─────────────────────────────────
async function handleTileRequest(request) {
  const cache = await caches.open(DYNAMIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetchWithTimeout(request, 5000);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return new Response('', { status: 503 });
  }
}

// ── Cache-first for static assets ────────────────────────────
async function handleStaticRequest(request) {
  const staticCache = await caches.open(STATIC_CACHE);
  const cached = await staticCache.match(request);
  if (cached) return cached;
  try {
    const response = await fetchWithTimeout(request, 6000);
    if (response.ok) {
      const dynCache = await caches.open(DYNAMIC_CACHE);
      dynCache.put(request, response.clone());
    }
    return response;
  } catch {
    if (request.mode === 'navigate') {
      const offline = await staticCache.match('./offline.html');
      if (offline) return offline;
    }
    return new Response('Offline', { status: 503 });
  }
}

// ── Network-first (HTML + lang files) ────────────────────────
async function handleNetworkFirst(request) {
  try {
    const response = await fetchWithTimeout(request, 6000);
    if (response.ok) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = (await caches.open(DYNAMIC_CACHE)).match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const offline = await (await caches.open(STATIC_CACHE)).match('./offline.html');
      if (offline) return offline;
    }
    return new Response('Offline', { status: 503 });
  }
}

// ── Helpers ───────────────────────────────────────────────────
function isApiRequest(url) {
  return API_HOSTS.some(h => url.hostname === h);
}
function isMapTile(url) {
  return url.hostname.includes('tile.openstreetmap.org') ||
    url.hostname.includes('gibs.earthdata.nasa.gov') ||
    url.hostname.includes('arcgisonline.com');
}
function isLangFile(url) {
  return url.pathname.includes('/lang/') && url.pathname.endsWith('.json');
}
function fetchWithTimeout(request, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(request, { signal: ctrl.signal }).finally(() => clearTimeout(t));
}

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
