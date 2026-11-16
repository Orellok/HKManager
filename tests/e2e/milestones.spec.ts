import type { Page } from "@playwright/test";

import { daysBetween, todayInJerusalem } from "../../src/lib/dates";

import { createServiceRoleClient, expect, test_ } from "./support/data-fixtures";
import {
  VIEWPORT_WIDTHS_BY_PROJECT,
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

/** An ISO date `days` from today in Asia/Jerusalem (negative = in the past). */
function isoDaysFromToday(days: number): string {
  const [year, month, day] = todayInJerusalem().split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function ddmmyyyy(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

function milestonesRegion(page: Page) {
  return page.getByRole("region", { name: "אבני דרך" });
}

function milestoneItems(page: Page) {
  return milestonesRegion(page).getByRole("list", { name: "אבני דרך" }).getByRole("listitem");
}

function milestoneItem(page: Page, description: string) {
  return milestoneItems(page).filter({ hasText: description });
}

function descriptionField(page: Page) {
  return page.getByRole("textbox", { name: /^תיאור/ });
}

function amountField(page: Page) {
  return page.getByRole("textbox", { name: /^סכום \(₪\)/ });
}

function dueDateField(page: Page) {
  return page.getByLabel(/^תאריך יעד/);
}

function liveStatus(page: Page) {
  return milestonesRegion(page).getByRole("status");
}

async function milestoneOrder(projectId: string) {
  const { data, error } = await createServiceRoleClient()
    .from("milestones")
    .select("description")
    .eq("project_id", projectId)
    .order("sort_order");
  expect(error).toBeNull();
  return (data ?? []).map((row) => row.description as string);
}

async function readMilestone(id: string) {
  const { data, error } = await createServiceRoleClient()
    .from("milestones")
    .select("description, amount, due_date, cancelled_at")
    .eq("id", id)
    .maybeSingle();
  expect(error).toBeNull();
  return data;
}

type Seeds = {
  token: string;
  seedClient: (client: { name: string }) => Promise<string>;
  seedProject: (project: {
    client_id: string;
    name: string;
    contract_amount?: number;
    status?: "lead" | "active" | "on_hold" | "completed" | "cancelled";
    archived_at?: string;
  }) => Promise<string>;
};

async function seedProjectFor({ token, seedClient, seedProject }: Seeds, contract?: number) {
  const clientId = await seedClient({ name: `לקוח ${token}` });
  const projectId = await seedProject({
    client_id: clientId,
    name: `פרויקט ${token}`,
    contract_amount: contract,
  });
  return { clientId, projectId };
}

test_.describe("MS-1: add and edit milestones", () => {
  test_(
    "MS-1: adds milestones from the project card; they appear in order with their status",
    async ({ page, token, seedClient, seedProject }) => {
      const { projectId } = await seedProjectFor({ token, seedClient, seedProject });
      await page.goto(`/projects/${projectId}`);
      await expect(milestonesRegion(page)).toContainText("אין עדיין אבני דרך לפרויקט.");

      await milestonesRegion(page).getByRole("link", { name: "אבן דרך חדשה" }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("אבן דרך חדשה");
      await descriptionField(page).fill(`מקדמה ${token}`);
      await amountField(page).fill("12,500.50");
      await dueDateField(page).fill("2100-12-31");
      await page.getByRole("button", { name: "שמירת אבן דרך" }).click();

      await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`));
      await expect(page.getByRole("status").filter({ hasText: "אבן הדרך נשמרה." })).toBeVisible();
      await expect(milestoneItem(page, `מקדמה ${token}`)).toContainText("‏12,500.50 ‏₪");
      await expect(milestoneItem(page, `מקדמה ${token}`)).toContainText("31/12/2100");
      await expect(milestoneItem(page, `מקדמה ${token}`)).toContainText("מתוכנן");

      await milestonesRegion(page).getByRole("link", { name: "אבן דרך חדשה" }).click();
      await descriptionField(page).fill(`סיום ${token}`);
      await amountField(page).fill("0");
      await dueDateField(page).fill("2026-01-01");
      await dueDateField(page).press("Enter");

      await expect(milestoneItems(page)).toHaveCount(2);
      await expect(milestoneItems(page).nth(0)).toContainText(`מקדמה ${token}`);
      await expect(milestoneItems(page).nth(1)).toContainText(`סיום ${token}`);
      expect(await milestoneOrder(projectId)).toEqual([`מקדמה ${token}`, `סיום ${token}`]);
    },
  );

  test_(
    "MS-1: shows Hebrew errors next to the fields, keeps the input and focuses the first error",
    async ({ page, token, seedClient, seedProject }) => {
      const { projectId } = await seedProjectFor({ token, seedClient, seedProject });
      await page.goto(`/projects/${projectId}/milestones/new`);

      await amountField(page).fill("12.505");
      await page.getByRole("button", { name: "שמירת אבן דרך" }).click();

      await expect(page.getByRole("alert").first()).toHaveText(
        "לא ניתן לשמור. יש לתקן את השדות המסומנים.",
      );
      await expect(descriptionField(page)).toBeFocused();
      await expect(descriptionField(page)).toHaveAccessibleDescription(/יש להזין תיאור\./);
      await expect(amountField(page)).toHaveAccessibleDescription(
        /אפשר להזין עד שתי ספרות אחרי הנקודה/,
      );
      await expect(dueDateField(page)).toHaveAccessibleDescription("יש להזין תאריך יעד.");
      await expect(amountField(page)).toHaveValue("12.505");

      await descriptionField(page).fill(`תיקון ${token}`);
      await amountField(page).fill("100");
      // M1.3-10: a year before 100 is a real year, so it gets the range message.
      await dueDateField(page).fill("0050-01-01");
      await page.getByRole("button", { name: "שמירת אבן דרך" }).click();
      await expect(dueDateField(page)).toHaveAccessibleDescription(
        "יש להזין תאריך בין 01/01/1900 ל-31/12/2100.",
      );
      await expect(dueDateField(page)).toBeFocused();
      expect(await milestoneOrder(projectId)).toEqual([]);
    },
  );

  test_(
    "MS-1: a partly typed due date is reported as invalid, not as missing",
    async ({ page, token, seedClient, seedProject }) => {
      const { projectId } = await seedProjectFor({ token, seedClient, seedProject });
      await page.goto(`/projects/${projectId}/milestones/new`);
      await descriptionField(page).fill(`חלקי ${token}`);
      await amountField(page).fill("100");
      await dueDateField(page).click();
      await page.keyboard.type("1611");

      await page.getByRole("button", { name: "שמירת אבן דרך" }).click();

      await expect(dueDateField(page)).toHaveAccessibleDescription("יש להזין תאריך תקין.");
      await expect(dueDateField(page)).toBeFocused();
      expect(await milestoneOrder(projectId)).toEqual([]);
    },
  );

  test_(
    "MS-1: edits a milestone",
    async ({ page, token, seedClient, seedProject, seedMilestone }) => {
      const { projectId } = await seedProjectFor({ token, seedClient, seedProject });
      const id = await seedMilestone({
        project_id: projectId,
        description: `לעריכה ${token}`,
        amount: 100_000,
        due_date: "2099-05-01",
      });
      await page.goto(`/projects/${projectId}`);

      await milestonesRegion(page)
        .getByRole("link", { name: `עריכה: לעריכה ${token}` })
        .click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("עריכת אבן דרך");
      await expect(descriptionField(page)).toHaveValue(`לעריכה ${token}`);
      await expect(amountField(page)).toHaveValue("1000");
      await expect(dueDateField(page)).toHaveValue("2099-05-01");
      await descriptionField(page).fill(`נערכה ${token}`);
      await amountField(page).fill("2,000.25");
      await dueDateField(page).fill("2099-06-30");
      await page.getByRole("button", { name: "שמירת שינויים" }).click();

      await expect(
        page.getByRole("status").filter({ hasText: "השינויים באבן הדרך נשמרו." }),
      ).toBeVisible();
      await expect(milestoneItem(page, `נערכה ${token}`)).toContainText("30/06/2099");
      expect(await readMilestone(id)).toMatchObject({
        description: `נערכה ${token}`,
        amount: 200_025,
        due_date: "2099-06-30",
      });
    },
  );

  test_(
    "MS-1: a milestone of another project or a malformed id shows the 404 screen",
    async ({ page, token, seedClient, seedProject, seedMilestone }) => {
      const { clientId, projectId } = await seedProjectFor({ token, seedClient, seedProject });
      const otherProject = await seedProject({ client_id: clientId, name: `אחר ${token}` });
      const id = await seedMilestone({
        project_id: otherProject,
        description: `של אחר ${token}`,
        amount: 1,
        due_date: "2099-01-01",
      });

      const wrongProject = await page.goto(`/projects/${projectId}/milestones/${id}/edit`);
      const malformed = await page.goto(`/projects/${projectId}/milestones/abc/edit`);

      expect(wrongProject?.status()).toBe(404);
      expect(malformed?.status()).toBe(404);
    },
  );

  test_(
    "MS-1: a triple click saves one milestone",
    async ({ page, token, seedClient, seedProject }) => {
      const { projectId } = await seedProjectFor({ token, seedClient, seedProject });
      await page.goto(`/projects/${projectId}/milestones/new`);
      await descriptionField(page).fill(`פעם אחת ${token}`);
      await amountField(page).fill("10");
      await dueDateField(page).fill("2099-01-01");

      await clickThreeTimesSynchronously(page, "שמירת אבן דרך");

      await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`));
      await expect(milestoneItems(page)).toHaveCount(1);
      expect(await milestoneOrder(projectId)).toEqual([`פעם אחת ${token}`]);
    },
  );
});

test_.describe("MS-1: reorder with למעלה / למטה (owner decision)", () => {
  test_(
    "MS-1: moving keeps focus on the moved milestone's button and announces the new place",
    async ({ page, token, seedClient, seedProject, seedMilestone }) => {
      const { projectId } = await seedProjectFor({ token, seedClient, seedProject });
      for (const name of ["א", "ב", "ג"]) {
        await seedMilestone({
          project_id: projectId,
          description: `${name} ${token}`,
          amount: 1000,
          due_date: "2099-01-01",
        });
      }
      await page.goto(`/projects/${projectId}`);
      const down = page.getByRole("button", { name: `למטה: א ${token}` });

      await down.click();
      await expect(liveStatus(page)).toHaveText(`"א ${token}" הועברה למקום 2 מתוך 3.`);
      await expect(milestoneItems(page).nth(1)).toContainText(`א ${token}`);
      await expect(down).toBeFocused();

      // Keyboard only: Enter on the focused button moves it again.
      await page.keyboard.press("Enter");
      await expect(liveStatus(page)).toHaveText(`"א ${token}" הועברה למקום 3 מתוך 3.`);
      await expect(down).toBeFocused();
      expect(await milestoneOrder(projectId)).toEqual([`ב ${token}`, `ג ${token}`, `א ${token}`]);

      // At the bottom edge the button stays focusable, is marked unavailable and sends nothing.
      await expect(down).toHaveAttribute("aria-disabled", "true");
      await page.keyboard.press("Enter");
      await expect(liveStatus(page)).toHaveText("אבן הדרך כבר אחרונה ברשימה.");
      await expect(down).toBeFocused();

      const up = page.getByRole("button", { name: `למעלה: ג ${token}` });
      await up.click();
      await expect(milestoneItems(page).nth(0)).toContainText(`ג ${token}`);
      await expect(up).toBeFocused();
      await expect(up).toHaveAttribute("aria-disabled", "true");
      // Playwright will not click an aria-disabled button; it is focused, so press Enter.
      await page.keyboard.press("Enter");
      await expect(liveStatus(page)).toHaveText("אבן הדרך כבר ראשונה ברשימה.");
      expect(await milestoneOrder(projectId)).toEqual([`ג ${token}`, `ב ${token}`, `א ${token}`]);
    },
  );

  test_(
    "MS-1: a triple click on למטה moves the milestone once",
    async ({ page, token, seedClient, seedProject, seedMilestone }) => {
      const { projectId } = await seedProjectFor({ token, seedClient, seedProject });
      for (const name of ["א", "ב", "ג"]) {
        await seedMilestone({
          project_id: projectId,
          description: `${name} ${token}`,
          amount: 1000,
          due_date: "2099-01-01",
        });
      }
      await page.goto(`/projects/${projectId}`);

      await clickThreeTimesSynchronously(page, "למטה");

      await expect(liveStatus(page)).toHaveText(`"א ${token}" הועברה למקום 2 מתוך 3.`);
      expect(await milestoneOrder(projectId)).toEqual([`ב ${token}`, `א ${token}`, `ג ${token}`]);
    },
  );
});

test_.describe("MS-2: computed status", () => {
  test_(
    "MS-2: planned, due and cancelled milestones are labelled as text",
    async ({ page, token, seedClient, seedProject, seedMilestone }) => {
      const { projectId } = await seedProjectFor({ token, seedClient, seedProject });
      await seedMilestone({
        project_id: projectId,
        description: `עבר ${token}`,
        amount: 1000,
        due_date: isoDaysFromToday(-3),
      });
      await seedMilestone({
        project_id: projectId,
        description: `עתידי ${token}`,
        amount: 1000,
        due_date: isoDaysFromToday(3),
      });
      await seedMilestone({
        project_id: projectId,
        description: `מבוטל ${token}`,
        amount: 1000,
        due_date: isoDaysFromToday(-3),
        cancelled_at: new Date().toISOString(),
      });
      await page.goto(`/projects/${projectId}`);

      await expect(milestoneItem(page, `עבר ${token}`)).toContainText("לתשלום");
      await expect(milestoneItem(page, `עתידי ${token}`)).toContainText("מתוכנן");
      await expect(milestoneItem(page, `מבוטל ${token}`)).toContainText("בוטל");
    },
  );
});

test_.describe("MS-2: cancel, un-cancel and delete (owner decisions)", () => {
  test_(
    "MS-2: cancels after confirmation and un-cancels; focus moves to the counterpart button",
    async ({ page, token, seedClient, seedProject, seedMilestone }) => {
      const { projectId } = await seedProjectFor({ token, seedClient, seedProject }, 100_000);
      const id = await seedMilestone({
        project_id: projectId,
        description: `לביטול ${token}`,
        amount: 100_000,
        due_date: isoDaysFromToday(-2),
      });
      await page.goto(`/projects/${projectId}`);
      await expect(milestonesRegion(page)).toContainText("שווה לסכום החוזה");

      await page.getByRole("button", { name: `ביטול אבן דרך: לביטול ${token}` }).click();
      const dialog = page.getByRole("dialog", { name: "לבטל את אבן הדרך?" });
      await expect(dialog.getByRole("button", { name: "חזרה" })).toBeFocused();
      await dialog.getByRole("button", { name: "חזרה" }).click();
      expect((await readMilestone(id))?.cancelled_at).toBeNull();

      await page.getByRole("button", { name: `ביטול אבן דרך: לביטול ${token}` }).click();
      await dialog.getByRole("button", { name: "ביטול אבן הדרך" }).click();

      await expect(liveStatus(page)).toHaveText("אבן הדרך בוטלה.");
      await expect(milestoneItem(page, `לביטול ${token}`)).toContainText("בוטל");
      const restore = page.getByRole("button", { name: `החזרה מביטול: לביטול ${token}` });
      await expect(restore).toBeFocused();
      // MS-3: the cancelled milestone no longer counts.
      await expect(milestonesRegion(page)).toContainText("נמוך מסכום החוזה");
      expect((await readMilestone(id))?.cancelled_at).not.toBeNull();

      await restore.click();
      await expect(liveStatus(page)).toHaveText("אבן הדרך הוחזרה מביטול.");
      await expect(milestoneItem(page, `לביטול ${token}`)).toContainText("לתשלום");
      await expect(
        page.getByRole("button", { name: `ביטול אבן דרך: לביטול ${token}` }),
      ).toBeFocused();
      expect((await readMilestone(id))?.cancelled_at).toBeNull();
    },
  );

  test_(
    "MS-2: deletes a milestone after confirmation; focus moves to the section heading",
    async ({ page, token, seedClient, seedProject, seedMilestone }) => {
      const { projectId } = await seedProjectFor({ token, seedClient, seedProject });
      await seedMilestone({
        project_id: projectId,
        description: `נשאר ${token}`,
        amount: 1,
        due_date: "2099-01-01",
      });
      const id = await seedMilestone({
        project_id: projectId,
        description: `למחיקה ${token}`,
        amount: 1,
        due_date: "2099-01-01",
      });
      await page.goto(`/projects/${projectId}`);

      await page.getByRole("button", { name: `מחיקה: למחיקה ${token}` }).click();
      const dialog = page.getByRole("dialog", { name: "למחוק את אבן הדרך לצמיתות?" });
      await dialog.getByRole("button", { name: "מחיקה לצמיתות" }).click();

      await expect(liveStatus(page)).toHaveText("אבן הדרך נמחקה.");
      await expect(milestoneItems(page)).toHaveCount(1);
      await expect(milestonesRegion(page).getByRole("heading", { name: "אבני דרך" })).toBeFocused();
      expect(await readMilestone(id)).toBeNull();
    },
  );
});

test_.describe("MS-3: milestones total compared with the contract amount", () => {
  for (const [label, contract, expected] of [
    [
      "above",
      100_000,
      "שימו לב: סכום אבני הדרך (‏1,500.00 ‏₪) גבוה מסכום החוזה (‏1,000.00 ‏₪) ב-‏500.00 ‏₪.",
    ],
    [
      "below",
      200_000,
      "שימו לב: סכום אבני הדרך (‏1,500.00 ‏₪) נמוך מסכום החוזה (‏2,000.00 ‏₪) ב-‏500.00 ‏₪.",
    ],
    ["equal", 150_000, "סה״כ אבני הדרך (בלי אבני דרך שבוטלו): ‏1,500.00 ‏₪, שווה לסכום החוזה."],
  ] as const) {
    test_(
      `MS-3: a total ${label} the contract amount is shown as such, without blocking`,
      async ({ page, token, seedClient, seedProject, seedMilestone }) => {
        const { projectId } = await seedProjectFor({ token, seedClient, seedProject }, contract);
        for (const amount of [100_000, 50_000]) {
          await seedMilestone({
            project_id: projectId,
            description: `סכום ${amount} ${token}`,
            amount,
            due_date: "2099-01-01",
          });
        }
        await seedMilestone({
          project_id: projectId,
          description: `מבוטל ${token}`,
          amount: 999_999,
          due_date: "2099-01-01",
          cancelled_at: new Date().toISOString(),
        });

        await page.goto(`/projects/${projectId}`);

        await expect(milestonesRegion(page).getByText(expected)).toBeVisible();
        await expect(
          milestonesRegion(page).getByRole("link", { name: "אבן דרך חדשה" }),
        ).toBeVisible();
      },
    );
  }

  test_(
    "MS-3: without a contract amount the total is shown with no warning",
    async ({ page, token, seedClient, seedProject, seedMilestone }) => {
      const { projectId } = await seedProjectFor({ token, seedClient, seedProject });
      await seedMilestone({
        project_id: projectId,
        description: `ללא חוזה ${token}`,
        amount: 250_050,
        due_date: "2099-01-01",
      });

      await page.goto(`/projects/${projectId}`);

      await expect(milestonesRegion(page)).toContainText(
        "סה״כ אבני הדרך (בלי אבני דרך שבוטלו): ‏2,500.50 ‏₪. לא הוזן סכום חוזה להשוואה.",
      );
      await expect(milestonesRegion(page).getByText("שימו לב:")).toHaveCount(0);
    },
  );
});

test_.describe("PRJ-1 / MS-1: a project with milestones cannot be deleted", () => {
  test_(
    "PRJ-1: deleting a project that has milestones is refused with an explanation",
    async ({ page, token, seedClient, seedProject, seedMilestone }) => {
      const { projectId } = await seedProjectFor({ token, seedClient, seedProject });
      await seedMilestone({
        project_id: projectId,
        description: `שומרת ${token}`,
        amount: 1,
        due_date: "2099-01-01",
      });
      await page.goto(`/projects/${projectId}`);

      await page.getByRole("button", { name: "מחיקה לצמיתות" }).click();
      const dialog = page.getByRole("dialog", { name: "למחוק את הפרויקט לצמיתות?" });
      await dialog.getByRole("button", { name: "מחיקה לצמיתות" }).click();

      await expect(dialog.getByRole("alert")).toHaveText(
        "אי אפשר למחוק פרויקט שיש לו אבני דרך או הכנסות. אפשר להעביר אותו לארכיון.",
      );
      const { data } = await createServiceRoleClient()
        .from("projects")
        .select("id")
        .eq("id", projectId);
      expect(data).toHaveLength(1);
    },
  );
});

test_.describe("MS-6: open debts", () => {
  test_(
    "MS-6: lists overdue unpaid milestones oldest first with links, days overdue and a total",
    async ({ page, token, seedClient, seedProject, seedMilestone }) => {
      const clientId = await seedClient({ name: `חייב ${token}` });
      const projectId = await seedProject({
        client_id: clientId,
        name: `פעיל ${token}`,
        status: "active",
      });
      // Owner decision: project status and archive state do not filter the list.
      const archivedId = await seedProject({
        client_id: clientId,
        name: `בארכיון ${token}`,
        status: "completed",
        archived_at: new Date().toISOString(),
      });
      const older = isoDaysFromToday(-40);
      const newer = isoDaysFromToday(-1);
      await seedMilestone({
        project_id: projectId,
        description: `חדש ${token}`,
        amount: 50_000,
        due_date: newer,
      });
      await seedMilestone({
        project_id: archivedId,
        description: `ישן ${token}`,
        amount: 123_456,
        due_date: older,
      });
      for (const [description, fields] of [
        [`היום ${token}`, { due_date: isoDaysFromToday(0) }],
        [`עתיד ${token}`, { due_date: isoDaysFromToday(5) }],
        [`אפס ${token}`, { due_date: older, amount: 0 }],
        [`מבוטל ${token}`, { due_date: older, cancelled_at: new Date().toISOString() }],
      ] as const) {
        await seedMilestone({ project_id: projectId, description, amount: 1000, ...fields });
      }

      await page.goto("/");
      await page
        .getByRole("navigation", { name: "ניווט ראשי" })
        .getByRole("link", { name: "חובות" })
        .click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("חובות פתוחים");
      await expect(
        page.getByRole("navigation", { name: "ניווט ראשי" }).getByRole("link", { name: "חובות" }),
      ).toHaveAttribute("aria-current", "page");
      await expect(page.getByText("סה״כ יתרות פתוחות")).toBeVisible();

      const list = page.getByRole("list", { name: "רשימת החובות הפתוחים" });
      const mine = list.getByRole("listitem").filter({ hasText: token });
      await expect(mine).toHaveCount(2);
      await expect(mine.nth(0)).toContainText(`ישן ${token}`);
      await expect(mine.nth(0)).toContainText(ddmmyyyy(older));
      await expect(mine.nth(0)).toContainText(
        `באיחור של ${daysBetween(older, todayInJerusalem())} ימים`,
      );
      await expect(mine.nth(0)).toContainText("‏1,234.56 ‏₪");
      await expect(
        mine.nth(0).getByRole("link", { name: `בארכיון ${token} (בארכיון)` }),
      ).toBeVisible();
      await expect(mine.nth(1)).toContainText(`חדש ${token}`);
      await expect(mine.nth(1)).toContainText("באיחור של יום אחד");

      await mine
        .nth(1)
        .getByRole("link", { name: `פעיל ${token}` })
        .click();
      await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`));
      await page.goBack();
      await mine
        .nth(1)
        .getByRole("link", { name: `חייב ${token}` })
        .click();
      await expect(page).toHaveURL(new RegExp(`/clients/${clientId}$`));
    },
  );

  test_(
    "MS-6: more debts load page by page; a failed load keeps the list",
    async ({ page, token, seedClient, seedProject }, testInfo) => {
      // The list is global and both browser projects would seed into the same dates; one is
      // enough to check paging.
      test_.skip(testInfo.project.name !== "desktop", "Paging is checked on desktop only");
      const clientId = await seedClient({ name: `דפדוף ${token}` });
      const projectId = await seedProject({ client_id: clientId, name: `דפדוף ${token}` });
      const rows = Array.from({ length: 51 }, (_, index) => ({
        project_id: projectId,
        description: `חוב ${String(index + 1).padStart(2, "0")} ${token}`,
        amount: 100,
        due_date: "1910-01-01",
      }));
      const { error } = await createServiceRoleClient().from("milestones").insert(rows);
      expect(error).toBeNull();
      await page.goto("/debts");
      const mine = page
        .getByRole("list", { name: "רשימת החובות הפתוחים" })
        .getByRole("listitem")
        .filter({ hasText: token });
      const firstPageCount = await mine.count();
      expect(firstPageCount).toBeGreaterThan(0);
      expect(firstPageCount).toBeLessThan(51);

      const restore = await failServerActions(page, "abort");
      await page.getByRole("button", { name: "הצגת חובות נוספים" }).click();
      await expect(
        page.getByRole("alert").filter({ hasText: "טעינת חובות נוספים נכשלה. אפשר לנסות שוב." }),
      ).toBeVisible();
      await expect(mine).toHaveCount(firstPageCount);
      await restore();

      await page.getByRole("button", { name: "הצגת חובות נוספים" }).click();
      await expect(mine).toHaveCount(51);
      await expect(mine.nth(50)).toContainText(`חוב 51 ${token}`);
    },
  );
});

test_.describe("M1.3-9: failed requests keep the screen and the input", () => {
  for (const mode of ["abort", "500"] as const) {
    test_(
      `MS-1: a failed save (${mode}) shows an inline error and keeps the input`,
      async ({ page, token, seedClient, seedProject }) => {
        const { projectId } = await seedProjectFor({ token, seedClient, seedProject });
        await page.goto(`/projects/${projectId}/milestones/new`);
        await descriptionField(page).fill(`נכשל ${token}`);
        await amountField(page).fill("1,000");
        await dueDateField(page).fill("2099-01-01");
        const restore = await failServerActions(page, mode);

        await page.getByRole("button", { name: "שמירת אבן דרך" }).click();

        await expect(page.getByRole("alert").first()).toHaveText(SAVE_UNAVAILABLE);
        await expect(descriptionField(page)).toHaveValue(`נכשל ${token}`);
        await expect(amountField(page)).toHaveValue("1,000");
        await expect(page.getByRole("button", { name: "שמירת אבן דרך" })).toBeFocused();

        await restore();
        await page.getByRole("button", { name: "שמירת אבן דרך" }).click();
        await expect(milestoneItem(page, `נכשל ${token}`)).toBeVisible();
      },
    );
  }

  test_(
    "MS-1: saving while offline shows the inline error and does not redirect",
    async ({ page, context, token, seedClient, seedProject }) => {
      const { projectId } = await seedProjectFor({ token, seedClient, seedProject });
      await page.goto(`/projects/${projectId}/milestones/new`);
      await descriptionField(page).fill(`לא מקוון ${token}`);
      await amountField(page).fill("10");
      await dueDateField(page).fill("2099-01-01");
      await context.setOffline(true);

      await page.getByRole("button", { name: "שמירת אבן דרך" }).click();

      await expect(page.getByRole("alert").first()).toHaveText(SAVE_UNAVAILABLE);
      await expect(page).toHaveURL(/\/milestones\/new$/);
      await expect(descriptionField(page)).toHaveValue(`לא מקוון ${token}`);
      await context.setOffline(false);
    },
  );

  test_(
    "MS-1: a failed move (offline) shows an inline error, keeps the order and the focus",
    async ({ page, context, token, seedClient, seedProject, seedMilestone }) => {
      const { projectId } = await seedProjectFor({ token, seedClient, seedProject });
      for (const name of ["א", "ב"]) {
        await seedMilestone({
          project_id: projectId,
          description: `${name} ${token}`,
          amount: 1,
          due_date: "2099-01-01",
        });
      }
      await page.goto(`/projects/${projectId}`);
      await context.setOffline(true);

      const down = page.getByRole("button", { name: `למטה: א ${token}` });
      await down.click();

      await expect(liveStatus(page)).toHaveText(REQUEST_FAILED);
      await expect(down).toBeFocused();
      await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`));
      await context.setOffline(false);
      expect(await milestoneOrder(projectId)).toEqual([`א ${token}`, `ב ${token}`]);
    },
  );

  test_(
    "MS-2: a failed cancel (500) shows the error inside the dialog and changes nothing",
    async ({ page, token, seedClient, seedProject, seedMilestone }) => {
      const { projectId } = await seedProjectFor({ token, seedClient, seedProject });
      const id = await seedMilestone({
        project_id: projectId,
        description: `ביטול נכשל ${token}`,
        amount: 1,
        due_date: "2099-01-01",
      });
      await page.goto(`/projects/${projectId}`);
      const restore = await failServerActions(page, "500");

      await page.getByRole("button", { name: `ביטול אבן דרך: ביטול נכשל ${token}` }).click();
      const dialog = page.getByRole("dialog", { name: "לבטל את אבן הדרך?" });
      await dialog.getByRole("button", { name: "ביטול אבן הדרך" }).click();

      await expect(dialog.getByRole("alert")).toHaveText(REQUEST_FAILED);
      await expect(dialog.getByRole("button", { name: "ביטול אבן הדרך" })).toBeFocused();
      expect((await readMilestone(id))?.cancelled_at).toBeNull();
      await restore();
    },
  );

  test_(
    "MS-2: a failed delete (abort) shows the error inside the dialog",
    async ({ page, token, seedClient, seedProject, seedMilestone }) => {
      const { projectId } = await seedProjectFor({ token, seedClient, seedProject });
      const id = await seedMilestone({
        project_id: projectId,
        description: `מחיקה נכשלה ${token}`,
        amount: 1,
        due_date: "2099-01-01",
      });
      await page.goto(`/projects/${projectId}`);
      const restore = await failServerActions(page, "abort");

      await page.getByRole("button", { name: `מחיקה: מחיקה נכשלה ${token}` }).click();
      const dialog = page.getByRole("dialog", { name: "למחוק את אבן הדרך לצמיתות?" });
      await dialog.getByRole("button", { name: "מחיקה לצמיתות" }).click();

      await expect(dialog.getByRole("alert")).toHaveText(REQUEST_FAILED);
      expect(await readMilestone(id)).not.toBeNull();
      await restore();
    },
  );
});

