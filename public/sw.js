// Service worker for PWA installability only.
//
// It deliberately does NOT intercept API traffic or hashed build output:
//   - API requests must reach the network untouched so the app sees real
//     errors and real CORS behaviour, never a stale or cached response.
//   - /_next/static/* is content-hashed and served immutable by Pages, so
//     touching it here would only add a second, stale-prone cache layer.
//
// Navigations are network-first with a real cached shell fallback so the app
// still opens offline. The shell is cached at install time; a failure to find
// it falls through to the network instead of resolving to `undefined`, which
// would surface as a blank page.

const SHELL = "/index.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open("msrooms-shell-v1")
      .then((cache) => cache.addAll([SHELL, "/ms-rooms-logo.svg"]))
      .catch(() => undefined)
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== "msrooms-shell-v1").map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== "GET") return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/_next/static/")) return;

  if (req.mode !== "navigate") return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          // Cache under the request URL, not a fixed key: caching every page
          // under /index.html meant an offline /lobby could serve /wallet.
          void caches.open("msrooms-shell-v1").then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(req, { ignoreSearch: true });
        return cached || Response.error();
      })
  );
});
