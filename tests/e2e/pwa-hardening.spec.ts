import type { Page, Route } from "@playwright/test";

import { formatIsoDate, todayInJerusalem } from "../../src/lib/dates";
import { dayLabel, weekStart } from "../../src/lib/tasks/calendar";

import { createServiceRoleClient, expect, test_ } from "./support/data-fixtures";
import { trackCspViolations } from "./support/helpers";

/** M7.1: PWA files, idempotent create and the calendar carry-overs. */

const ROBOTS = "noindex, nofollow";

/**
 * Lets the next Server Action reach the server, then drops its answer, as a lost connection
 * after the server saved. Returns a function that stops dropping answers.
 */
async function loseNextActionAnswer(page: Page): Promise<() => Promise<void>> {
  const pattern = "**/*";
  let dropped = false;
  const handler = async (route: Route) => {
    const request = route.request();
    if (!dropped && request.method() === "POST" && request.headers()["next-action"]) {
      dropped = true;
      await route.fetch();
      await route.abort("internetdisconnected");
      return;
    }
    await route.continue();
  };
  await page.route(pattern, handler);
  return () => page.unroute(pattern, handler);
}

test_.describe("M7.1-1..6: PWA files without a session", () => {
  test_(
    "M7.1-5: manifest, service worker and icons are served without a session, with X-Robots-Tag",
    async ({ request }) => {
      const manifest = await request.get("/manifest.webmanifest", { maxRedirects: 0 });
      expect(manifest.status()).toBe(200);
      expect(manifest.headers()["content-type"]).toMatch(/manifest\+json|json/);
      expect(manifest.headers()["x-robots-tag"]).toBe(ROBOTS);
      const body = (await manifest.json()) as {
        name: string;
        lang: string;
        dir: string;
        display: string;
        icons: { src: string; sizes: string; purpose: string }[];
      };
      expect(body).toMatchObject({
        name: "HKManager",
        lang: "he",
        dir: "rtl",
        display: "standalone",
      });

      for (const icon of body.icons) {
        const response = await request.get(icon.src, { maxRedirects: 0 });
        expect(response.status(), icon.src).toBe(200);
        expect(response.headers()["content-type"]).toBe("image/png");
        expect(response.headers()["x-robots-tag"]).toBe(ROBOTS);
      }

      const sw = await request.get("/sw.js", { maxRedirects: 0 });
      expect(sw.status()).toBe(200);
      expect(sw.headers()["content-type"]).toMatch(/javascript/);
      expect(sw.headers()["cache-control"]).toBe("no-cache");
      expect(sw.headers()["service-worker-allowed"]).toBe("/");
      expect(sw.headers()["x-robots-tag"]).toBe(ROBOTS);

      // Look-alike paths are still protected by the proxy.
      for (const path of ["/sw.jsx", "/manifest.webmanifest.json", "/icons"]) {
        const response = await request.get(path, { maxRedirects: 0 });
        expect(response.status(), path).toBe(307);
        expect(response.headers()["location"]).toMatch(/\/login$/);
      }
    },
  );

  test_(
    "M7.1-4 / M7.1-6: pages link the manifest and the service worker activates under the nonce CSP",
    async ({ page }) => {
      const violations = await trackCspViolations(page);
      await page.goto("/login");
      await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
        "href",
        "/manifest.webmanifest",
      );
      await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#ffffff");
      const scriptUrl = await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.ready;
        return registration.active?.scriptURL ?? null;
      });
      expect(scriptUrl).toMatch(/\/sw\.js$/);
      // Pages are never cached: only build assets and icons are in the cache.
      await page.reload();
      const cached = await page.evaluate(async () => {
        const urls: string[] = [];
        for (const name of await caches.keys()) {
          const cache = await caches.open(name);
          urls.push(...(await cache.keys()).map((request) => new URL(request.url).pathname));
        }
        return urls;
      });
      expect(cached.length).toBeGreaterThan(0);
      for (const path of cached) {
        expect(path).toMatch(/^\/(_next\/static|icons)\//);
      }
      expect(violations).toEqual([]);
    },
  );
});

