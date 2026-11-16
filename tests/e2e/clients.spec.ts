import { randomUUID } from "node:crypto";

import type { Page } from "@playwright/test";

import { createServiceRoleClient, expect, test_ } from "./support/data-fixtures";
import {
  MIN_TOUCH_TARGET,
  VIEWPORT_WIDTHS_BY_PROJECT,
  activeElementText,
  clickThreeTimesSynchronously,
  failServerActions,
  trackCspViolations,
} from "./support/helpers";

test_.beforeEach(async ({ signIn }) => {
  await signIn({ role: "owner" });
});

function nameField(page: Page) {
  return page.getByRole("textbox", { name: /^שם/ });
}

function clientList(page: Page) {
  return page.getByRole("list", { name: "רשימת הלקוחות" });
}

async function searchFor(page: Page, query: string) {
  await page.getByRole("searchbox", { name: "חיפוש לפי שם או טלפון" }).fill(query);
  await page.getByRole("button", { name: "חיפוש", exact: true }).click();
  // The result summary appears once the search has answered; until then the full list shows.
  await expect(
    page.getByRole("status").filter({ hasText: /^(נמצא|מוצגים|לא נמצאו)/ }),
  ).toBeVisible();
}

test_.describe("CLI-1: create and edit", () => {
  test_("CLI-1: creates a client with every field and opens its card", async ({ page, token }) => {
    const name = `דנה לוי ${token}`;
    await page.goto("/clients");
    await page.getByRole("link", { name: "לקוח חדש" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("לקוח חדש");

    await nameField(page).fill(name);
    await page.getByRole("textbox", { name: "טלפון" }).fill("050-123-4567");
    await page.getByRole("textbox", { name: "מייל" }).fill("dana@example.com");
    await page.getByRole("textbox", { name: "כתובת" }).fill("הרצל 1, תל אביב");
    await page.getByRole("textbox", { name: "הערות" }).fill("מטבח וסלון");
    await page.getByRole("button", { name: "שמירת לקוח" }).click();

    await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
    await expect(page.getByRole("status").filter({ hasText: "הלקוח נשמר." })).toBeVisible();
    await expect(page.getByRole("link", { name: "050-123-4567" })).toHaveAttribute(
      "href",
      "tel:0501234567",
    );
    await expect(page.getByRole("link", { name: "dana@example.com" })).toBeVisible();
    await expect(page.getByText("הרצל 1, תל אביב")).toBeVisible();
    await expect(page.getByText("מטבח וסלון")).toBeVisible();
  });

  test_("CLI-1: creates a client with a name only", async ({ page, token }) => {
    await page.goto("/clients/new");

    await nameField(page).fill(`רק שם ${token}`);
    await page.getByRole("button", { name: "שמירת לקוח" }).click();

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`רק שם ${token}`);
    await expect(page.getByText("לא הוזן")).toHaveCount(4);
  });

  test_(
    "CLI-1: shows Hebrew errors next to the fields, keeps the input and focuses the first error",
    async ({ page, token }) => {
      await page.goto("/clients/new");

      await page.getByRole("textbox", { name: "טלפון" }).fill("050-abc");
      await page.getByRole("textbox", { name: "מייל" }).fill("not-an-email");
      await page.getByRole("textbox", { name: "הערות" }).fill(`הערה ${token}`);
      await page.getByRole("button", { name: "שמירת לקוח" }).click();

      await expect(page).toHaveURL(/\/clients\/new$/);
      await expect(page.getByRole("alert").first()).toHaveText(
        "לא ניתן לשמור. יש לתקן את השדות המסומנים.",
      );
      await expect(nameField(page)).toBeFocused();
      await expect(nameField(page)).toHaveAttribute("aria-invalid", "true");
      await expect(nameField(page)).toHaveAccessibleDescription("יש להזין שם לקוח.");
      await expect(page.getByRole("textbox", { name: "טלפון" })).toHaveAccessibleDescription(
        /יש להזין מספר טלפון בספרות/,
      );
      await expect(page.getByRole("textbox", { name: "מייל" })).toHaveAccessibleDescription(
        /כתובת מייל תקינה/,
      );
      await expect(page.getByRole("textbox", { name: "טלפון" })).toHaveValue("050-abc");
      await expect(page.getByRole("textbox", { name: "הערות" })).toHaveValue(`הערה ${token}`);

      await nameField(page).fill(`מתוקן ${token}`);
      await page.getByRole("textbox", { name: "טלפון" }).fill("050 1234567");
      await page.getByRole("textbox", { name: "מייל" }).fill("");
      await page.getByRole("button", { name: "שמירת לקוח" }).click();

      await expect(page.getByRole("heading", { level: 1 })).toHaveText(`מתוקן ${token}`);
    },
  );

  test_(
    "CLI-1: the Server Action validates and keeps the input when the browser does not",
    async ({ browser, context: signedInContext, baseURL, token }) => {
      // Without JavaScript the browser check does not run and the form posts to the Server
      // Action directly, so this exercises the server-side validation and the returned state.
      const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
      await context.addCookies(await signedInContext.cookies());
      const page = await context.newPage();
      await page.goto("/clients/new");

      await page.getByRole("textbox", { name: "טלפון" }).fill("050-abc");
      await page.getByRole("textbox", { name: "כתובת" }).fill(`כתובת ${token}`);
      await page.getByRole("button", { name: "שמירת לקוח" }).click();

      await expect(page.getByRole("textbox", { name: /^שם/ })).toHaveAccessibleDescription(
        "יש להזין שם לקוח.",
      );
      await expect(page.getByRole("textbox", { name: "טלפון" })).toHaveAccessibleDescription(
        /יש להזין מספר טלפון בספרות/,
      );
      await expect(page.getByRole("textbox", { name: "טלפון" })).toHaveValue("050-abc");
      await expect(page.getByRole("textbox", { name: "כתובת" })).toHaveValue(`כתובת ${token}`);
      await context.close();
    },
  );

  test_("CLI-1: edits a client's details", async ({ page, token, seedClient }) => {
    const id = await seedClient({ name: `לעריכה ${token}`, phone: "050-000-0000" });
    await page.goto(`/clients/${id}`);

    await page.getByRole("link", { name: "עריכת פרטים" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("עריכת לקוח");
    await expect(nameField(page)).toHaveValue(`לעריכה ${token}`);
    await page.getByRole("textbox", { name: "טלפון" }).fill("052-777-8888");
    await page.getByRole("textbox", { name: "כתובת" }).fill("רחוב חדש 5");
    await page.getByRole("button", { name: "שמירת שינויים" }).click();

    await expect(page).toHaveURL(new RegExp(`/clients/${id}$`));
    await expect(page.getByRole("status").filter({ hasText: "השינויים נשמרו." })).toBeVisible();
    await expect(page.getByRole("link", { name: "052-777-8888" })).toBeVisible();
    await expect(page.getByText("רחוב חדש 5")).toBeVisible();
  });

  test_(
    "CLI-1: a duplicate name shows a warning but does not block saving",
    async ({ page, token, seedClient }) => {
      await seedClient({ name: `Dana Levi ${token}` });
      await page.goto("/clients/new");

      await nameField(page).fill(`  dana LEVI ${token.toUpperCase()} `);
      await nameField(page).press("Tab");

      const warning = page.getByText("שימו לב: כבר קיים לקוח בשם הזה. אפשר לשמור בכל זאת.");
      await expect(warning).toBeVisible();
      await expect(nameField(page)).toHaveAccessibleDescription(/כבר קיים לקוח בשם הזה/);

      await page.getByRole("button", { name: "שמירת לקוח" }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        `dana LEVI ${token.toUpperCase()}`,
      );
    },
  );

  test_(
    "CLI-1: saving a duplicate name with Enter shows the duplicate notice on the card",
    async ({ page, token, seedClient }) => {
      await seedClient({ name: `Dana Levi ${token}` });
      await page.goto("/clients/new");

      await nameField(page).fill(`DANA levi ${token}`);
      await nameField(page).press("Enter");

      await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}$/);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(`DANA levi ${token}`);
      await expect(
        page
          .getByRole("status")
          .filter({ hasText: "הלקוח נשמר. שימו לב: כבר קיים לקוח נוסף בשם הזה." }),
      ).toBeVisible();
    },
  );

  test_(
    "CLI-1: saving a name that only an archived client has shows the archived notice",
    async ({ page, token, seedClient }) => {
      await seedClient({ name: `ארכיוני ${token}`, archived_at: new Date().toISOString() });
      await page.goto("/clients/new");

      await nameField(page).fill(`ארכיוני ${token}`);
      await nameField(page).press("Enter");

      await expect(
        page
          .getByRole("status")
          .filter({ hasText: "הלקוח נשמר. שימו לב: בארכיון כבר יש לקוח בשם הזה." }),
      ).toBeVisible();
    },
  );

  test_(
    "CLI-1: renaming a client to an existing name in the edit form shows the duplicate notice",
    async ({ page, token, seedClient }) => {
      await seedClient({ name: `יוסי כהן ${token}` });
      const id = await seedClient({ name: `שם אחר ${token}` });
      await page.goto(`/clients/${id}/edit`);

      await nameField(page).fill(`יוסי כהן ${token}`);
      await nameField(page).press("Enter");

      await expect(page).toHaveURL(new RegExp(`/clients/${id}$`));
      await expect(
        page
          .getByRole("status")
          .filter({ hasText: "השינויים נשמרו. שימו לב: כבר קיים לקוח נוסף בשם הזה." }),
      ).toBeVisible();
    },
  );

  test_(
    "CLI-1: saving the edit form without changing the name shows no duplicate notice",
    async ({ page, token, seedClient }) => {
      await seedClient({ name: `כפול ${token}` });
      const id = await seedClient({ name: `כפול ${token}` });
      await page.goto(`/clients/${id}/edit`);

      await page.getByRole("textbox", { name: "כתובת" }).fill("כתובת חדשה");
      await page.getByRole("textbox", { name: "כתובת" }).press("Enter");

      await expect(page.getByRole("status").filter({ hasText: "השינויים נשמרו." })).toHaveText(
        "השינויים נשמרו.",
      );
    },
  );

  test_("CLI-1: a unique name shows no duplicate warning", async ({ page, token }) => {
    await page.goto("/clients/new");

    await nameField(page).fill(`ייחודי ${token}`);
    await nameField(page).press("Tab");
    // Wait for the lookup to finish before asserting that nothing appeared.
    await page.waitForLoadState("networkidle");

    await expect(page.getByText(/כבר קיים לקוח בשם הזה/)).toHaveCount(0);
  });
});

test_.describe("CLI-3: search", () => {
  test_("CLI-3: finds a client by part of the name", async ({ page, token, seedClient }) => {
    await seedClient({ name: `יוסי כהן ${token}` });
    await seedClient({ name: `רונית ${token}` });
    await page.goto("/clients");

    await searchFor(page, `כהן ${token}`);

    await expect(page.getByRole("status").filter({ hasText: "נמצא לקוח אחד." })).toBeVisible();
    await expect(clientList(page).getByRole("link")).toHaveCount(1);
    await expect(clientList(page).getByRole("link")).toContainText(`יוסי כהן ${token}`);
    await expect(page).toHaveURL(/\/clients$/);
  });

  test_(
    "CLI-3: finds a client by phone without separators",
    async ({ page, token, seedClient }) => {
      // A phone unique to this test, stored with separators.
      const digits = `05${Math.floor(Math.random() * 1e8)
        .toString()
        .padStart(8, "0")}`;
      const stored = `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
      await seedClient({ name: `טלפון ${token}`, phone: stored });
      await page.goto("/clients");

      await searchFor(page, digits);

      await expect(clientList(page).getByRole("link")).toHaveCount(1);
      await expect(clientList(page).getByRole("link")).toContainText(`טלפון ${token}`);
      await expect(clientList(page).getByRole("link")).toContainText(stored);
    },
  );

  test_("CLI-3: an empty result says so and the search can be cleared", async ({ page, token }) => {
    await page.goto("/clients");

    await searchFor(page, `אין-כזה-${token}`);

    await expect(
      page.getByRole("status").filter({ hasText: "לא נמצאו לקוחות שמתאימים לחיפוש." }),
    ).toBeVisible();
    await page.getByRole("button", { name: "ניקוי החיפוש" }).click();
    await expect(page.getByRole("searchbox", { name: "חיפוש לפי שם או טלפון" })).toHaveValue("");
    await expect(page.getByRole("searchbox", { name: "חיפוש לפי שם או טלפון" })).toBeFocused();
    await expect(page.getByRole("button", { name: "ניקוי החיפוש" })).toHaveCount(0);
  });
});

test_.describe("CLI-2: archive, restore and delete", () => {
  test_(
    "CLI-2: archives a client and restores it from the archive",
    async ({ page, token, seedClient }) => {
      const name = `לארכיון ${token}`;
      const id = await seedClient({ name });
      await page.goto(`/clients/${id}`);

      await page.getByRole("button", { name: "העברה לארכיון" }).click();
      await expect(
        page.getByRole("status").filter({ hasText: "הלקוח הועבר לארכיון." }),
      ).toBeVisible();
      await expect(page.getByText("בארכיון", { exact: true })).toBeVisible();

      await page.goto("/clients");
      await searchFor(page, token);
      await expect(page.getByRole("status").filter({ hasText: "לא נמצאו" })).toBeVisible();

      await page.getByRole("link", { name: "ארכיון", exact: true }).click();
      await expect(page.getByRole("link", { name: "ארכיון", exact: true })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await searchFor(page, token);
      await clientList(page)
        .getByRole("link", { name: new RegExp(name) })
        .click();

      await page.getByRole("button", { name: "שחזור מהארכיון" }).click();
      await expect(
        page.getByRole("status").filter({ hasText: "הלקוח הוחזר מהארכיון." }),
      ).toBeVisible();
      await expect(page.getByText("בארכיון", { exact: true })).toHaveCount(0);

      await page.goto("/clients");
      await searchFor(page, token);
      await expect(clientList(page).getByRole("link")).toContainText(name);
    },
  );

  test_(
    "CLI-2: the delete dialog traps focus, cancels with Escape and returns focus",
    async ({ page, token, seedClient }) => {
      const id = await seedClient({ name: `לביטול ${token}` });
      await page.goto(`/clients/${id}`);
      const trigger = page.getByRole("button", { name: "מחיקה לצמיתות" });

      await trigger.click();
      const dialog = page.getByRole("dialog", { name: "למחוק את הלקוח לצמיתות?" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("button", { name: "ביטול" })).toBeFocused();
      // Tab moves between the dialog's two buttons only; the page behind is inert.
      await page.keyboard.press("Tab");
      await expect(dialog.getByRole("button", { name: "מחיקה לצמיתות" })).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(dialog.getByRole("button", { name: "ביטול" })).toBeFocused();

      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();

      await trigger.click();
      await dialog.getByRole("button", { name: "ביטול" }).click();
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(`לביטול ${token}`);
    },
  );

  test_(
    "CLI-2: permanently deletes a client after confirmation",
    async ({ page, token, seedClient }) => {
      const id = await seedClient({ name: `למחיקה ${token}` });
      await page.goto(`/clients/${id}`);

      await page.getByRole("button", { name: "מחיקה לצמיתות" }).click();
      await page
        .getByRole("dialog", { name: "למחוק את הלקוח לצמיתות?" })
        .getByRole("button", { name: "מחיקה לצמיתות" })
        .click();

      await expect(page).toHaveURL(/\/clients$/);
      await expect(page.getByRole("status").filter({ hasText: "הלקוח נמחק." })).toBeVisible();
      await searchFor(page, token);
      await expect(page.getByRole("status").filter({ hasText: "לא נמצאו" })).toBeVisible();

      const response = await page.goto(`/clients/${id}`);
      expect(response?.status()).toBe(404);
    },
  );
});

test_.describe("CLI-4: client card", () => {
  test_("CLI-4: an unknown or malformed client id shows the 404 screen", async ({ page }) => {
    for (const id of [randomUUID(), "not-a-uuid"]) {
      const response = await page.goto(`/clients/${id}`);

      expect(response?.status()).toBe(404);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("הדף לא נמצא");
    }
  });
});

test_.describe("M1.1-8: navigation", () => {
  test_("M1.1-8: shows only existing screens and marks the current item", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "ניווט ראשי" });

    // PRJ-1 (M1.2) adds פרויקטים.
    await expect(nav.getByRole("link")).toHaveText(["בית", "לקוחות", "פרויקטים"]);
    await expect(nav.getByRole("link", { name: "בית" })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "לקוחות" })).not.toHaveAttribute(
      "aria-current",
      /.*/,
    );

    await nav.getByRole("link", { name: "לקוחות" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("לקוחות");
    await expect(nav.getByRole("link", { name: "לקוחות" })).toHaveAttribute("aria-current", "page");

    await page.goto("/clients/new");
    await expect(nav.getByRole("link", { name: "לקוחות" })).toHaveAttribute("aria-current", "page");
    // Not by color alone: the current item is bold.
    const weights = await nav
      .getByRole("link")
      .evaluateAll((links) => links.map((link) => getComputedStyle(link).fontWeight));
    expect(weights).toEqual(["400", "700", "400"]);
  });

  test_(
    "M1.1-8: bottom navigation on mobile, side navigation on desktop, 44px targets",
    async ({ page }, testInfo) => {
      await page.goto("/clients");
      const nav = page.getByRole("navigation", { name: "ניווט ראשי" });
      const navBox = (await nav.boundingBox())!;
      const viewport = page.viewportSize()!;

      if (testInfo.project.name === "android") {
        expect(Math.round(navBox.y + navBox.height)).toBe(viewport.height);
        expect(Math.round(navBox.width)).toBe(viewport.width);
      } else {
        const mainBox = (await page.getByRole("main").boundingBox())!;
        // RTL: the side navigation is at the start (right) of the main content.
        expect(navBox.x).toBeGreaterThanOrEqual(mainBox.x + mainBox.width - 1);
        expect(navBox.height).toBeGreaterThan(navBox.width);
      }
      for (const link of await nav.getByRole("link").all()) {
        const box = (await link.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
      }
    },
  );

  test_(
    "M1.1-8: the navigation is not shown to visitors without a session",
    async ({ browser }) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto("/login");

      await expect(page.getByRole("navigation")).toHaveCount(0);
      await context.close();
    },
  );
});

test_.describe("M1.1-9: layout and states", () => {
  test_(
    "M1.1-9: no horizontal scroll and no CSP violations on the client screens",
    async ({ page, token, seedClient }, testInfo) => {
      const violations = await trackCspViolations(page);
      const id = await seedClient({
        name: `שם ארוך מאוד מאוד ${"ארוך".repeat(20)} ${token}`,
        phone: "+972 50-123-4567",
        email: `${"long".repeat(20)}@example.com`,
        address: "כתובת ארוכה ".repeat(10).trim(),
        notes: "הערה ארוכה ".repeat(50).trim(),
      });

      for (const width of VIEWPORT_WIDTHS_BY_PROJECT[testInfo.project.name]) {
        for (const path of ["/clients", "/clients/new", `/clients/${id}`, `/clients/${id}/edit`]) {
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
      // Exercise the code that runs zod and the Server Actions in the browser as well.
      await page.goto("/clients");
      await searchFor(page, token);
      await page.goto("/clients/new");
      await nameField(page).fill(token);
      await nameField(page).press("Tab");
      await page.getByRole("textbox", { name: "מייל" }).fill("not-an-email");
      await page.getByRole("button", { name: "שמירת לקוח" }).click();
      await expect(page.getByRole("textbox", { name: "מייל" })).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      await page.goto(`/clients/${id}`);
      await page.getByRole("button", { name: "מחיקה לצמיתות" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      expect(violations).toEqual([]);
    },
  );

  test_(
    "M1.1-9: the archive view has its own empty search message and filter state",
    async ({ page, token }) => {
      await page.goto("/clients?view=archived");
      const filters = page.getByRole("navigation", { name: "תצוגת לקוחות" });

      await expect(filters.getByRole("link", { name: "ארכיון" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await expect(filters.getByRole("link", { name: "פעילים" })).not.toHaveAttribute(
        "aria-current",
        /.*/,
      );
      await searchFor(page, token);
      await expect(page.getByRole("status").filter({ hasText: "לא נמצאו" })).toBeVisible();
    },
  );
});

test_.describe("M1.1-3: failed requests keep the screen and the input", () => {
  for (const mode of ["abort", "500"] as const) {
    test_(
      `CLI-1: a failed save (${mode}) shows an inline error and keeps the input`,
      async ({ page, token }) => {
        await page.goto("/clients/new");
        await nameField(page).fill(`נכשל ${token}`);
        await page.getByRole("textbox", { name: "טלפון" }).fill("050-1234567");
        await page.getByRole("textbox", { name: "הערות" }).fill("שורה ראשונה\nשורה שנייה");
        const restore = await failServerActions(page, mode);

        await page.getByRole("button", { name: "שמירת לקוח" }).click();

        await expect(page.getByRole("alert").first()).toHaveText(
          "לא ניתן לשמור כרגע. בדקו את החיבור ונסו שוב.",
        );
        await expect(page.getByRole("heading", { level: 1 })).toHaveText("לקוח חדש");
        await expect(nameField(page)).toHaveValue(`נכשל ${token}`);
        await expect(page.getByRole("textbox", { name: "טלפון" })).toHaveValue("050-1234567");
        await expect(page.getByRole("textbox", { name: "הערות" })).toHaveValue(
          "שורה ראשונה\nשורה שנייה",
        );
        await expect(page.getByRole("button", { name: "שמירת לקוח" })).not.toHaveAttribute(
          "aria-disabled",
          /.*/,
        );

        await restore();
        await page.getByRole("button", { name: "שמירת לקוח" }).click();
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(`נכשל ${token}`);
      },
    );
  }

  test_(
    "CLI-1: a failed duplicate check is ignored and keeps the input",
    async ({ page, token, seedClient }) => {
      await seedClient({ name: `כפול ${token}` });
      await page.goto("/clients/new");
      await page.getByRole("textbox", { name: "הערות" }).fill(`הערה ${token}`);
      const restore = await failServerActions(page, "abort");

      await nameField(page).fill(`כפול ${token}`);
      await nameField(page).press("Tab");
      await page.waitForLoadState("networkidle");

      await expect(page.getByRole("heading", { level: 1 })).toHaveText("לקוח חדש");
      await expect(page.getByText(/כבר קיים לקוח בשם הזה\. אפשר/)).toHaveCount(0);
      await expect(nameField(page)).toHaveValue(`כפול ${token}`);
      await expect(page.getByRole("textbox", { name: "הערות" })).toHaveValue(`הערה ${token}`);

      // With the connection back, saving still works and the card warns about the duplicate.
      await restore();
      await page.getByRole("button", { name: "שמירת לקוח" }).click();
      await expect(
        page
          .getByRole("status")
          .filter({ hasText: "הלקוח נשמר. שימו לב: כבר קיים לקוח נוסף בשם הזה." }),
      ).toBeVisible();
    },
  );

  test_(
    "CLI-3: a failed search shows the inline search error and keeps the query",
    async ({ page, token, seedClient }) => {
      await seedClient({ name: `חיפוש ${token}` });
      await page.goto("/clients");
      const restore = await failServerActions(page, "500");

      await page.getByRole("searchbox", { name: "חיפוש לפי שם או טלפון" }).fill(token);
      await page.getByRole("button", { name: "חיפוש", exact: true }).click();

      await expect(
        page.getByRole("alert").filter({ hasText: "החיפוש נכשל. אפשר לנסות שוב." }),
      ).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("לקוחות");
      await expect(page.getByRole("searchbox", { name: "חיפוש לפי שם או טלפון" })).toHaveValue(
        token,
      );

      await restore();
      await page.getByRole("button", { name: "חיפוש", exact: true }).click();
      await expect(page.getByRole("status").filter({ hasText: "נמצא לקוח אחד." })).toBeVisible();
      await expect(page.getByRole("alert").filter({ hasText: "החיפוש נכשל" })).toHaveCount(0);
    },
  );

  test_(
    "CLI-2: a failed archive shows an inline error and changes nothing",
    async ({ page, token, seedClient }) => {
      const id = await seedClient({ name: `ארכוב נכשל ${token}` });
      await page.goto(`/clients/${id}`);
      const restore = await failServerActions(page, "abort");

      await page.getByRole("button", { name: "העברה לארכיון" }).click();

      await expect(
        page.getByRole("status").filter({ hasText: "הפעולה לא בוצעה. בדקו את החיבור ונסו שוב." }),
      ).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(`ארכוב נכשל ${token}`);
      await expect(page.getByText("בארכיון", { exact: true })).toHaveCount(0);

      await restore();
      await page.getByRole("button", { name: "העברה לארכיון" }).click();
      await expect(
        page.getByRole("status").filter({ hasText: "הלקוח הועבר לארכיון." }),
      ).toBeVisible();
    },
  );

  test_(
    "CLI-2: a failed delete shows the error inside the dialog",
    async ({ page, token, seedClient }) => {
      const id = await seedClient({ name: `מחיקה נכשלה ${token}` });
      await page.goto(`/clients/${id}`);
      const restore = await failServerActions(page, "500");

      await page.getByRole("button", { name: "מחיקה לצמיתות" }).click();
      const dialog = page.getByRole("dialog", { name: "למחוק את הלקוח לצמיתות?" });
      await dialog.getByRole("button", { name: "מחיקה לצמיתות" }).click();

      await expect(dialog.getByRole("alert")).toHaveText(
        "הפעולה לא בוצעה. בדקו את החיבור ונסו שוב.",
      );
      await expect(dialog.getByRole("button", { name: "מחיקה לצמיתות" })).toBeFocused();
      await restore();
    },
  );
});

test_.describe("M1.2-11: duplicate submits, offline and rate limiting", () => {
  test_("CLI-1: three clicks in the same tick create one client", async ({ page, token }) => {
    await page.goto("/clients/new");
    await nameField(page).fill(`פעם אחת ${token}`);

    await clickThreeTimesSynchronously(page, "שמירת לקוח");

    await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}$/);
    await page.waitForLoadState("networkidle");
    const { data, error } = await createServiceRoleClient()
      .from("clients")
      .select("id")
      .eq("name", `פעם אחת ${token}`);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  test_(
    "CLI-1: saving while offline shows the inline error, keeps the input and stays",
    async ({ page, context, token }) => {
      await page.goto("/clients/new");
      await nameField(page).fill(`לא מקוון ${token}`);
      await page.getByRole("textbox", { name: "הערות" }).fill("הערה");
      await context.setOffline(true);

      await page.getByRole("button", { name: "שמירת לקוח" }).click();

      await expect(page.getByRole("alert").first()).toHaveText(
        "לא ניתן לשמור כרגע. בדקו את החיבור ונסו שוב.",
      );
      await expect(page).toHaveURL(/\/clients\/new$/);
      await expect(nameField(page)).toHaveValue(`לא מקוון ${token}`);
      await expect(page.getByRole("textbox", { name: "הערות" })).toHaveValue("הערה");

      await context.setOffline(false);
      await page.getByRole("button", { name: "שמירת לקוח" }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(`לא מקוון ${token}`);
    },
  );

  test_(
    "AUTH-3: a rate-limited session check (429) after a failed save does not sign out",
    async ({ page, token }) => {
      await page.goto("/clients/new");
      await nameField(page).fill(`הגבלה ${token}`);
      await page.route("**/auth/v1/user", (route) =>
        route.fulfill({
          status: 429,
          contentType: "application/json",
          body: JSON.stringify({ code: "over_request_rate_limit", message: "rate limit" }),
        }),
      );
      const restore = await failServerActions(page, "abort");

      await page.getByRole("button", { name: "שמירת לקוח" }).click();

      await expect(page.getByRole("alert").first()).toHaveText(
        "לא ניתן לשמור כרגע. בדקו את החיבור ונסו שוב.",
      );
      await expect(page).toHaveURL(/\/clients\/new$/);
      await restore();
    },
  );
});

test_.describe("M1.1-9: keyboard focus after actions", () => {
  test_(
    "CLI-3: load more keeps focus on the button, then moves it to the first new client",
    async ({ page, token }) => {
      const { error } = await createServiceRoleClient()
        .from("clients")
        .insert(
          Array.from({ length: 55 }, (_, index) => ({
            name: `${token} K${String(index).padStart(2, "0")}`,
          })),
        );
      expect(error).toBeNull();
      await page.goto("/clients");
      await searchFor(page, token);
      const more = page.getByRole("button", { name: "הצגת לקוחות נוספים" });

      await more.focus();
      await page.keyboard.press("Enter");
      await expect(clientList(page).getByRole("link")).toHaveCount(50);
      await expect(more).toBeFocused();

      await page.keyboard.press("Enter");
      await expect(clientList(page).getByRole("link")).toHaveCount(55);
      await expect(more).toHaveCount(0);
      await expect(clientList(page).getByRole("link", { name: `${token} K50` })).toBeFocused();
    },
  );

  test_(
    "CLI-3: the search button keeps focus after searching",
    async ({ page, token, seedClient }) => {
      await seedClient({ name: `מיקוד ${token}` });
      await page.goto("/clients");
      await page.getByRole("searchbox", { name: "חיפוש לפי שם או טלפון" }).fill(token);
      const button = page.getByRole("button", { name: "חיפוש", exact: true });

      await button.focus();
      await page.keyboard.press("Enter");

      await expect(page.getByRole("status").filter({ hasText: "נמצא לקוח אחד." })).toBeVisible();
      await expect(button).toBeFocused();
      expect(await activeElementText(page)).toBe("BUTTON:חיפוש");
    },
  );

  test_(
    "CLI-2: after archiving, focus is on the restore button, and back",
    async ({ page, token, seedClient }) => {
      const id = await seedClient({ name: `מיקוד ארכיון ${token}` });
      await page.goto(`/clients/${id}`);

      await page.getByRole("button", { name: "העברה לארכיון" }).focus();
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("status").filter({ hasText: "הלקוח הועבר לארכיון." }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "שחזור מהארכיון" })).toBeFocused();

      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("status").filter({ hasText: "הלקוח הוחזר מהארכיון." }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "העברה לארכיון" })).toBeFocused();
      expect(await activeElementText(page)).toBe("BUTTON:העברה לארכיון");
    },
  );
});

test_.describe("CLI-1: line breaks in notes", () => {
  test_(
    "CLI-1: notes of 2000 characters with line breaks are saved with \\n",
    async ({ page, token }) => {
      // 19 line breaks; 2000 characters as the browser counts them.
      const notes = `${"ג".repeat(99)}\n`.repeat(19) + "ג".repeat(2000 - 19 * 100);
      await page.goto("/clients/new");
      await nameField(page).fill(`הערות ${token}`);
      await page.getByRole("textbox", { name: "הערות" }).fill(notes);
      await expect(page.getByRole("textbox", { name: "הערות" })).toHaveValue(notes);

      await page.getByRole("button", { name: "שמירת לקוח" }).click();

      await expect(page.getByRole("heading", { level: 1 })).toHaveText(`הערות ${token}`);
      const { data, error } = await createServiceRoleClient()
        .from("clients")
        .select("notes")
        .eq("name", `הערות ${token}`)
        .single();
      expect(error).toBeNull();
      expect(data?.notes).toBe(notes);
    },
  );
});

test_.describe("AUTH-3: an ended session during an action goes to the login screen", () => {
  test_(
    "CLI-2: archiving after the session ended opens /login",
    async ({ page, context, token, seedClient }) => {
      const id = await seedClient({ name: `פג תוקף ${token}` });
      await page.goto(`/clients/${id}`);
      await context.clearCookies();

      await page.getByRole("button", { name: "העברה לארכיון" }).click();

      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("כניסה");
      const { data } = await createServiceRoleClient()
        .from("clients")
        .select("archived_at")
        .eq("id", id)
        .single();
      expect(data?.archived_at).toBeNull();
    },
  );

  test_("CLI-1: saving after the session ended opens /login", async ({ page, context, token }) => {
    await page.goto("/clients/new");
    await nameField(page).fill(`פג תוקף ${token}`);
    await context.clearCookies();

    await page.getByRole("button", { name: "שמירת לקוח" }).click();

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("כניסה");
    const { data } = await createServiceRoleClient()
      .from("clients")
      .select("id")
      .eq("name", `פג תוקף ${token}`);
    expect(data).toEqual([]);
  });

  test_(
    "CLI-3: searching after the session ended opens /login",
    async ({ page, context, token }) => {
      await page.goto("/clients");
      await context.clearCookies();

      await page.getByRole("searchbox", { name: "חיפוש לפי שם או טלפון" }).fill(token);
      await page.getByRole("button", { name: "חיפוש", exact: true }).click();

      await expect(page).toHaveURL(/\/login$/);
    },
  );
});
