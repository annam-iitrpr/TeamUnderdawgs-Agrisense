/*
 * AgriSense service worker.
 *
 * The single most important property of this file is what it does NOT cache.
 *
 * Phase 3's acceptance criterion is that authenticated content is never cached
 * offline, and the build spec says the same: no global caching of authenticated
 * responses in a service worker. A farmer's field data, journal, recommendation
 * or ID token must not be recoverable from disk by the next person to open the
 * browser, and a stale spray recommendation served from cache would be worse
 * than no answer at all — the window it names may already have passed.
 *
 * So the policy is deliberately narrow:
 *
 *   - Precache only the offline fallback page and the app icons. These are
 *     static, public and identical for every user.
 *   - Same-origin GET navigations: network first, falling back to the offline
 *     page. Successful navigation responses are NEVER written to the cache,
 *     because an authenticated HTML document would land there.
 *   - Everything else — the API, any non-GET, anything cross-origin — bypasses
 *     the worker entirely and goes straight to the network.
 *
 * There is intentionally no runtime caching of API data. Read-only offline
 * access to explicitly chosen records is a separate, opt-in feature and belongs
 * in application state, not here.
 */

const VERSION = "v1";
const SHELL_CACHE = `agrisense-shell-${VERSION}`;
const OFFLINE_URL = "/offline.html";

const PRECACHE = [
  OFFLINE_URL,
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-192.png",
  "/icons/maskable-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Individually, so one missing asset cannot fail the whole install.
      await Promise.allSettled(PRECACHE.map((url) => cache.add(new Request(url, { cache: "reload" }))));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches from older versions of this worker.
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name.startsWith("agrisense-") && name !== SHELL_CACHE).map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

/** Anything that could carry per-user data must never be intercepted. */
function isNeverCacheable(url) {
  return (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/_next/data/") ||
    url.pathname.startsWith("/dev/")
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Non-GET can mutate state; never touch it.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Cross-origin (Firebase, tiles, fonts) is left to the browser.
  if (url.origin !== self.location.origin) return;

  if (isNeverCacheable(url)) return;

  // Navigations: try the network, fall back to the offline page. The response
  // is not stored — see the header comment.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          const offline = await cache.match(OFFLINE_URL);
          return (
            offline ??
            new Response("You are offline.", {
              status: 503,
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            })
          );
        }
      })(),
    );
    return;
  }

  // Precached public static assets only. A miss goes to the network and is not
  // added to the cache, so the cache can only ever hold what install() put there.
  event.respondWith(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      const hit = await cache.match(request, { ignoreSearch: true });
      if (hit) return hit;
      return fetch(request);
    })(),
  );
});

/**
 * Lets the app clear everything on sign-out.
 *
 * Even though no authenticated response is cached, the app asks for this on
 * identity change as a belt-and-braces measure: if a future change to this
 * file ever caches something it should not, sign-out still purges it.
 */
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "AGRISENSE_PURGE_CACHES") {
    event.waitUntil(
      (async () => {
        const names = await caches.keys();
        await Promise.all(names.filter((n) => n.startsWith("agrisense-")).map((n) => caches.delete(n)));
      })(),
    );
  }
});
