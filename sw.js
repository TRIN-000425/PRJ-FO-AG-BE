const CACHE_NAME = 'pwa-defect-v13';
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
      console.log('Service Worker: Caching Assets');
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activate Event (Cleanup old caches)
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

  // 1. Strategy for Google Drive Images & other external images (Stale-While-Revalidate)
  if (
    event.request.destination === 'image' || 
    url.hostname.includes('googleusercontent.com') || 
    url.hostname.includes('drive.google.com')
  ) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const networked = fetch(event.request)
          .then((response) => {
            if (response && response.status === 200) {
              const cacheCopy = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cacheCopy));
            }
            return response;
          })
          .catch(() => {
            // Fallback for missing floorplans if completely offline and not in cache
            if (url.pathname.includes('.png') || url.href.includes('thumbnail')) {
              return caches.match('./assets/floorplan-placeholder.png');
            }
          });

        return cached || networked;
      })
    );
    return;
  }

  // 2. Ignore non-GET requests for standard caching
  if (event.request.method !== 'GET') {
    // Specialized offline response for POST API calls
    if (event.request.method === 'POST') {
      event.respondWith(
        fetch(event.request).catch(() => {
          return new Response(JSON.stringify({ 
            status: 'offline', 
            message: 'Action recorded locally. Will sync when online.' 
          }), {
            headers: { 'Content-Type': 'application/json' }
          });
        })
      );
    }
    return;
  }

  // 3. Strategy for everything else (Network First, fallback to Cache)
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // If successful, update the cache for this request
        if (response && response.status === 200 && response.type === 'basic') {
          const cacheCopy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cacheCopy));
        }
        return response;
      })
      .catch(() => {
        // Match cache, ignoring search params (?v=1.2.6)
        return caches.match(event.request, { ignoreSearch: true }).then((cached) => {
          if (cached) return cached;
          
          // Fallback for navigation requests (HTML pages)
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
      })
  );
});