test_.describe("M7.1-8: a save whose answer was lost creates one row", () => {
  test_.beforeEach(async ({ signIn }) => {
    await signIn({ role: "owner" });
  });

  test_(
    "M7.1-8: saving a client again after a lost answer opens the client the first save created",
    async ({ page, token }) => {
      const name = `תשובה אבדה ${token}`;
      await page.goto("/clients/new");
      await page.getByRole("textbox", { name: /^שם/ }).fill(name);
      const restore = await loseNextActionAnswer(page);
      await page.getByRole("button", { name: "שמירת לקוח" }).click();
      await expect(page.getByRole("alert").first()).toHaveText(
        "לא ניתן לשמור כרגע. בדקו את החיבור ונסו שוב.",
      );
      await restore();

      await page.getByRole("button", { name: "שמירת לקוח" }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
      const { data, error } = await createServiceRoleClient()
        .from("clients")
        .select("id")
        .eq("name", name);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(page.url()).toContain(`/clients/${data![0].id}`);
    },
  );

  test_(
    "M7.1-8: a task saved again after a lost answer is created once; a new form creates another",
    async ({ page, token }) => {
      const title = `משימה תשובה אבדה ${token}`;
      await page.goto("/tasks/new");
      await page.getByRole("textbox", { name: /^כותרת/ }).fill(title);
      const restore = await loseNextActionAnswer(page);
      await page.getByRole("button", { name: "שמירת משימה" }).click();
      await expect(page.getByRole("alert").first()).toHaveText(
        "לא ניתן לשמור כרגע. בדקו את החיבור ונסו שוב.",
      );
      await restore();
      await page.getByRole("button", { name: "שמירת משימה" }).click();
      await expect(page).toHaveURL(/\/tasks(\?|$)/);

      await page.goto("/tasks/new");
      await page.getByRole("textbox", { name: /^כותרת/ }).fill(title);
      await page.getByRole("button", { name: "שמירת משימה" }).click();
      await expect(page).toHaveURL(/\/tasks(\?|$)/);

      const { count } = await createServiceRoleClient()
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("title", title);
      expect(count).toBe(2);
    },
  );
});

test_.describe("M7.1-10..12: calendar carry-overs", () => {
  test_.beforeEach(async ({ signIn }) => {
    await signIn({ role: "owner" });
  });

  test_(
    "M7.1-12: a task edited from the calendar returns to the same view and date (save and cancel)",
    async ({ page, token, seedTask }) => {
      const date = todayInJerusalem();
      const title = `מהיומן ${token}`;
      await seedTask({ title, due_date: date });
      const calendarUrl = `/calendar?view=week&date=${date}`;

      await page.goto(calendarUrl);
      await page.getByRole("link", { name: title }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("עריכת משימה");
      await page.getByRole("link", { name: "ביטול" }).click();
      await expect(page).toHaveURL(new RegExp(`/calendar\\?view=week&date=${date}$`));

      await page.getByRole("link", { name: title }).click();
      await page.getByRole("textbox", { name: /^כותרת/ }).fill(`${title} נערכה`);
      await page.getByRole("button", { name: "שמירת שינויים" }).click();
      await expect(page).toHaveURL(new RegExp(`/calendar\\?view=week&date=${date}`));
      await expect(page.getByRole("main")).toContainText(`${title} נערכה`);
    },
  );

  test_(
    "M7.1-11: choosing a month day with the keyboard keeps focus on that day",
    async ({ page }) => {
      await page.goto("/calendar?view=month&date=2026-11-17");
      const day = page.getByRole("link", { name: /^20 – יום שישי, 20\/11\/2026/ });
      await day.focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/view=month&date=2026-11-20/);
      await expect(
        page.getByRole("link", { name: /^20 – יום שישי, 20\/11\/2026.*נבחר$/ }),
      ).toBeFocused();
      await expect(
        page.getByRole("region", { name: new RegExp(`^${dayLabel("2026-11-20")}`) }),
      ).toBeVisible();
    },
  );

  test_(
    "M7.1-10: priority and overdue pills stay inside a narrow week column",
    async ({ page, token, seedTask }, testInfo) => {
      test_.skip(testInfo.project.name !== "desktop", "Week columns exist from the md breakpoint");
      const date = todayInJerusalem();
      const title = `גלישה ${token}`;
      await seedTask({ title, due_date: date, priority: "high" });
      await page.goto(`/calendar?view=week&date=${date}`);
      await expect(page.getByRole("heading", { level: 2 }).first()).toContainText(
        formatIsoDate(weekStart(date)),
      );
      const item = page.getByRole("listitem").filter({ hasText: title });
      const pill = item.getByText("עדיפות גבוהה");
      const itemBox = (await item.boundingBox())!;
      const pillBox = (await pill.boundingBox())!;
      expect(pillBox.x).toBeGreaterThanOrEqual(itemBox.x - 0.5);
      expect(pillBox.x + pillBox.width).toBeLessThanOrEqual(itemBox.x + itemBox.width + 0.5);
    },
  );
});
