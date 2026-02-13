/* Pocket Balance service worker
   - caches the app shell for offline use
   - keeps it intentionally small + readable
*/

const CACHE = "pb-cache-v1";
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

    // same-origin: prefer cache, fall back to network, then offline shell
    if(url.origin === self.location.origin){
      const cached = await caches.match(req);
      if(cached) return cached;

      try{
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
        return fresh;
      }catch(e){
        // offline fallback to app shell
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
