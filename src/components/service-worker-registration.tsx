"use client";

import { useEffect } from "react";

import { SERVICE_WORKER_PATH } from "@/lib/pwa/manifest";

/**
 * M7.1-4: registers the service worker (public/sw.js) in production builds, where it makes
 * the app installable and caches static assets. The app works without it, so an unsupported
 * browser or a failed registration is left alone.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) {
      return;
    }
    navigator.serviceWorker
      .register(SERVICE_WORKER_PATH, { scope: "/", updateViaCache: "none" })
      .catch(() => {
        // Not registered: the app keeps working, only without installability and the cache.
      });
  }, []);
  return null;
}
