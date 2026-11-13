/**
 * TajirDz service worker.
 *
 * Registered in production only (see main.tsx). Strategy:
 *  - precache the shell so the app opens offline,
 *  - cache-first for static assets (fonts, icons, images),
 *  - stale-while-revalidate for viewed product/shop pages, so a product the
 *    retailer already looked at stays readable without a connection,
 *  - offline.html fallback for navigations that miss the network.
 */

// Bump whenever a precached asset changes, so installed clients drop the old
// copies instead of serving a stale logo from cache forever.
const VERSION = "v6";
const SHELL_CACHE = `tajirdz-shell-${VERSION}`;
const RUNTIME_CACHE = `tajirdz-runtime-${VERSION}`;

// Exactly the URLs index.html and the manifest reference, cache-busting query
// included — a mismatch here would precache one copy and serve another.
const SHELL_ASSETS = [
  "/",
  "/offline.html",
  "/logo.svg?v=3",
  "/favicon.svg?v=3",
  "/favicon-16.png?v=3",
  "/favicon-32.png?v=3",
  "/favicon-40.png?v=3",
  "/apple-touch-icon.png?v=3",
  "/icons/icon-192.png?v=3",
  "/icons/icon-512.png?v=3",
  "/icons/maskable-192.png?v=3",
  "/icons/maskable-512.png?v=3",
  "/og-image.png",
  "/manifest.webmanifest?v=3",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // Individually so one missing asset cannot fail the whole install.
      .then((cache) => Promise.allSettled(SHELL_ASSETS.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE && key !== RUNTIME_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/** Cache-first: immutable build assets never change under the same URL. */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

/** Stale-while-revalidate: serve instantly, refresh in the background. */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);
  return cached ?? (await network) ?? Response.error();
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache the realtime websocket or Convex API traffic: stale data in a
  // marketplace is worse than an error.
  if (url.pathname.startsWith("/api/") || url.pathname.includes("convex")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          // Remember product and shop pages the user actually visited.
          if (response.ok && /\/(product|shop)\//.test(url.pathname)) {
            const cache = await caches.open(RUNTIME_CACHE);
            cache.put(request, response.clone());
          }
          return response;
        } catch {
          const cached = await caches.match(request);
          if (cached) return cached;
          const offline = await caches.match("/offline.html");
          if (offline) return offline;
          return new Response(
            "<!doctype html><html dir='rtl' lang='ar'><body style='font-family:sans-serif;padding:2rem'><h1>ما كاينش اتصال</h1><p>عاود جرب ملي تولي نت.</p></body></html>",
            { headers: { "Content-Type": "text/html; charset=utf-8" } },
          );
        }
      })(),
    );
    return;
  }

  if (request.destination === "image" || request.destination === "font") {
    event.respondWith(cacheFirst(request, RUNTIME_CACHE));
    return;
  }

  event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
});