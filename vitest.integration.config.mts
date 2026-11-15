import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Integration tests against the local Supabase stack (`pnpm db:start` first).
// Kept separate from vitest.config.mts so `pnpm test` stays DB-free and fast.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    // Test files share one database; running them one at a time keeps them independent.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
