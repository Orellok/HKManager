import type { Page } from "@playwright/test";

import { createServiceRoleClient, expect, test_ } from "./support/data-fixtures";
import {
  MIN_TOUCH_TARGET,
  clickNavItem,
  expectNavCurrent,
  failServerActions,
} from "./support/helpers";

test_.beforeEach(async ({ signIn }) => {
  await signIn({ role: "owner" });
});

const SEEDED = [
  "תוכנות ורישיונות",
  "רכב ונסיעות",
  "שיווק ופרסום",
  "דוגמאות וחומרים",
  "הדפסות",
  "ציוד משרדי",
  "תקשורת",
  "השתלמויות",
  "ביטוח",
  "שירותים מקצועיים",
  "קבלני משנה (הדמיות)",
  "אחר",
];

function activeList(page: Page) {
  return page.getByRole("list", { name: "קטגוריות פעילות" });
}

function archivedList(page: Page) {
  return page.getByRole("list", { name: "קטגוריות בארכיון" });
}

/** Opens the settings screen and waits until it is interactive. */
async function gotoSettings(page: Page) {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("הגדרות");
}

async function activeNames(page: Page): Promise<string[]> {
  return activeList(page)
    .getByRole("listitem")
    .evaluateAll((items) => items.map((item) => item.querySelector("span")?.textContent ?? ""));
}

test_.describe("EXP-3: expense categories in הגדרות", () => {
  test_(
    "EXP-3 / M3-9: הגדרות opens from the navigation and lists the seeded categories in their order",
    async ({ page }) => {
      await page.goto("/");
      await clickNavItem(page, "הגדרות");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("הגדרות");
      await expectNavCurrent(page, "הגדרות");
      await expect(page.getByRole("heading", { level: 2, name: "קטגוריות הוצאה" })).toBeVisible();

      const names = await activeNames(page);
      expect(names.filter((name) => SEEDED.includes(name))).toEqual(SEEDED);
    },
  );

  test_(
    "EXP-3: adds a category with Enter, renames it, and the expense form offers it",
    async ({ page, token }) => {
      const name = `צילום ${token}`;
      await gotoSettings(page);
      await page.getByRole("link", { name: "הוספת קטגוריה" }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("קטגוריית הוצאה חדשה");
      const input = page.getByRole("textbox", { name: /^שם הקטגוריה/ });
      await input.fill(name);
      await input.press("Enter");

      await expect(page).toHaveURL(/\/settings$/);
      await expect(page.getByRole("status").filter({ hasText: "הקטגוריה נוספה." })).toBeVisible();
      await expect(activeList(page).getByRole("listitem").filter({ hasText: name })).toHaveCount(1);

      await page.getByRole("link", { name: `שינוי שם: ${name}` }).click();
      await expect(input).toHaveValue(name);
      await input.fill(`${name} מקצועי`);
      await page.getByRole("button", { name: "שמירת השם" }).click();
      await expect(
        page.getByRole("status").filter({ hasText: "שם הקטגוריה עודכן." }),
      ).toBeVisible();

      await page.goto("/expenses/new");
      await expect(
        page
          .getByRole("combobox", { name: /^קטגוריה/ })
          .locator("option", { hasText: `${name} מקצועי` }),
      ).toHaveCount(1);
    },
  );

  test_(
    "EXP-3: a taken or empty name is refused beside the field, keeps the input and takes focus",
    async ({ page }) => {
      await page.goto("/settings/categories/new");
      const input = page.getByRole("textbox", { name: /^שם הקטגוריה/ });
      await page.getByRole("button", { name: "הוספת הקטגוריה" }).click();
      await expect(page.getByText("יש להזין שם לקטגוריה.")).toBeVisible();
      await expect(input).toBeFocused();

      await input.fill("הדפסות");
      await page.getByRole("button", { name: "הוספת הקטגוריה" }).click();

      await expect(
        page.getByText("כבר יש קטגוריה בשם הזה (אולי בארכיון). יש לבחור שם אחר."),
      ).toBeVisible();
      await expect(input).toBeFocused();
      await expect(input).toHaveValue("הדפסות");
      await expect(input).toHaveAttribute("aria-invalid", "true");
    },
  );

  test_(
    "EXP-3: moves a category up and down; focus stays on the button and the new place is announced",
    async ({ page, token, seedCategory }) => {
      const first = `ראשונה ${token}`;
      const second = `שנייה ${token}`;
      await seedCategory(first);
      await seedCategory(second);
      await gotoSettings(page);
      // Other tests may add categories meanwhile, so places are checked relative to before.
      const before = (await activeNames(page)).indexOf(second);
      expect(before).toBeGreaterThan(0);

      const up = page.getByRole("button", { name: `למעלה: ${second}` });
      await up.click();

      await expect(
        page.getByRole("status").filter({ hasText: `"${second}" הועברה למקום` }),
      ).toHaveText(/הועברה למקום \d+ מתוך \d+\./);
      await expect(up).toBeFocused();
      await expect.poll(async () => (await activeNames(page)).indexOf(second)).toBe(before - 1);

      const down = page.getByRole("button", { name: `למטה: ${second}` });
      await down.click();
      await expect.poll(async () => (await activeNames(page)).indexOf(second)).toBe(before);
      await expect(down).toBeFocused();
      const box = await up.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    },
  );

  test_(
    "EXP-3: the first category's למעלה is marked unavailable and answers that it is already first",
    async ({ page }) => {
      await gotoSettings(page);
      const firstName = (await activeNames(page))[0];
      const up = page.getByRole("button", { name: `למעלה: ${firstName}` });
      await expect(up).toHaveAttribute("aria-disabled", "true");

      // aria-disabled is a hint only: the button stays focusable and still asks the database.
      await up.focus();
      await page.keyboard.press("Enter");

      await expect(
        page.getByRole("status").filter({ hasText: "הקטגוריה כבר ראשונה ברשימה." }),
      ).toBeVisible();
      await expect(up).toBeFocused();
    },
  );

  test_(
    "owner decision (M3): archive hides a category from new expenses, keeps it in the filter, and restore brings it back",
    async ({ page, token, seedCategory }) => {
      const name = `זמנית ${token}`;
      await seedCategory(name);
      await gotoSettings(page);

      await page.getByRole("button", { name: `העברה לארכיון: ${name}` }).click();

      await expect(
        page
          .getByRole("status")
          .filter({ hasText: "הקטגוריה הועברה לארכיון. היא לא תוצע בהוצאות חדשות." }),
      ).toBeVisible();
      const restore = page.getByRole("button", { name: `החזרה מהארכיון: ${name}` });
      await expect(restore).toBeFocused();
      await expect(archivedList(page).getByRole("listitem").filter({ hasText: name })).toHaveCount(
        1,
      );
      await expect(activeList(page).getByRole("listitem").filter({ hasText: name })).toHaveCount(0);

      await page.goto("/expenses/new");
      await expect(
        page.getByRole("combobox", { name: /^קטגוריה/ }).locator("option", { hasText: name }),
      ).toHaveCount(0);
      await page.goto("/expenses");
      await expect(
        page
          .getByRole("combobox", { name: "קטגוריה" })
          .locator("option", { hasText: `${name} (בארכיון)` }),
      ).toHaveCount(1);

      await gotoSettings(page);
      await page.getByRole("button", { name: `החזרה מהארכיון: ${name}` }).click();
      await expect(
        page.getByRole("status").filter({ hasText: "הקטגוריה הוחזרה מהארכיון." }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: `העברה לארכיון: ${name}` })).toBeFocused();
      const { data } = await createServiceRoleClient()
        .from("expense_categories")
        .select("archived_at")
        .eq("name", name)
        .single();
      expect(data).toEqual({ archived_at: null });
    },
  );

  test_(
    "M3-11: a failed archive or move shows an inline error and changes nothing",
    async ({ page, token, seedCategory }) => {
      const name = `כשל ${token}`;
      await seedCategory(name);
      await gotoSettings(page);
      const restore = await failServerActions(page, "abort");

      await page.getByRole("button", { name: `העברה לארכיון: ${name}` }).click();
      await expect(
        page.getByRole("status").filter({ hasText: "הפעולה לא בוצעה. בדקו את החיבור ונסו שוב." }),
      ).toBeVisible();
      await page.getByRole("button", { name: `למעלה: ${name}` }).click();
      await expect(
        page.getByRole("status").filter({ hasText: "הפעולה לא בוצעה. בדקו את החיבור ונסו שוב." }),
      ).toBeVisible();
      await restore();

      await expect(activeList(page).getByRole("listitem").filter({ hasText: name })).toHaveCount(1);
    },
  );
});