test_.describe("AUTH-3: an ended session during a milestone action goes to /login", () => {
  test_(
    "MS-1: moving after the session ended opens /login",
    async ({ page, context, token, seedClient, seedProject, seedMilestone }) => {
      const { projectId } = await seedProjectFor({ token, seedClient, seedProject });
      for (const name of ["א", "ב"]) {
        await seedMilestone({
          project_id: projectId,
          description: `${name} ${token}`,
          amount: 1,
          due_date: "2099-01-01",
        });
      }
      await page.goto(`/projects/${projectId}`);
      await context.clearCookies();

      await page.getByRole("button", { name: `למטה: א ${token}` }).click();

      await expect(page).toHaveURL(/\/login$/);
      expect(await milestoneOrder(projectId)).toEqual([`א ${token}`, `ב ${token}`]);
    },
  );

  test_(
    "MS-1: saving a milestone after the session ended opens /login",
    async ({ page, context, token, seedClient, seedProject }) => {
      const { projectId } = await seedProjectFor({ token, seedClient, seedProject });
      await page.goto(`/projects/${projectId}/milestones/new`);
      await descriptionField(page).fill(`פג ${token}`);
      await amountField(page).fill("1");
      await dueDateField(page).fill("2099-01-01");
      await context.clearCookies();

      await page.getByRole("button", { name: "שמירת אבן דרך" }).click();

      await expect(page).toHaveURL(/\/login$/);
      expect(await milestoneOrder(projectId)).toEqual([]);
    },
  );
});

