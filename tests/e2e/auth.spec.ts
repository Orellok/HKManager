import type { BrowserContext, Page } from "@playwright/test";

import { getLocalSupabaseEnv } from "../support/local-supabase-env";
import { createServiceRoleClient, expect, test } from "./support/auth-fixtures";

const SUPABASE_ORIGIN = new URL(getLocalSupabaseEnv().url).origin;
const PROTECTED_PATHS = ["/", "/clients", "/this-page-does-not-exist"];
const MIN_FOCUS_CONTRAST = 3;
const VIEWPORT_WIDTHS_BY_PROJECT: Record<string, number[]> = {
  android: [360, 412],
  desktop: [1280],
};

async function authCookieNames(context: BrowserContext): Promise<string[]> {
  return (await context.cookies())
    .map((cookie) => cookie.name)
    .filter((name) => name.startsWith("sb-") && name.includes("-auth-token"));
}

/** Resolves any CSS color to sRGB through a canvas, then returns the WCAG contrast ratio. */
async function contrastRatio(page: Page, foreground: string, background: string) {
  return page.evaluate(
    ([fg, bg]) => {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext("2d", { willReadFrequently: true })!;
      const luminance = (color: string) => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
        const channel = (value: number) => {
          const c = value / 255;
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
      };
      const [lighter, darker] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
      return (lighter + 0.05) / (darker + 0.05);
    },
    [foreground, background],
  );
}

test.describe("AUTH-3: protected routes", () => {
  for (const path of PROTECTED_PATHS) {
    test(`AUTH-3: unauthenticated ${path} redirects to /login`, async ({ page, request }) => {
      const direct = await request.get(path, { maxRedirects: 0 });
      expect(direct.status()).toBe(307);
      expect(new URL(direct.headers()["location"], "http://x").pathname).toBe("/login");

      await page.goto(path);
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByText("דף הבית")).toHaveCount(0);
    });
  }

  test("AUTH-3: a forged auth cookie is not trusted", async ({ page, context, baseURL }) => {
    const ref = new URL(SUPABASE_ORIGIN).hostname.split(".")[0];
    await context.addCookies([
      {
        name: `sb-${ref}-auth-token`,
        value: `base64-${Buffer.from(
          JSON.stringify({
            access_token: "not.a.jwt",
            refresh_token: "forged",
            token_type: "bearer",
            expires_in: 3600,
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            user: { id: "00000000-0000-4000-8000-000000000000", email: "owner@example.com" },
          }),
        ).toString("base64url")}`,
        url: baseURL!,
      },
    ]);

    await page.goto("/");

    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe("M0.3-2: login screen", () => {
  test("M0.3-2: shows one Google sign-in button and no business details", async ({ page }) => {
    await page.goto("/login");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("כניסה");
    await expect(page.getByRole("button")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "כניסה עם Google" })).toBeVisible();
    await expect(page.getByRole("banner")).toHaveText("HKManager");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  });

  test("M0.3-2: the Google button is at least 44px tall", async ({ page }) => {
    await page.goto("/login");

    const box = await page.getByRole("button", { name: "כניסה עם Google" }).boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  });

  test("M0.3-2: keyboard focus shows a solid ring with at least 3:1 contrast", async ({ page }) => {
    await page.goto("/login");
    const button = page.getByRole("button", { name: "כניסה עם Google" });

    await page.keyboard.press("Tab");
    await expect(button).toBeFocused();

    const outline = await button.evaluate((element) => {
      const style = getComputedStyle(element);
      return { style: style.outlineStyle, width: style.outlineWidth, color: style.outlineColor };
    });
    const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(outline.style).toBe("solid");
    expect(parseFloat(outline.width)).toBeGreaterThanOrEqual(2);
    expect(await contrastRatio(page, outline.color, background)).toBeGreaterThanOrEqual(
      MIN_FOCUS_CONTRAST,
    );
  });

  test("M0.3-2: no horizontal scroll and no CSP violations", async ({ page }, testInfo) => {
    const violations: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" && message.text().includes("Content Security Policy")) {
        violations.push(message.text());
      }
    });

    for (const width of VIEWPORT_WIDTHS_BY_PROJECT[testInfo.project.name]) {
      for (const path of ["/login", "/unauthorized"]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(path, { waitUntil: "networkidle" });

        const { scrollWidth, clientWidth } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(scrollWidth, `horizontal scroll at ${width}px on ${path}`).toBeLessThanOrEqual(
          clientWidth,
        );
      }
    }
    expect(violations).toEqual([]);
  });
});

