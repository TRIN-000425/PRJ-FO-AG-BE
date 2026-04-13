const CACHE_NAME = 'pwa-defect-v12';
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
  './manifest.json',
  './assets/icon.svg',
  './assets/floorplan-placeholder.png'
];

// Install Event
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
});

// Activate Event (Cleanup old caches)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    })
  );
});

// Fetch Event
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Strategy for Images (Stale-While-Revalidate)
  if (event.request.destination === 'image' || url.hostname.includes('googleusercontent.com')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const networked = fetch(event.request).then((response) => {
          return caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, response.clone());
            return response;
          });
        }).catch(() => {}); // Silent fail if offline

        return cached || networked;
      })
    );
    return;
  }

  // Strategy for everything else (Network First, fallback to Cache)
  event.respondWith(
    fetch(event.request).catch(() => {
      // If it's a POST request and we're offline
      if (event.request.method === 'POST') {
        return new Response(JSON.stringify({ 
          status: 'offline', 
          message: 'You are offline. Data saved locally.' 
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
      // Match cache, ignoring search params (?v=1.2.4)
      return caches.match(event.request, { ignoreSearch: true });
    })
  );
});
