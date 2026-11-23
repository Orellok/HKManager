import type { NextConfig } from "next";

import { SERVICE_WORKER_HEADERS } from "./src/lib/pwa/headers";
import { STATIC_SECURITY_HEADERS } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  // Cache Components / partial prerendering are not used: the nonce-based CSP requires every
  // page to render dynamically (owner decision, M0.1).
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: [...STATIC_SECURITY_HEADERS] },
      { source: "/sw.js", headers: [...SERVICE_WORKER_HEADERS] },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