test.describe("AUTH-1: Google OAuth", () => {
  test("AUTH-1: the button starts Supabase's Google flow with PKCE and our callback", async ({
    page,
    baseURL,
  }) => {
    // Real Google needs OAuth clients from the owner; stop at Supabase's authorize endpoint.
    await page.route(`${SUPABASE_ORIGIN}/auth/v1/authorize**`, (route) =>
      route.fulfill({ status: 200, contentType: "text/plain", body: "authorize reached" }),
    );
    await page.goto("/login");

    const authorizeRequest = page.waitForRequest(`${SUPABASE_ORIGIN}/auth/v1/authorize**`);
    await page.getByRole("button", { name: "כניסה עם Google" }).click();
    const authorizeUrl = new URL((await authorizeRequest).url());

    expect(authorizeUrl.searchParams.get("provider")).toBe("google");
    expect(authorizeUrl.searchParams.get("redirect_to")).toBe(`${baseURL}/auth/callback`);
    expect(authorizeUrl.searchParams.get("code_challenge_method")).toBe("s256");
    expect(authorizeUrl.searchParams.get("code_challenge")).toBeTruthy();
    expect(authorizeUrl.searchParams.get("prompt")).toBe("select_account");
  });

  for (const [label, query] of [
    ["without a code", ""],
    ["with an OAuth error", "?error=access_denied&error_description=denied"],
    ["with an invalid code", "?code=not-a-real-code"],
  ]) {
    test(`AUTH-1: the callback ${label} returns to /login with an error`, async ({ page }) => {
      await page.goto(`/auth/callback${query}`);

      await expect(page).toHaveURL(/\/login\?error=signin$/);
      await expect(page.getByRole("alert").first()).toHaveText(
        "הכניסה לא הושלמה. ייתכן שהחשבון אינו מורשה להיכנס למערכת.",
      );
      expect(await authCookieNames(page.context())).toEqual([]);
    });
  }
});

test.describe("AUTH-2: allowlist enforcement", () => {
  test("AUTH-2: an allowlisted owner sees the home page and can sign out", async ({
    page,
    signIn,
  }) => {
    await signIn({ role: "owner" });

    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("דף הבית");

    await page.getByRole("banner").getByRole("button", { name: "יציאה" }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect(await authCookieNames(page.context())).toEqual([]);
    await expect(page.getByRole("button", { name: "יציאה" })).toHaveCount(0);

    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("AUTH-2: an admin sees the home page", async ({ page, signIn }) => {
    await signIn({ role: "admin" });

    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("דף הבית");
  });

  test("AUTH-2: a session outside the allowlist is deleted and 'אין הרשאה' is shown", async ({
    page,
    signIn,
  }) => {
    await signIn({ role: null });
    expect(await authCookieNames(page.context())).not.toEqual([]);

    await page.goto("/");

    await expect(page).toHaveURL(/\/unauthorized$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("אין הרשאה");
    await expect(page.getByText("החשבון הזה אינו מורשה להיכנס למערכת.")).toBeVisible();
    await expect(page.getByText("דף הבית")).toHaveCount(0);
    expect(await authCookieNames(page.context())).toEqual([]);
    await expect(page.getByRole("banner").getByRole("button")).toHaveCount(0);

    await page.getByRole("button", { name: "כניסה עם חשבון אחר" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("AUTH-2: removing a signed-in user from the allowlist ends access on the next request", async ({
    page,
    signIn,
  }) => {
    const account = await signIn({ role: "owner" });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("דף הבית");

    const { error } = await createServiceRoleClient()
      .from("allowed_users")
      .delete()
      .eq("email", account.email);
    expect(error).toBeNull();

    await page.goto("/");
    await expect(page).toHaveURL(/\/unauthorized$/);
    expect(await authCookieNames(page.context())).toEqual([]);
  });
});
