import { defineConfig, devices } from "@playwright/test";

import { getLocalSupabaseEnv } from "./tests/support/local-supabase-env";

const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;
/** M7.2: stands in for the push Edge Function (tests/support/push-function-mock.mts). */
export const PUSH_MOCK_PORT = 3101;
export const PUSH_MOCK_URL = `http://127.0.0.1:${PUSH_MOCK_PORT}`;
/** M7.2: a fixed public VAPID key for the build; the E2E tests never send a real push. */
export const E2E_VAPID_PUBLIC_KEY =
  "BNQFxdbe7A1uG9S5wrJgRc9OKDtCl_mNthw8ZbBet2sS0inCGHUhEu8Q3zFG5IF-R6q1W7SqafRiszzJGH2EhJ4";

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
    // M7.1: once the app's service worker controls a page, page.route() no longer sees the
    // page's requests, which the failed-request tests rely on. Only the PWA tests allow it
    // (tests/e2e/pwa-hardening.spec.ts).
    serviceWorkers: "block",
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
  webServer: [
    {
      command: `node tests/support/push-function-mock.mts ${PUSH_MOCK_PORT}`,
      url: PUSH_MOCK_URL,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `pnpm build && pnpm exec next start --port ${PORT}`,
      url: BASE_URL,
      reuseExistingServer: false,
      timeout: 240_000,
      // Only the public values: the app itself never needs the service role key.
      env: {
        NEXT_PUBLIC_SUPABASE_URL: supabase.url,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: supabase.anonKey,
        NEXT_PUBLIC_VAPID_PUBLIC_KEY: E2E_VAPID_PUBLIC_KEY,
        PUSH_FUNCTION_URL: `${PUSH_MOCK_URL}/functions/v1/push`,
      },
    },
  ],
});
