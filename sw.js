const CACHE_NAME = 'pwa-defect-v32';
const STATIC_ASSETS = [
  './',
  './index.html',
  './home.html',
  './home-logic.js',
  './style.css',
  './config.js',
  './app.js',
  './defect.html',
  './defect-logic.js',
  './libs/idb.js',
  './manifest.json',
  './assets/icon.svg',
  './assets/floorplan-placeholder.png'
];

// Install Event
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Service Worker: Caching Static Assets');
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activate Event
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('Service Worker: Clearing Old Cache', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. Strategy for Images (Cache-First, then Network Update)
  // This ensures that maps and photos are served instantly from cache if available.
  if (
    event.request.destination === 'image' || 
    url.hostname.includes('googleusercontent.com') || 
    url.hostname.includes('drive.google.com')
  ) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const networked = fetch(event.request)
          .then((response) => {
            // Allow caching status 200 AND status 0 (opaque cross-origin)
            if (response && (response.status === 200 || response.status === 0)) {
              const cacheCopy = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cacheCopy));
            }
            return response;
          })
          .catch(() => {
            // If offline and not in cache, try to return the placeholder for maps
            if (url.pathname.includes('.png') || url.href.includes('thumbnail')) {
              return caches.match('./assets/floorplan-placeholder.png');
            }
          });

        return cached || networked;
      })
    );
    return;
  }

  // 2. Specialized response for POST API calls
  if (event.request.method === 'POST') {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(JSON.stringify({ 
          status: 'offline', 
          message: 'Offline: Data saved locally and will sync later.' 
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // 3. Standard GET requests (Network First, fallback to Cache)
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const cacheCopy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cacheCopy));
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request, { ignoreSearch: true }).then((cached) => {
          if (cached) return cached;
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
      })
  );
});
