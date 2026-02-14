/* Pocket Balance service worker
   - caches the app shell for offline use
   - keeps it intentionally small + readable
*/

const CACHE = "pb-cache-v2";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./db.js",
  "./utils.js",
  "./charts.js",
  "./manifest.webmanifest",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS);
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // cleanup old caches
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k !== CACHE ? caches.delete(k) : Promise.resolve())));
    self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // We only handle GET requests (avoid interfering with uploads)
  if(req.method !== "GET") return;

  event.respondWith((async () => {
    const url = new URL(req.url);

    // same-origin: prefer network so updates show up quickly, then fallback to cache
    if(url.origin === self.location.origin){
      try{
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        if(fresh && fresh.ok) cache.put(req, fresh.clone());
        return fresh;
      }catch(e){
        const cached = await caches.match(req);
        if(cached) return cached;
        // offline fallback to app shell for app routes
        return caches.match("./index.html");
      }
    }

    // cross-origin: try network first
    try{
      return await fetch(req);
    }catch(e){
      return new Response("", { status: 503, statusText: "Offline" });
    }
  })());
});
