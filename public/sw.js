/*
 * HKManager service worker (M7.1-3, SPEC 7: installability and a cache of static assets only,
 * no offline data).
 *
 * Only same-origin GET requests for build assets (/_next/static/, content-hashed and immutable)
 * and the app icons (/icons/) are answered from the cache, and stored there on first use. Every
 * other request (pages, RSC payloads, Server Actions, Route Handlers, files, Supabase) is not
 * intercepted at all: the browser fetches it as if there were no service worker, so no page or
 * data is ever cached and nothing works offline.
 *
 * M7.2-10 (NOTIF-4, 10): `push` shows the notification the push Edge Function sent
 * (supabase/functions/_shared/reminders.ts: title, body, url, tag); `notificationclick` brings
 * an open app window to that path, or opens one. Only same-origin paths are followed.
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

const NOTIFICATION_ICON = "/icons/icon-192.png";
const FALLBACK_NOTIFICATION = {
  title: "HKManager",
  body: "יש עדכון במשימות.",
  url: "/tasks",
  tag: "hkmanager-daily",
};
const MAX_TITLE_LENGTH = 100;
const MAX_BODY_LENGTH = 400;

function boundedText(value, maxLength, fallback) {
  return typeof value === "string" && value.trim() !== "" ? value.slice(0, maxLength) : fallback;
}

/** A same-origin path to open, or the tasks screen for anything else (NOTIF-10). */
function safeTargetPath(value) {
  if (typeof value === "string") {
    try {
      const url = new URL(value, self.location.origin);
      if (url.origin === self.location.origin) {
        return url.pathname + url.search + url.hash;
      }
    } catch {
      // Not a URL: falls through to the tasks screen.
    }
  }
  return FALLBACK_NOTIFICATION.url;
}

/** The payload as the function sends it; a missing or malformed one shows a generic text. */
function notificationFrom(event) {
  let data = null;
  try {
    data = event.data ? event.data.json() : null;
  } catch {
    data = null;
  }
  if (typeof data !== "object" || data === null) {
    return FALLBACK_NOTIFICATION;
  }
  return {
    title: boundedText(data.title, MAX_TITLE_LENGTH, FALLBACK_NOTIFICATION.title),
    body: boundedText(data.body, MAX_BODY_LENGTH, FALLBACK_NOTIFICATION.body),
    url: safeTargetPath(data.url),
    tag: boundedText(data.tag, MAX_TITLE_LENGTH, FALLBACK_NOTIFICATION.tag),
  };
}

self.addEventListener("push", (event) => {
  const notification = notificationFrom(event);
  event.waitUntil(
    self.registration.showNotification(notification.title, {
      body: notification.body,
      tag: notification.tag,
      // A newer summary replaces the one still shown, and still alerts.
      renotify: true,
      dir: "rtl",
      lang: "he",
      icon: NOTIFICATION_ICON,
      badge: NOTIFICATION_ICON,
      data: { url: notification.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = safeTargetPath(event.notification.data && event.notification.data.url);
  event.waitUntil(
    (async () => {
      const target = new URL(path, self.location.origin).href;
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (open) {
        try {
          const focused = await open.focus();
          await (focused || open).navigate(target);
          return;
        } catch {
          // A window that cannot be navigated (not controlled yet): open a new one instead.
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
