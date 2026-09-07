// Minimal service worker for PWA installability (Add to Home Screen).
self.addEventListener("install", (e) => {
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(self.clients.claim());
});
self.addEventListener("fetch", (e) => {
  // Network-first for navigation, cache-first is unnecessary for static export.
});
