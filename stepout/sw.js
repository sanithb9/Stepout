/* ============================================================
   sw.js – Step Out Service Worker
   Caches static assets + API responses, serves offline fallback
   ============================================================ */

const CACHE_VERSION = 'v1.0.4';
const STATIC_CACHE = `stepout-static-${CACHE_VERSION}`;
const DYNAMIC_CACHE = `stepout-dynamic-${CACHE_VERSION}`;
const API_CACHE = `stepout-api-${CACHE_VERSION}`;

// Assets to pre-cache on install
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './offline.html',
  './style.css',
  './app.js',
  './manifest.json',
  './libs/leaflet.js',
  './libs/leaflet.css',
  './components/ui.js',
  './components/weather.js',
  './components/drywindow.js',
  './components/map.js',
  './lang/en.json',
  './lang/fr.json',
  './lang/de.json',
  './lang/es.json',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/logo.png',
];

// API hosts to cache dynamically
const API_HOSTS = [
  'api.open-meteo.com',
  'api.met.no',
  'nominatim.openstreetmap.org',
];

// Max age for API cache entries (30 min)
const API_CACHE_MAX_AGE = 30 * 60 * 1000;

// ============================================================
// Install – precache static assets
// ============================================================
self.addEventListener('install', event => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => {
        // Cache individually to avoid failing entire batch
        return Promise.allSettled(
          PRECACHE_ASSETS.map(url =>
            cache.add(url).catch(err =>
              console.warn(`[SW] Failed to cache ${url}:`, err.message)
            )
          )
        );
      })
      .then(() => {
        console.log('[SW] Precaching complete');
        return self.skipWaiting();
      })
  );
});

// ============================================================
// Activate – clean up old caches
// ============================================================
self.addEventListener('activate', event => {
  console.log('[SW] Activating...');
  const validCaches = [STATIC_CACHE, DYNAMIC_CACHE, API_CACHE];

  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => !validCaches.includes(key))
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      ))
      .then(() => self.clients.claim())
  );
});

// ============================================================
// Fetch – intercept requests
// ============================================================
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and chrome-extension requests
  if (request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;

  // API requests: network-first with cache fallback
  if (isApiRequest(url)) {
    event.respondWith(handleApiRequest(request));
    return;
  }

  // Map tiles: cache-first (tiles rarely change)
  if (isMapTile(url)) {
    event.respondWith(handleTileRequest(request));
    return;
  }

  // Static assets: cache-first with network fallback
  event.respondWith(handleStaticRequest(request));
});

// ============================================================
// Strategy: Network-first for API (with cache fallback)
// ============================================================
async function handleApiRequest(request) {
  const cache = await caches.open(API_CACHE);

  try {
    const networkResponse = await fetchWithTimeout(request.clone(), 8000);
    if (networkResponse.ok) {
      // Store with timestamp header
      const responseToCache = networkResponse.clone();
      const headers = new Headers(responseToCache.headers);
      headers.set('sw-cached-at', Date.now().toString());

      const body = await responseToCache.arrayBuffer();
      const cachedResponse = new Response(body, {
        status: responseToCache.status,
        headers,
      });
      cache.put(request, cachedResponse);
    }
    return networkResponse;
  } catch (err) {
    console.log('[SW] API network failed, trying cache:', request.url);
    const cached = await cache.match(request);
    if (cached) {
      // Check age
      const cachedAt = parseInt(cached.headers.get('sw-cached-at') || '0');
      if (Date.now() - cachedAt < API_CACHE_MAX_AGE * 4) { // 2h grace
        return cached;
      }
    }
    return new Response(JSON.stringify({ error: 'offline', message: 'No cached data available' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ============================================================
// Strategy: Cache-first for map tiles
// ============================================================
async function handleTileRequest(request) {
  const cache = await caches.open(DYNAMIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetchWithTimeout(request, 5000);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Return a transparent 1px image as fallback
    return new Response(
      new Uint8Array([71,73,70,56,57,97,1,0,1,0,0,0,0,33,249,4,0,0,0,0,0,44,0,0,0,0,1,0,1,0,0,2,0,59]),
      { headers: { 'Content-Type': 'image/gif' } }
    );
  }
}

// ============================================================
// Strategy: Cache-first for static assets with offline fallback
// ============================================================
async function handleStaticRequest(request) {
  const staticCache = await caches.open(STATIC_CACHE);
  const cached = await staticCache.match(request);
  if (cached) return cached;

  try {
    const response = await fetchWithTimeout(request, 5000);
    if (response.ok) {
      const dynamicCache = await caches.open(DYNAMIC_CACHE);
      dynamicCache.put(request, response.clone());
    }
    return response;
  } catch {
    // Return offline page for navigation requests
    if (request.mode === 'navigate') {
      const offlinePage = await staticCache.match('./offline.html');
      if (offlinePage) return offlinePage;
    }
    return new Response('Offline', { status: 503 });
  }
}

// ============================================================
// Helpers
// ============================================================
function isApiRequest(url) {
  return API_HOSTS.some(host => url.hostname === host);
}

function isMapTile(url) {
  return url.hostname.includes('tile.openstreetmap.org') ||
    url.hostname.includes('gibs.earthdata.nasa.gov') ||
    url.hostname.includes('arcgisonline.com');
}

function fetchWithTimeout(request, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(request, { signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

// ============================================================
// Background Sync (future use) + Message handling
// ============================================================
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data?.type === 'CACHE_VERSION') {
    event.ports[0]?.postMessage({ version: CACHE_VERSION });
  }
});
