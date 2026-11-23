import type { MetadataRoute } from "next";

import { webAppManifest } from "@/lib/pwa/manifest";

/** M7.1-1: /manifest.webmanifest (no data; reachable without a session, see src/proxy.ts). */
export default function manifest(): MetadataRoute.Manifest {
  return webAppManifest();
}