test_.describe("M1.3-11: layout and CSP", () => {
  test_(
    "MS-1 / MS-6: no horizontal scroll and no CSP violations on the milestone screens",
    async ({ page, token, seedClient, seedProject, seedMilestone }, testInfo) => {
      const violations = await trackCspViolations(page);
      const clientId = await seedClient({ name: `לקוח ארוך ${"ארוך".repeat(20)} ${token}` });
      const projectId = await seedProject({
        client_id: clientId,
        name: `פרויקט ארוך ${"ארוך".repeat(20)} ${token}`,
        contract_amount: 1,
      });
      const id = await seedMilestone({
        project_id: projectId,
        description: `${"תיאור ארוך ".repeat(18).trim()} ${token}`.slice(0, 200),
        amount: 9_999_999_999,
        due_date: isoDaysFromToday(-400),
      });
      await seedMilestone({
        project_id: projectId,
        description: `שנייה ${token}`,
        amount: 9_999_999_999,
        due_date: "2100-12-31",
        cancelled_at: new Date().toISOString(),
      });

      for (const width of VIEWPORT_WIDTHS_BY_PROJECT[testInfo.project.name]) {
        for (const path of [
          `/projects/${projectId}`,
          `/projects/${projectId}/milestones/new`,
          `/projects/${projectId}/milestones/${id}/edit`,
          "/debts",
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
      await page.goto(`/projects/${projectId}/milestones/new`);
      await amountField(page).fill("abc");
      await page.getByRole("button", { name: "שמירת אבן דרך" }).click();
      await expect(amountField(page)).toHaveAttribute("aria-invalid", "true");
      await page.goto(`/projects/${projectId}`);
      await page.getByRole("button", { name: new RegExp(`^למעלה: שנייה ${token}`) }).click();
      await expect(liveStatus(page)).toContainText("הועברה למקום 1 מתוך 2.");
      expect(violations).toEqual([]);
    },
  );
});
