import { randomUUID } from "node:crypto";

import type { Page } from "@playwright/test";

import { createServiceRoleClient, expect, test_ } from "./support/data-fixtures";
import {
  VIEWPORT_WIDTHS_BY_PROJECT,
  activeElementText,
  clickThreeTimesSynchronously,
  failServerActions,
  hasHorizontalScroll,
  trackCspViolations,
} from "./support/helpers";

test_.beforeEach(async ({ signIn }) => {
  await signIn({ role: "owner" });
});

const SAVE_UNAVAILABLE = "לא ניתן לשמור כרגע. בדקו את החיבור ונסו שוב.";
const REQUEST_FAILED = "הפעולה לא בוצעה. בדקו את החיבור ונסו שוב.";

function clientSelect(page: Page) {
  return page.getByRole("combobox", { name: /^לקוח/ });
}

function nameField(page: Page) {
  return page.getByRole("textbox", { name: /^שם הפרויקט/ });
}

function amountField(page: Page) {
  return page.getByRole("textbox", { name: "סכום חוזה (₪)" });
}

function projectList(page: Page) {
  return page.getByRole("list", { name: "רשימת הפרויקטים" });
}

/** The card's value for a detail label (a <dt>/<dd> pair). */
function detail(page: Page, label: string) {
  return page
    .locator("dl > div")
    .filter({ has: page.getByText(label, { exact: true }) })
    .locator("dd");
}

const RESULT_SUMMARY = /^(נמצא|מוצגים|לא נמצאו)/;

async function searchProjects(page: Page, query: string) {
  await page.getByRole("searchbox", { name: "חיפוש לפי שם פרויקט או שם לקוח" }).fill(query);
  await page.getByRole("button", { name: "חיפוש", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: RESULT_SUMMARY })).toBeVisible();
}

async function readProject(id: string) {
  const { data, error } = await createServiceRoleClient()
    .from("projects")
    .select("name, status, contract_amount, start_date, end_date, archived_at, client_id")
    .eq("id", id)
    .maybeSingle();
  expect(error).toBeNull();
  return data;
}

async function projectIdsNamed(name: string) {
  const { data, error } = await createServiceRoleClient()
    .from("projects")
    .select("id")
    .eq("name", name);
  expect(error).toBeNull();
  return (data ?? []).map((row) => row.id as string);
}

