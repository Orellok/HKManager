import type { MetadataRoute } from "next";

/**
 * M7.1-1: the web app manifest (SPEC 2: the PWA is called HKManager; Hebrew, right to left).
 * Served by src/app/manifest.ts at /manifest.webmanifest, which Next links from every page.
 */

export const APP_NAME = "HKManager";
export const MANIFEST_PATH = "/manifest.webmanifest";
export const SERVICE_WORKER_PATH = "/sw.js";
export const ICONS_PATH_PREFIX = "/icons/";

/**
 * The manifest and the viewport need sRGB colors: --background (oklch 1 0 0) for the theme
 * and splash background, matching the app's white header (src/app/globals.css).
 */
export const THEME_COLOR = "#ffffff";

export function webAppManifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: APP_NAME,
    short_name: APP_NAME,
    lang: "he",
    dir: "rtl",
    start_url: "/",
    scope: "/",
    display: "standalone",
    theme_color: THEME_COLOR,
    background_color: THEME_COLOR,
    icons: [
      {
        src: `${ICONS_PATH_PREFIX}icon-192.png`,
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: `${ICONS_PATH_PREFIX}icon-512.png`,
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: `${ICONS_PATH_PREFIX}icon-maskable-512.png`,
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
