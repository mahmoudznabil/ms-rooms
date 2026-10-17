// Service worker for PWA installability only.
//
// It deliberately does NOT intercept API traffic or hashed build output:
//   - API requests must reach the network untouched so the app sees real
//     errors and real CORS behaviour, never a stale or cached response.
//   - /_next/static/* is content-hashed and served immutable by Pages, so
//     touching it here would only add a second, stale-prone cache layer.
//
// Navigations are network-first with a real cached shell fallback so the app
// still opens offline.
//
// WHY THE BUILD ID MATTERS
//
// This file used to be byte-identical across deploys, so the browser never
// re-installed it and the shell cached at install time stayed frozen at
// whatever the user's first visit returned. The shell references
// content-hASHED chunks, and Pages stops serving old chunks after a deploy --
// so anyone who hit any navigation failure fell back to a shell pointing at
// chunks that no longer existed, and got a stale UI or a blank page.
//
// That also explains a design change being deployed, verified in the build, and
// still invisible to a returning user. A static service worker cannot know the
// app changed; BUILD_ID below is substituted at build time so that it can.
//
// A failed navigation now falls back to a shell from the CURRENT build, because
// the cache name changes whenever the app does and the install re-runs.

// Substituted by scripts/stamp-sw.mjs after `next build`. Do not hardcode: a
// literal here is what froze the cached shell in the first place.
const BUILD_ID = "__BUILD_ID__";
const CACHE = `msrooms-shell-${BUILD_ID}`;

const SHELL = "/index.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([SHELL, "/ms-rooms-logo.svg"]))
      .catch(() => undefined)
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      // Every cache from a previous build is now dead weight: its shell points
      // at chunks this deploy no longer serves.
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
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
          void caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(req, { ignoreSearch: true });
        return cached || Response.error();
      })
  );
});