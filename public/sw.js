/*
 * HKManager service worker (M7.1-3, SPEC 7: installability and a cache of static assets only,
 * no offline data).
 *
 * Only same-origin GET requests for build assets (/_next/static/, content-hashed and immutable)
 * and the app icons (/icons/) are answered from the cache, and stored there on first use. Every
 * other request (pages, RSC payloads, Server Actions, Route Handlers, files, Supabase) is not
 * intercepted at all: the browser fetches it as if there were no service worker, so no page or
 * data is ever cached and nothing works offline. Push (`push` / `notificationclick`) is M7.2.
 */

const CACHE_VERSION = "v1";
const CACHE_PREFIX = "hkmanager-static-";
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;
const CACHED_PATH_PREFIXES = ["/_next/static/", "/icons/"];
/** Hashed assets of older deploys pile up; the oldest entries beyond this are removed. */
const MAX_CACHE_ENTRIES = 300;

function isCacheable(request) {
  if (request.method !== "GET") {
    return false;
  }
  const url = new URL(request.url);
  return (
    url.origin === self.location.origin &&
    url.search === "" &&
    CACHED_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))
  );
}

async function trimCache(cache) {
  const keys = await cache.keys();
  const excess = keys.length - MAX_CACHE_ENTRIES;
  for (let index = 0; index < excess; index += 1) {
    await cache.delete(keys[index]);
  }
}

/**
 * The cached copy, or the network's answer (stored when it is a complete same-origin answer).
 * The cache is only a speed-up: if it fails, the request still goes to the network.
 */
async function cacheFirst(request) {
  let cache;
  try {
    cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
  } catch {
    cache = undefined;
  }
  const response = await fetch(request);
  // Only complete same-origin answers; never errors, redirects or opaque responses.
  if (cache && response.ok && response.type === "basic") {
    try {
      await cache.put(request, response.clone());
      await trimCache(cache);
    } catch {
      // Storage full or unavailable: the asset is served uncached.
    }
  }
  return response;
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  if (isCacheable(event.request)) {
    event.respondWith(cacheFirst(event.request));
  }
});
