// Minimal service worker for PWA installability (Add to Home Screen).
// Network-first for navigation and API requests.
self.addEventListener("install", (e) => {
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(self.clients.claim());
});
self.addEventListener("fetch", (e) => {
  // Network-first for navigation and API requests
  if (e.request.mode === "navigate" || e.request.url.includes("/api/")) {
    e.respondWith(
      fetch(e.request).catch(() => {
        // Fallback to cache for navigation if network fails
        if (e.request.mode === "navigate") {
          return caches.match("/");
        }
      })
    );
  }
});