test_.describe("PRJ-1: create and edit", () => {
  test_(
    "PRJ-1: creates a project with every field and opens its card",
    async ({ page, token, seedClient }) => {
      const clientName = `דנה ${token}`;
      await seedClient({ name: clientName });
      await page.goto("/projects");
      await page.getByRole("link", { name: "פרויקט חדש" }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("פרויקט חדש");

      await clientSelect(page).selectOption({ label: clientName });
      await nameField(page).fill(`שיפוץ מטבח ${token}`);
      await page.getByRole("textbox", { name: "כתובת הנכס" }).fill("הרצל 1, תל אביב");
      await page.getByRole("combobox", { name: /^סטטוס/ }).selectOption({ label: "פעיל" });
      await amountField(page).fill("12,500.50");
      await page.getByLabel("תאריך התחלה").fill("2026-12-31");
      await page.getByLabel("תאריך סיום").fill("2027-01-01");
      await page.getByRole("textbox", { name: "הערות" }).fill("שורה ראשונה\nשורה שנייה");
      await page.getByRole("button", { name: "שמירת פרויקט" }).click();

      await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(`שיפוץ מטבח ${token}`);
      await expect(page.getByRole("status").filter({ hasText: "הפרויקט נשמר." })).toBeVisible();
      await expect(detail(page, "לקוח").getByRole("link", { name: clientName })).toBeVisible();
      await expect(detail(page, "כתובת הנכס")).toHaveText("הרצל 1, תל אביב");
      await expect(detail(page, "סטטוס")).toHaveText("פעיל");
      // he-IL currency format: direction marks keep "12,500.50 ₪" readable in RTL text.
      await expect(detail(page, "סכום חוזה")).toHaveText("‏12,500.50 ‏₪");
      await expect(detail(page, "תאריך התחלה")).toHaveText("31/12/2026");
      await expect(detail(page, "תאריך סיום")).toHaveText("01/01/2027");
      await expect(detail(page, "הערות")).toHaveText("שורה ראשונה\nשורה שנייה");

      const id = page.url().split("/").pop()!;
      expect(await readProject(id)).toMatchObject({
        status: "active",
        contract_amount: 1_250_050,
        start_date: "2026-12-31",
        end_date: "2027-01-01",
      });
    },
  );

  test_(
    "PRJ-1: creates a project with client and name only; status defaults to ליד",
    async ({ page, token, seedClient }) => {
      await seedClient({ name: `מינימום ${token}` });
      await page.goto("/projects/new");

      await clientSelect(page).selectOption({ label: `מינימום ${token}` });
      await nameField(page).fill(`רק שם ${token}`);
      await nameField(page).press("Enter");

      await expect(page.getByRole("heading", { level: 1 })).toHaveText(`רק שם ${token}`);
      await expect(detail(page, "סטטוס")).toHaveText("ליד");
      await expect(page.getByText("לא הוזן")).toHaveCount(5);
    },
  );

  test_(
    "PRJ-1: shows Hebrew errors next to the fields, keeps the input and focuses the first error",
    async ({ page, token, seedClient }) => {
      await seedClient({ name: `שגיאות ${token}` });
      await page.goto("/projects/new");

      await amountField(page).fill("12.505");
      await page.getByLabel("תאריך התחלה").fill("2026-11-16");
      await page.getByLabel("תאריך סיום").fill("2026-11-15");
      await page.getByRole("textbox", { name: "הערות" }).fill(`הערה ${token}`);
      await page.getByRole("button", { name: "שמירת פרויקט" }).click();

      await expect(page).toHaveURL(/\/projects\/new$/);
      await expect(page.getByRole("alert").first()).toHaveText(
        "לא ניתן לשמור. יש לתקן את השדות המסומנים.",
      );
      await expect(clientSelect(page)).toBeFocused();
      await expect(clientSelect(page)).toHaveAccessibleDescription("יש לבחור לקוח.");
      await expect(nameField(page)).toHaveAccessibleDescription("יש להזין שם פרויקט.");
      await expect(amountField(page)).toHaveAccessibleDescription(
        /אפשר להזין עד שתי ספרות אחרי הנקודה/,
      );
      await expect(page.getByLabel("תאריך סיום")).toHaveAccessibleDescription(
        "תאריך הסיום לא יכול להיות לפני תאריך ההתחלה.",
      );
      await expect(amountField(page)).toHaveValue("12.505");
      await expect(page.getByRole("textbox", { name: "הערות" })).toHaveValue(`הערה ${token}`);

      await clientSelect(page).selectOption({ label: `שגיאות ${token}` });
      await nameField(page).fill(`מתוקן ${token}`);
      await amountField(page).fill("-5");
      await page.getByLabel("תאריך סיום").fill("2026-11-16");
      await page.getByRole("button", { name: "שמירת פרויקט" }).click();
      await expect(amountField(page)).toHaveAccessibleDescription(/הסכום לא יכול להיות שלילי/);
      await expect(amountField(page)).toBeFocused();

      await amountField(page).fill("0");
      await page.getByRole("button", { name: "שמירת פרויקט" }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(`מתוקן ${token}`);
      await expect(detail(page, "סכום חוזה")).toContainText("0.00");
    },
  );

  test_(
    "PRJ-1: the Server Action validates and keeps the input when the browser does not",
    async ({ browser, context: signedInContext, baseURL, token, seedClient }) => {
      await seedClient({ name: `ללא JS ${token}` });
      const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
      await context.addCookies(await signedInContext.cookies());
      const page = await context.newPage();
      await page.goto("/projects/new");

      await clientSelect(page).selectOption({ label: `ללא JS ${token}` });
      await amountField(page).fill("abc");
      await page.getByRole("button", { name: "שמירת פרויקט" }).click();

      await expect(page.getByRole("textbox", { name: /^שם הפרויקט/ })).toHaveAccessibleDescription(
        "יש להזין שם פרויקט.",
      );
      await expect(amountField(page)).toHaveAccessibleDescription(/יש להזין סכום בספרות/);
      await expect(amountField(page)).toHaveValue("abc");
      await context.close();
    },
  );

  test_("PRJ-1: edits a project", async ({ page, token, seedClient, seedProject }) => {
    const clientId = await seedClient({ name: `עריכה ${token}` });
    const id = await seedProject({
      client_id: clientId,
      name: `לעריכה ${token}`,
      contract_amount: 1_250_000,
      start_date: "2026-11-16",
    });
    await page.goto(`/projects/${id}`);

    await page.getByRole("link", { name: "עריכת פרטים" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("עריכת פרויקט");
    await expect(amountField(page)).toHaveValue("12500");
    await expect(page.getByLabel("תאריך התחלה")).toHaveValue("2026-11-16");
    for (const label of ["תאריך התחלה", "תאריך סיום"]) {
      await expect(page.getByLabel(label)).toHaveAttribute("min", "1900-01-01");
      await expect(page.getByLabel(label)).toHaveAttribute("max", "2100-12-31");
    }
    await page.getByRole("combobox", { name: /^סטטוס/ }).selectOption({ label: "מושהה" });
    await amountField(page).fill("99,999,999.99");
    await page.getByRole("button", { name: "שמירת שינויים" }).click();

    await expect(page).toHaveURL(new RegExp(`/projects/${id}$`));
    await expect(page.getByRole("status").filter({ hasText: "השינויים נשמרו." })).toBeVisible();
    await expect(detail(page, "סטטוס")).toHaveText("מושהה");
    await expect(detail(page, "סכום חוזה")).toContainText("99,999,999.99");
    expect(await readProject(id)).toMatchObject({
      status: "on_hold",
      contract_amount: 9_999_999_999,
      start_date: "2026-11-16",
    });
  });

  test_(
    "PRJ-1: three clicks in the same tick create one project",
    async ({ page, token, seedClient }) => {
      await seedClient({ name: `כפול ${token}` });
      await page.goto("/projects/new");
      await clientSelect(page).selectOption({ label: `כפול ${token}` });
      await nameField(page).fill(`פעם אחת ${token}`);

      await clickThreeTimesSynchronously(page, "שמירת פרויקט");

      await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
      await page.waitForLoadState("networkidle");
      expect(await projectIdsNamed(`פעם אחת ${token}`)).toHaveLength(1);
    },
  );

  test_("PRJ-3: an unknown or malformed project id shows the 404 screen", async ({ page }) => {
    for (const id of [randomUUID(), "not-a-uuid"]) {
      const response = await page.goto(`/projects/${id}`);

      expect(response?.status()).toBe(404);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("הדף לא נמצא");
    }
  });
});

test_.describe("PRJ-1 / PRJ-2: list, search and status filter", () => {
  test_(
    "PRJ-2: the default list shows lead, active and on_hold; the filter shows the rest",
    async ({ page, token, seedClient, seedProject }) => {
      const clientId = await seedClient({ name: `סינון ${token}` });
      for (const status of ["lead", "active", "on_hold", "completed", "cancelled"] as const) {
        await seedProject({ client_id: clientId, name: `${status} ${token}`, status });
      }
      await page.goto("/projects");

      await searchProjects(page, token);
      await expect(projectList(page).getByRole("link")).toHaveCount(3);
      for (const [status, label] of [
        ["on_hold", "מושהה"],
        ["active", "פעיל"],
        ["lead", "ליד"],
      ] as const) {
        await expect(
          projectList(page).getByRole("link", { name: new RegExp(`${status} ${token}`) }),
        ).toContainText(label);
      }

      await page.getByRole("combobox", { name: "סטטוס" }).selectOption({ label: "הושלם" });
      await expect(page.getByRole("status").filter({ hasText: "נמצא פרויקט אחד." })).toBeVisible();
      await expect(projectList(page).getByRole("link")).toHaveText([
        new RegExp(`completed ${token}.*הושלם`),
      ]);

      await page.getByRole("combobox", { name: "סטטוס" }).selectOption({ label: "כל הסטטוסים" });
      await expect(page.getByRole("status").filter({ hasText: "נמצאו 5 פרויקטים." })).toBeVisible();
      await expect(page).toHaveURL(/\/projects$/);
    },
  );

  test_(
    "PRJ-1: finds projects by project name and by client name, without a URL query",
    async ({ page, token, seedClient, seedProject }) => {
      const clientId = await seedClient({ name: `רונית כהן ${token}` });
      const otherId = await seedClient({ name: `אחר ${token}` });
      await seedProject({ client_id: clientId, name: `סלון ${token}`, contract_amount: 500_000 });
      await seedProject({ client_id: otherId, name: `מרפסת ${token}` });
      await page.goto("/projects");

      await searchProjects(page, `סלון ${token}`);
      await expect(projectList(page).getByRole("link")).toHaveCount(1);
      await expect(projectList(page).getByRole("link")).toContainText(`רונית כהן ${token}`);
      await expect(projectList(page).getByRole("link")).toContainText("5,000.00");

      await searchProjects(page, `רונית כהן ${token}`);
      await expect(page.getByRole("status").filter({ hasText: "נמצא פרויקט אחד." })).toBeVisible();
      await expect(projectList(page).getByRole("link")).toContainText(`סלון ${token}`);
      await expect(page).toHaveURL(/\/projects$/);
    },
  );

  test_("PRJ-1: an empty result says so and the search can be cleared", async ({ page, token }) => {
    await page.goto("/projects");

    await searchProjects(page, `אין-כזה-${token}`);

    await expect(
      page.getByRole("status").filter({ hasText: "לא נמצאו פרויקטים שמתאימים לחיפוש." }),
    ).toBeVisible();
    await expect(page.getByText("אפשר לחפש בשם אחר או לבחור סטטוס אחר.")).toBeVisible();
    await page.getByRole("button", { name: "ניקוי החיפוש" }).click();
    await expect(
      page.getByRole("searchbox", { name: "חיפוש לפי שם פרויקט או שם לקוח" }),
    ).toBeFocused();
    await expect(page.getByRole("button", { name: "ניקוי החיפוש" })).toHaveCount(0);
  });

  test_(
    "PRJ-1: the list is sorted by last update",
    async ({ page, token, seedClient, seedProject }) => {
      const clientId = await seedClient({ name: `מיון ${token}` });
      const older = await seedProject({ client_id: clientId, name: `ישן ${token}` });
      await seedProject({ client_id: clientId, name: `חדש ${token}` });
      // Updating the older project moves it to the top.
      await createServiceRoleClient()
        .from("projects")
        .update({ property_address: "עודכן" })
        .eq("id", older);
      await page.goto("/projects");

      await searchProjects(page, token);

      await expect(projectList(page).getByRole("link")).toHaveText([
        new RegExp(`ישן ${token}`),
        new RegExp(`חדש ${token}`),
      ]);
    },
  );
});

test_.describe("PRJ-2: quick status changes", () => {
  test_(
    "PRJ-2: changing the status twice during a slow search shows the last choice and its results",
    async ({ page, token, seedClient, seedProject }) => {
      const clientId = await seedClient({ name: `מהיר ${token}` });
      await seedProject({ client_id: clientId, name: `הושלם ${token}`, status: "completed" });
      await seedProject({ client_id: clientId, name: `בוטל ${token}`, status: "cancelled" });
      await page.goto("/projects");
      await searchProjects(page, token);
      const searches: string[] = [];
      await page.route("**/*", async (route) => {
        const request = route.request();
        if (request.method() === "POST" && request.headers()["next-action"]) {
          searches.push(request.postData() ?? "");
          await new Promise((resolve) => setTimeout(resolve, 800));
        }
        await route.continue();
      });
      const filter = page.getByRole("combobox", { name: "סטטוס" });

      await filter.selectOption("completed");
      await filter.selectOption("cancelled");

      // The select shows the latest choice at once, while the first search still runs.
      await expect(filter).toHaveValue("cancelled");
      await expect(page.getByRole("status").filter({ hasText: "נמצא פרויקט אחד." })).toBeVisible();
      await expect(projectList(page).getByRole("link")).toHaveText([
        new RegExp(`בוטל ${token}.*בוטל`),
      ]);
      await expect(filter).toHaveValue("cancelled");
      // Two searches, one after the other; the stale "completed" result is never shown.
      expect(searches).toHaveLength(2);
      expect(searches[1]).toContain("cancelled");
    },
  );
});

test_.describe("PRJ-1: archive, restore and delete", () => {
  test_(
    "PRJ-1: archives a project and restores it from the archive",
    async ({ page, token, seedClient, seedProject }) => {
      const clientId = await seedClient({ name: `ארכיון ${token}` });
      const id = await seedProject({ client_id: clientId, name: `לארכיון ${token}` });
      await page.goto(`/projects/${id}`);

      await page.getByRole("button", { name: "העברה לארכיון" }).click();
      await expect(
        page.getByRole("status").filter({ hasText: "הפרויקט הועבר לארכיון." }),
      ).toBeVisible();
      await expect(page.getByText("בארכיון", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "שחזור מהארכיון" })).toBeFocused();

      await page.goto("/projects");
      await searchProjects(page, token);
      await expect(page.getByRole("status").filter({ hasText: "לא נמצאו" })).toBeVisible();

      const tabs = page.getByRole("navigation", { name: "תצוגת פרויקטים" });
      await tabs.getByRole("link", { name: "ארכיון" }).click();
      await expect(tabs.getByRole("link", { name: "ארכיון" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await searchProjects(page, token);
      await projectList(page)
        .getByRole("link", { name: new RegExp(`לארכיון ${token}`) })
        .click();

      await page.getByRole("button", { name: "שחזור מהארכיון" }).click();
      await expect(
        page.getByRole("status").filter({ hasText: "הפרויקט הוחזר מהארכיון." }),
      ).toBeVisible();
      await expect(page.getByText("בארכיון", { exact: true })).toHaveCount(0);
      expect((await readProject(id))?.archived_at).toBeNull();
    },
  );

  test_(
    "PRJ-1: permanently deletes a project after confirmation",
    async ({ page, token, seedClient, seedProject }) => {
      const clientId = await seedClient({ name: `מחיקה ${token}` });
      const id = await seedProject({ client_id: clientId, name: `למחיקה ${token}` });
      await page.goto(`/projects/${id}`);

      await page.getByRole("button", { name: "מחיקה לצמיתות" }).click();
      const dialog = page.getByRole("dialog", { name: "למחוק את הפרויקט לצמיתות?" });
      await expect(dialog.getByRole("button", { name: "ביטול" })).toBeFocused();
      await dialog.getByRole("button", { name: "מחיקה לצמיתות" }).click();

      await expect(page).toHaveURL(/\/projects$/);
      await expect(page.getByRole("status").filter({ hasText: "הפרויקט נמחק." })).toBeVisible();
      expect(await readProject(id)).toBeNull();
      const response = await page.goto(`/projects/${id}`);
      expect(response?.status()).toBe(404);
    },
  );
});

test_.describe("CLI-4 / CLI-2: projects on the client card", () => {
  test_(
    "CLI-4: the client card lists its projects and opens the form with the client chosen",
    async ({ page, token, seedClient, seedProject }) => {
      const clientName = `כרטיס ${token}`;
      const clientId = await seedClient({ name: clientName });
      await seedProject({
        client_id: clientId,
        name: `קיים ${token}`,
        status: "completed",
        contract_amount: 1_000_000,
      });
      await page.goto(`/clients/${clientId}`);

      const section = page.getByRole("region", { name: "פרויקטים" });
      await expect(section.getByRole("link", { name: new RegExp(`קיים ${token}`) })).toContainText(
        "הושלם",
      );
      await expect(section.getByRole("link", { name: new RegExp(`קיים ${token}`) })).toContainText(
        "10,000.00",
      );

      await section.getByRole("link", { name: "פרויקט חדש" }).click();
      await expect(page).toHaveURL(new RegExp(`/projects/new\\?client=${clientId}$`));
      await expect(clientSelect(page)).toHaveValue(clientId);
      await nameField(page).fill(`חדש מהכרטיס ${token}`);
      await page.getByRole("button", { name: "שמירת פרויקט" }).click();

      await expect(page.getByRole("heading", { level: 1 })).toHaveText(`חדש מהכרטיס ${token}`);
      await detail(page, "לקוח").getByRole("link", { name: clientName }).click();
      await expect(
        page
          .getByRole("region", { name: "פרויקטים" })
          .getByRole("link", { name: new RegExp(`חדש מהכרטיס ${token}`) }),
      ).toBeVisible();
    },
  );

  test_(
    "CLI-2: deleting a client that has projects is refused; archiving is offered",
    async ({ page, token, seedClient, seedProject }) => {
      const clientId = await seedClient({ name: `עם פרויקט ${token}` });
      await seedProject({ client_id: clientId, name: `שומר ${token}` });
      await page.goto(`/clients/${clientId}`);

      await page.getByRole("button", { name: "מחיקה לצמיתות" }).click();
      const dialog = page.getByRole("dialog", { name: "למחוק את הלקוח לצמיתות?" });
      await dialog.getByRole("button", { name: "מחיקה לצמיתות" }).click();

      await expect(dialog.getByRole("alert")).toHaveText(
        "אי אפשר למחוק לקוח שיש לו פרויקטים או הכנסות. אפשר להעביר אותו לארכיון.",
      );
      const { data } = await createServiceRoleClient()
        .from("clients")
        .select("id")
        .eq("id", clientId);
      expect(data).toHaveLength(1);
    },
  );
});

test_.describe("PRJ-1: no new project for an archived client (owner decision)", () => {
  test_(
    "PRJ-1: an archived client's card explains, and restoring brings back פרויקט חדש",
    async ({ page, token, seedClient }) => {
      const clientId = await seedClient({
        name: `ארכיוני ${token}`,
        archived_at: new Date().toISOString(),
      });
      await page.goto(`/clients/${clientId}`);
      const section = page.getByRole("region", { name: "פרויקטים" });

      await expect(section.getByRole("link", { name: "פרויקט חדש" })).toHaveCount(0);
      await expect(
        section.getByText("הלקוח בארכיון. כדי לפתוח לו פרויקט חדש, יש לשחזר אותו קודם מהארכיון."),
      ).toBeVisible();

      await page.getByRole("button", { name: "שחזור מהארכיון" }).click();
      await expect(section.getByRole("link", { name: "פרויקט חדש" })).toBeVisible();
    },
  );

  test_(
    "PRJ-1: the new-project page for an archived client explains and links to the card",
    async ({ page, token, seedClient }) => {
      const clientId = await seedClient({
        name: `ארכיוני ${token}`,
        archived_at: new Date().toISOString(),
      });

      await page.goto(`/projects/new?client=${clientId}`);

      await expect(page.getByText(`הלקוח "ארכיוני ${token}" בארכיון.`)).toBeVisible();
      await expect(nameField(page)).toHaveCount(0);
      await page.getByRole("link", { name: "לכרטיס הלקוח" }).click();
      await expect(page).toHaveURL(new RegExp(`/clients/${clientId}$`));
    },
  );

  test_(
    "PRJ-1: the server refuses a client archived after the form opened",
    async ({ page, token, seedClient }) => {
      const clientId = await seedClient({ name: `נארכב ${token}` });
      await page.goto(`/projects/new?client=${clientId}`);
      await nameField(page).fill(`נדחה ${token}`);
      await createServiceRoleClient()
        .from("clients")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", clientId);

      await page.getByRole("button", { name: "שמירת פרויקט" }).click();

      await expect(clientSelect(page)).toHaveAccessibleDescription(
        "הלקוח בארכיון. כדי לפתוח לו פרויקט, יש לשחזר אותו קודם מהארכיון.",
      );
      await expect(clientSelect(page)).toBeFocused();
      await expect(nameField(page)).toHaveValue(`נדחה ${token}`);
      expect(await projectIdsNamed(`נדחה ${token}`)).toEqual([]);
    },
  );
});

test_.describe("M1.2-10: failed requests keep the screen and the input", () => {
  for (const mode of ["abort", "500"] as const) {
    test_(
      `PRJ-1: a failed save (${mode}) shows an inline error and keeps the input`,
      async ({ page, token, seedClient }) => {
        await seedClient({ name: `נכשל ${token}` });
        await page.goto("/projects/new");
        await clientSelect(page).selectOption({ label: `נכשל ${token}` });
        await nameField(page).fill(`נכשל ${token}`);
        await amountField(page).fill("1,000");
        const restore = await failServerActions(page, mode);

        await page.getByRole("button", { name: "שמירת פרויקט" }).click();

        await expect(page.getByRole("alert").first()).toHaveText(SAVE_UNAVAILABLE);
        await expect(page.getByRole("heading", { level: 1 })).toHaveText("פרויקט חדש");
        await expect(nameField(page)).toHaveValue(`נכשל ${token}`);
        await expect(amountField(page)).toHaveValue("1,000");
        await expect(page.getByRole("button", { name: "שמירת פרויקט" })).toBeFocused();

        await restore();
        await page.getByRole("button", { name: "שמירת פרויקט" }).click();
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(`נכשל ${token}`);
      },
    );
  }

  test_(
    "PRJ-1: saving while offline shows the inline error and does not redirect",
    async ({ page, context, token, seedClient }) => {
      await seedClient({ name: `לא מקוון ${token}` });
      await page.goto("/projects/new");
      await clientSelect(page).selectOption({ label: `לא מקוון ${token}` });
      await nameField(page).fill(`לא מקוון ${token}`);
      await context.setOffline(true);

      await page.getByRole("button", { name: "שמירת פרויקט" }).click();

      await expect(page.getByRole("alert").first()).toHaveText(SAVE_UNAVAILABLE);
      await expect(page).toHaveURL(/\/projects\/new$/);
      await expect(nameField(page)).toHaveValue(`לא מקוון ${token}`);
      await context.setOffline(false);
    },
  );

  test_(
    "PRJ-1: a failed search keeps the query and shows the inline error",
    async ({ page, token }) => {
      await page.goto("/projects");
      const restore = await failServerActions(page, "500");

      await page.getByRole("searchbox", { name: "חיפוש לפי שם פרויקט או שם לקוח" }).fill(token);
      await page.getByRole("button", { name: "חיפוש", exact: true }).click();

      await expect(
        page.getByRole("alert").filter({ hasText: "החיפוש נכשל. אפשר לנסות שוב." }),
      ).toBeVisible();
      await expect(
        page.getByRole("searchbox", { name: "חיפוש לפי שם פרויקט או שם לקוח" }),
      ).toHaveValue(token);
      await restore();
    },
  );

  test_("PRJ-2: a failed status filter keeps the previous filter shown", async ({ page }) => {
    await page.goto("/projects");
    const restore = await failServerActions(page, "abort");

    await page.getByRole("combobox", { name: "סטטוס" }).selectOption({ label: "הושלם" });

    await expect(
      page.getByRole("alert").filter({ hasText: "החיפוש נכשל. אפשר לנסות שוב." }),
    ).toBeVisible();
    await expect(page.getByRole("combobox", { name: "סטטוס" })).toHaveValue("open");
    await restore();
  });

  test_(
    "PRJ-1: a failed archive shows an inline error and changes nothing",
    async ({ page, token, seedClient, seedProject }) => {
      const clientId = await seedClient({ name: `ארכוב נכשל ${token}` });
      const id = await seedProject({ client_id: clientId, name: `ארכוב נכשל ${token}` });
      await page.goto(`/projects/${id}`);
      const restore = await failServerActions(page, "abort");

      await page.getByRole("button", { name: "העברה לארכיון" }).click();

      await expect(page.getByRole("status").filter({ hasText: REQUEST_FAILED })).toBeVisible();
      expect(await activeElementText(page)).toBe("BUTTON:העברה לארכיון");
      expect((await readProject(id))?.archived_at).toBeNull();
      await restore();
    },
  );

  test_(
    "PRJ-1: a failed delete shows the error inside the dialog",
    async ({ page, token, seedClient, seedProject }) => {
      const clientId = await seedClient({ name: `מחיקה נכשלה ${token}` });
      const id = await seedProject({ client_id: clientId, name: `מחיקה נכשלה ${token}` });
      await page.goto(`/projects/${id}`);
      const restore = await failServerActions(page, "500");

      await page.getByRole("button", { name: "מחיקה לצמיתות" }).click();
      const dialog = page.getByRole("dialog", { name: "למחוק את הפרויקט לצמיתות?" });
      await dialog.getByRole("button", { name: "מחיקה לצמיתות" }).click();

      await expect(dialog.getByRole("alert")).toHaveText(REQUEST_FAILED);
      await expect(dialog.getByRole("button", { name: "מחיקה לצמיתות" })).toBeFocused();
      expect(await readProject(id)).not.toBeNull();
      await restore();
    },
  );
});

test_.describe("AUTH-3: an ended session during a project action goes to /login", () => {
  test_(
    "PRJ-1: saving after the session ended opens /login",
    async ({ page, context, token, seedClient }) => {
      await seedClient({ name: `פג תוקף ${token}` });
      await page.goto("/projects/new");
      await clientSelect(page).selectOption({ label: `פג תוקף ${token}` });
      await nameField(page).fill(`פג תוקף ${token}`);
      await context.clearCookies();

      await page.getByRole("button", { name: "שמירת פרויקט" }).click();

      await expect(page).toHaveURL(/\/login$/);
      expect(await projectIdsNamed(`פג תוקף ${token}`)).toEqual([]);
    },
  );

  test_(
    "PRJ-1: searching after the session ended opens /login",
    async ({ page, context, token }) => {
      await page.goto("/projects");
      await context.clearCookies();

      await page.getByRole("searchbox", { name: "חיפוש לפי שם פרויקט או שם לקוח" }).fill(token);
      await page.getByRole("button", { name: "חיפוש", exact: true }).click();

      await expect(page).toHaveURL(/\/login$/);
    },
  );
});

test_.describe("M1.2-12: layout, navigation and CSP", () => {
  test_(
    "PRJ-1: פרויקטים in the navigation is marked current on the project screens",
    async ({ page }) => {
      await page.goto("/projects/new");
      const nav = page.getByRole("navigation", { name: "ניווט ראשי" });

      await expect(nav.getByRole("link", { name: "פרויקטים" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await nav.getByRole("link", { name: "פרויקטים" }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("פרויקטים");
    },
  );

  test_(
    "PRJ-1: no horizontal scroll and no CSP violations on the project screens",
    async ({ page, token, seedClient, seedProject }, testInfo) => {
      const violations = await trackCspViolations(page);
      const clientId = await seedClient({ name: `לקוח ארוך ${"ארוך".repeat(20)} ${token}` });
      const id = await seedProject({
        client_id: clientId,
        name: `פרויקט ארוך מאוד ${"ארוך".repeat(20)} ${token}`,
        property_address: "כתובת ארוכה ".repeat(15).trim(),
        status: "on_hold",
        contract_amount: 9_999_999_999,
        start_date: "2026-11-16",
        end_date: "2027-11-16",
        notes: "הערה ארוכה ".repeat(50).trim(),
      });

      for (const width of VIEWPORT_WIDTHS_BY_PROJECT[testInfo.project.name]) {
        for (const path of [
          "/projects",
          "/projects/new",
          `/projects/${id}`,
          `/projects/${id}/edit`,
          `/clients/${clientId}`,
        ]) {
          await page.setViewportSize({ width, height: 800 });
          await page.goto(path, { waitUntil: "networkidle" });

          expect(
            await hasHorizontalScroll(page),
            `horizontal scroll at ${width}px on ${path}`,
          ).toBe(false);
        }
      }
      // Exercise zod and the Server Actions in the browser as well.
      await page.goto("/projects");
      await searchProjects(page, token);
      await page.goto("/projects/new");
      await amountField(page).fill("abc");
      await page.getByRole("button", { name: "שמירת פרויקט" }).click();
      await expect(amountField(page)).toHaveAttribute("aria-invalid", "true");
      await page.goto(`/projects/${id}`);
      await page.getByRole("button", { name: "מחיקה לצמיתות" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      expect(violations).toEqual([]);
    },
  );
});
