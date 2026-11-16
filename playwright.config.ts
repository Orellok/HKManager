import { defineConfig, devices } from "@playwright/test";

import { getLocalSupabaseEnv } from "./tests/support/local-supabase-env";

const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

// The app and the auth fixtures run against the local Supabase stack (`pnpm db:start`).
const supabase = getLocalSupabaseEnv();

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  // Chromium only (SPEC section 10): an Android phone viewport and a desktop viewport.
  projects: [
    { name: "android", use: { ...devices["Pixel 7"] } },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
  ],
  // Tests run against a production build so the strict (non-development) CSP is verified.
  webServer: {
    command: `pnpm build && pnpm exec next start --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 240_000,
    // Only the public values: the app itself never needs the service role key.
    env: {
      NEXT_PUBLIC_SUPABASE_URL: supabase.url,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: supabase.anonKey,
    },
  },
});
