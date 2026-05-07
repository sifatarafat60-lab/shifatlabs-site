/* ══════════════════════════════════════════════
   Shifat Pro — Service Worker (sw.js)
   Strategy: Cache-first for static assets,
             Network-first for API/Supabase calls
══════════════════════════════════════════════ */

const CACHE_NAME = "shifat-prodhan-v1";
const OFFLINE_URL = "/offline.html";

// Assets to pre-cache on install
const PRECACHE_ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  // Google Fonts (loaded inside CSS, cached on first fetch)
  "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400&display=swap",
];

// Hosts that should ALWAYS go to the network (never serve stale)
const NETWORK_ONLY_HOSTS = [
  "supabase.co",   // Supabase REST / Storage API
  "lh3.googleusercontent.com", // Profile / dynamic images
];

/* ─── INSTALL ─── */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("[SW] Pre-caching shell assets");
      // Use individual adds so one failure doesn't break the whole install
      return Promise.allSettled(
        PRECACHE_ASSETS.map((url) =>
          cache.add(url).catch((err) =>
            console.warn(`[SW] Failed to pre-cache ${url}:`, err)
          )
        )
      );
    })
  );
  self.skipWaiting(); // Activate immediately
});

/* ─── ACTIVATE ─── */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => {
            console.log("[SW] Deleting old cache:", name);
            return caches.delete(name);
          })
      )
    )
  );
  self.clients.claim(); // Take control of all open pages immediately
});

/* ─── FETCH ─── */
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Only handle GET requests
  if (request.method !== "GET") return;

  // 2. Network-only for Supabase and dynamic Google image CDN
  if (NETWORK_ONLY_HOSTS.some((host) => url.hostname.includes(host))) {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(
          JSON.stringify({ error: "Offline — Supabase unavailable" }),
          { status: 503, headers: { "Content-Type": "application/json" } }
        )
      )
    );
    return;
  }

  // 3. Network-first for navigation requests (HTML pages)
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache a fresh copy
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(async () => {
          // Serve cached index or offline fallback
          const cached = await caches.match("/index.html");
          return cached || caches.match(OFFLINE_URL);
        })
    );
    return;
  }

  // 4. Cache-first for everything else (CSS, JS CDN libs, fonts, images)
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;

      // Not in cache — fetch, store, and return
      return fetch(request)
        .then((networkResponse) => {
          // Only cache valid same-origin or cors responses
          if (
            networkResponse.ok &&
            (networkResponse.type === "basic" || networkResponse.type === "cors")
          ) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return networkResponse;
        })
        .catch(() => {
          // Return nothing — browser will show its own error for non-nav requests
          console.warn("[SW] Network fetch failed for:", request.url);
        });
    })
  );
});

/* ─── MESSAGE: force update from client ─── */
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
