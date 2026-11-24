import type { HeaderEntry } from "../security-headers";

/**
 * M7.1-5: extra headers of /sw.js (next.config.ts, and netlify.toml for the CDN; kept in sync
 * by src/lib/netlify-headers.test.ts). Every page load checks for a new service worker
 * instead of using a cached copy, and the worker may control the whole app.
 */
export const SERVICE_WORKER_HEADERS: readonly HeaderEntry[] = [
  { key: "Cache-Control", value: "no-cache" },
  { key: "Service-Worker-Allowed", value: "/" },
];