test_.describe("M3-9: the עוד menu on mobile", () => {
  test_(
    "M3-9: עוד is a disclosure: Enter opens it, Escape closes it and returns focus; a click outside closes it",
    async ({ page }, testInfo) => {
      test_.skip(testInfo.project.name !== "android", "The bottom bar exists on mobile only");
      await page.goto("/");
      const nav = page.getByRole("navigation", { name: "ניווט ראשי" });
      const more = nav.getByRole("button", { name: "עוד" });
      await expect(more).toHaveAttribute("aria-expanded", "false");
      await expect(more).not.toHaveAttribute("aria-current", /.*/);
      await expect(nav.getByRole("link", { name: "הוצאות" })).toHaveCount(0);

      await more.focus();
      await expect(async () => {
        await more.press("Enter");
        await expect(more).toHaveAttribute("aria-expanded", "true", { timeout: 1000 });
      }).toPass();
      const menu = page.locator(`#${await more.getAttribute("aria-controls")}`);
      await expect(menu.getByRole("link")).toHaveText(["חובות", "הוצאות", "הגדרות"]);
      for (const link of await menu.getByRole("link").all()) {
        expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
      }

      await page.keyboard.press("Tab");
      await expect(menu.getByRole("link", { name: "חובות" })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(more).toHaveAttribute("aria-expanded", "false");
      await expect(more).toBeFocused();

      // M4.1 carry-over: tabbing out of the menu (past its last link, or back before the
      // button) closes it.
      await more.press("Enter");
      await expect(more).toHaveAttribute("aria-expanded", "true");
      for (let step = 0; step < 4; step += 1) {
        await page.keyboard.press("Tab");
      }
      await expect(more).toHaveAttribute("aria-expanded", "false");
      await more.focus();
      await more.press("Enter");
      await expect(more).toHaveAttribute("aria-expanded", "true");
      await page.keyboard.press("Shift+Tab");
      await expect(more).toHaveAttribute("aria-expanded", "false");

      await more.click();
      await expect(more).toHaveAttribute("aria-expanded", "true");
      await page.getByRole("heading", { level: 1 }).click();
      await expect(more).toHaveAttribute("aria-expanded", "false");

      await more.click();
      await menu.getByRole("link", { name: "הוצאות" }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("הוצאות");
      await expect(more).toHaveAttribute("aria-expanded", "false");
      await expect(more).toHaveAttribute("aria-current", "true");
      await more.click();
      await expect(menu.getByRole("link", { name: "הוצאות" })).toHaveAttribute(
        "aria-current",
        "page",
      );
    },
  );
});
