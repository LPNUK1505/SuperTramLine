const CACHE_NAME = 'supertramline-e5a2650b5f34252e67b8bd776a52eee2257193c7';

// Activate immediately, don't wait for existing tabs to close.
// Trade-off: a new version can activate mid-session. Acceptable here because
// the app has no complex cached data structures that could break across versions —
// the worst case is stale GeoJSON briefly served from cache, corrected on next load.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  // Delete any caches from previous versions
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const { hostname } = new URL(event.request.url);
  // OSM tiles: too many to cache usefully
  if (hostname === 'tile.openstreetmap.org') return;
  // Overpass API: app already caches stop names in localStorage
  if (hostname === 'overpass-api.de') return;

  // Network first — serve fresh when online, fall back to cache when offline
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok) {
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
