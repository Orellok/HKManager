import type { Page } from "@playwright/test";

import { addDays, formatIsoDate, todayInJerusalem } from "../../src/lib/dates";
import { dayLabel, weekStart } from "../../src/lib/tasks/calendar";

import { createServiceRoleClient, expect, test_ } from "./support/data-fixtures";
import {
  MIN_TOUCH_TARGET,
  VIEWPORT_WIDTHS_BY_PROJECT,
  clickNavItem,
  expectNavCurrent,
  hasHorizontalScroll,
  trackCspViolations,
} from "./support/helpers";

/**
 * M6: tasks (TASK-1..10), in-app reminders (NOTIF-1..3) and the in-app calendar (CAL-11).
 *
 * Other tests run in parallel and add tasks too, so a test looks at its own tasks only: it
 * filters the list by its own client, finds tasks by their (token) titles, and compares the
 * global counts (badge, dashboard card) with the database at the same moment.
 */

test_.beforeEach(async ({ signIn }) => {
  await signIn({ role: "owner" });
});

function today(): string {
  return todayInJerusalem();
}

function toggle(page: Page, title: string) {
  return page.getByRole("button", { name: `בוצע – ${title}` });
}

async function statusOf(id: string): Promise<{ status: string; completed_at: string | null }> {
  const { data, error } = await createServiceRoleClient()
    .from("tasks")
    .select("status, completed_at")
    .eq("id", id)
    .single();
  if (error) {
    throw new Error("Could not read the task", { cause: error });
  }
  return data as { status: string; completed_at: string | null };
}

/** NOTIF-1 / NOTIF-2 counts straight from the database, as the app computes them. */
async function dbCounts(): Promise<{ overdue: number; today: number; tomorrow: number }> {
  const { data, error } = await createServiceRoleClient()
    .rpc("task_reminder_counts", { p_today: today() })
    .single<{ overdue: number; due_today: number; due_tomorrow: number }>();
  if (error) {
    throw new Error("Could not count the reminders", { cause: error });
  }
  return { overdue: data.overdue, today: data.due_today, tomorrow: data.due_tomorrow };
}

/** Waits for the hydrated filters, then filters the tasks list by one client. */
async function filterByClient(page: Page, clientId: string) {
  const client = page.getByLabel("לקוח", { exact: true });
  await expect(client).toBeEnabled();
  await client.selectOption(clientId);
  await expect(page.getByRole("status").filter({ hasText: /^נמצאו/ })).toBeAttached();
}

function group(page: Page, label: string) {
  return page.getByRole("region", { name: new RegExp(`^${label} \\(\\d+\\)$`) });
}

test_.describe("TASK-1 / TASK-2 / TASK-9: creating and editing tasks", () => {
  test_(
    "TASK-1 / TASK-9: create a task assigned to a project: the project fills the client, a client limits the projects",
    async ({ page, token, seedClient, seedProject }) => {
      const clientId = await seedClient({ name: `לקוח משימות ${token}` });
      const otherId = await seedClient({ name: `לקוח אחר ${token}` });
      const projectId = await seedProject({ client_id: clientId, name: `פרויקט משימות ${token}` });
      const otherProjectId = await seedProject({ client_id: otherId, name: `פרויקט אחר ${token}` });

      await page.goto("/tasks/new");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("משימה חדשה");
      const client = page.getByLabel("לקוח");
      const project = page.getByLabel("פרויקט");
      await expect(project).toBeEnabled();

      // Saving without a title: the error is next to the field and focus moves there.
      await page.getByRole("button", { name: "שמירת משימה" }).click();
      const title = page.getByLabel("כותרת");
      await expect(title).toHaveAccessibleDescription("יש להזין כותרת למשימה.");
      await expect(title).toBeFocused();

      await title.fill(`להזמין חומרים ${token}`);
      await page.getByLabel("דדליין").fill(addDays(today(), 3));
      await page.getByLabel("עדיפות").selectOption("high");
      // TASK-9: choosing a project chooses its client.
      await project.selectOption(projectId);
      await expect(client).toHaveValue(clientId);
      // A client limits the projects to its own; another client's project is not offered.
      await expect(project.locator(`option[value="${otherProjectId}"]`)).toHaveCount(0);
      await client.selectOption(otherId);
      await expect(project).toHaveValue("");
      await expect(project.locator(`option[value="${projectId}"]`)).toHaveCount(0);
      await project.selectOption(otherProjectId);
      await client.selectOption(clientId);
      await project.selectOption(projectId);
      await page.getByLabel("תיאור").fill("שורה 1\nשורה 2");
      await page.getByRole("button", { name: "שמירת משימה" }).click();

      await expect(page).toHaveURL(/\/tasks$/);
      await expect(page.getByRole("status").filter({ hasText: "המשימה נשמרה." })).toBeVisible();
      const { data } = await createServiceRoleClient()
        .from("tasks")
        .select("title, priority, status, client_id, project_id, description, due_date")
        .ilike("title", `%${token}%`)
        .single();
      expect(data).toEqual({
        title: `להזמין חומרים ${token}`,
        priority: "high",
        status: "open",
        client_id: clientId,
        project_id: projectId,
        description: "שורה 1\nשורה 2",
        due_date: addDays(today(), 3),
      });
    },
  );

  test_(
    "TASK-2 / TASK-10: a task without a due date goes to ללא דדליין; editing and deleting it (soft)",
    async ({ page, token, seedClient, seedTask }) => {
      const clientId = await seedClient({ name: `ללא דדליין ${token}` });
      const id = await seedTask({ title: `בלי תאריך ${token}`, client_id: clientId });
      await page.goto("/tasks");
      await filterByClient(page, clientId);
      const noDue = group(page, "ללא דדליין");
      await expect(noDue).toContainText(`בלי תאריך ${token}`);
      await expect(noDue).toContainText("ללא דדליין");
      await expect(page.getByRole("region", { name: /^באיחור/ })).toHaveCount(0);

      await noDue.getByRole("link", { name: `בלי תאריך ${token}` }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("עריכת משימה");
      await expect(page.getByLabel("סטטוס")).toHaveValue("open");
      await page.getByLabel("כותרת").fill(`נערכה ${token}`);
      await page.getByRole("button", { name: "שמירת שינויים" }).click();
      await expect(
        page.getByRole("status").filter({ hasText: "השינויים במשימה נשמרו." }),
      ).toBeVisible();

      await page.goto(`/tasks/${id}/edit`);
      await page.getByRole("button", { name: "מחיקת משימה" }).click();
      const dialog = page.getByRole("dialog", { name: "למחוק את המשימה?" });
      await expect(dialog.getByRole("button", { name: "חזרה" })).toBeFocused();
      await dialog.getByRole("button", { name: "מחיקת המשימה" }).click();
      await expect(page).toHaveURL(/\/tasks$/);
      await expect(page.getByRole("status").filter({ hasText: "המשימה נמחקה." })).toBeVisible();
      const { data } = await createServiceRoleClient()
        .from("tasks")
        .select("deleted_at")
        .eq("id", id)
        .single();
      expect(data?.deleted_at).not.toBeNull();
      await page.goto(`/tasks/${id}/edit`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("הדף לא נמצא");
    },
  );
});

test_.describe("TASK-3 / TASK-4 / TASK-6 / TASK-7: the tasks list", () => {
  test_(
    "TASK-6: groups באיחור, היום, מחר, בהמשך, ללא דדליין in order; by due date then priority; done tasks in their own tab",
    async ({ page, token, seedClient, seedTask }) => {
      const clientId = await seedClient({ name: `קבוצות ${token}` });
      const t = today();
      await seedTask({ title: `ישנה ${token}`, client_id: clientId, due_date: addDays(t, -2) });
      await seedTask({ title: `אתמול ${token}`, client_id: clientId, due_date: addDays(t, -1) });
      await seedTask({
        title: `היום נמוכה ${token}`,
        client_id: clientId,
        due_date: t,
        priority: "low",
      });
      await seedTask({
        title: `היום גבוהה ${token}`,
        client_id: clientId,
        due_date: t,
        priority: "high",
      });
      await seedTask({ title: `מחר ${token}`, client_id: clientId, due_date: addDays(t, 1) });
      await seedTask({ title: `בעוד שבוע ${token}`, client_id: clientId, due_date: addDays(t, 7) });
      await seedTask({ title: `בלי ${token}`, client_id: clientId });
      await seedTask({ title: `בוצעה ${token}`, client_id: clientId, status: "done" });
      await seedTask({ title: `בוטלה ${token}`, client_id: clientId, status: "cancelled" });

      await page.goto("/tasks");
      await filterByClient(page, clientId);
      const headings = page.getByRole("main").getByRole("heading", { level: 2 });
      await expect(headings).toHaveText([
        "באיחור (2)",
        "היום (2)",
        "מחר (1)",
        "בהמשך (1)",
        "ללא דדליין (1)",
      ]);
      await expect(group(page, "באיחור").getByRole("link")).toHaveText([
        `ישנה ${token}`,
        `אתמול ${token}`,
      ]);
      await expect(group(page, "באיחור")).toContainText("באיחור");
      // TASK-6: within a day, high priority first.
      await expect(group(page, "היום").getByRole("link")).toHaveText([
        `היום גבוהה ${token}`,
        `היום נמוכה ${token}`,
      ]);
      await expect(group(page, "היום")).toContainText("עדיפות גבוהה");
      await expect(page.getByRole("main")).not.toContainText(`בוצעה ${token}`);

      await page.getByRole("link", { name: "בוצעו/בוטלו" }).click();
      await expect(page).toHaveURL(/\/tasks\?view=closed$/);
      await expect(page.getByRole("link", { name: "בוצעו/בוטלו" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await filterByClient(page, clientId);
      const closed = page.getByRole("list", { name: "משימות שבוצעו או בוטלו" });
      await expect(closed).toContainText(`בוצעה ${token}`);
      await expect(closed).toContainText(`בוטלה ${token}`);
      // A cancelled task has no toggle; a done one is pressed and can be undone.
      await expect(toggle(page, `בוטלה ${token}`)).toHaveCount(0);
      await expect(toggle(page, `בוצעה ${token}`)).toHaveAttribute("aria-pressed", "true");
    },
  );

  test_(
    "TASK-4: one tap marks done (completed_at stored) and the same button undoes it; a fast double tap sends one change",
    async ({ page, token, seedClient, seedTask }) => {
      const clientId = await seedClient({ name: `סימון ${token}` });
      const title = `לסמן ${token}`;
      const id = await seedTask({ title, client_id: clientId, due_date: today() });
      await page.goto("/tasks");
      await filterByClient(page, clientId);

      const button = toggle(page, title);
      await expect(button).toHaveAttribute("aria-pressed", "false");
      let requests = 0;
      page.on("request", (request) => {
        if (request.method() === "POST" && request.headers()["next-action"]) {
          requests += 1;
        }
      });
      await button.dblclick();
      await expect(button).toHaveAttribute("aria-pressed", "true");
      await expect(
        page.getByRole("status").filter({ hasText: `המשימה "${title}" סומנה כבוצעה.` }),
      ).toBeVisible();
      await expect(button).toBeFocused();
      const done = await statusOf(id);
      expect(done.status).toBe("done");
      expect(done.completed_at).not.toBeNull();
      // The double tap: one request, and the task did not flip back.
      expect(requests).toBe(1);
      await expect(group(page, "היום")).toContainText("בוצעה");

      await button.click();
      await expect(button).toHaveAttribute("aria-pressed", "false");
      await expect(page.getByRole("status").filter({ hasText: "הסימון בוטל." })).toBeVisible();
      expect(await statusOf(id)).toEqual({ status: "open", completed_at: null });
    },
  );

  test_(
    "TASK-4: a task marked done meanwhile in another tab stays done; a deleted one says so",
    async ({ page, token, seedClient, seedTask }) => {
      const clientId = await seedClient({ name: `מקביל ${token}` });
      const first = await seedTask({ title: `ראשונה ${token}`, client_id: clientId });
      const second = await seedTask({ title: `שנייה ${token}`, client_id: clientId });
      await page.goto("/tasks");
      await filterByClient(page, clientId);
      const service = createServiceRoleClient();
      await service.from("tasks").update({ status: "done" }).eq("id", first);
      await service.from("tasks").update({ deleted_at: new Date().toISOString() }).eq("id", second);

      await toggle(page, `ראשונה ${token}`).click();
      await expect(toggle(page, `ראשונה ${token}`)).toHaveAttribute("aria-pressed", "true");
      expect((await statusOf(first)).status).toBe("done");
      await toggle(page, `שנייה ${token}`).click();
      await expect(
        page.getByRole("status").filter({ hasText: "המשימה לא נמצאה. ייתכן שנמחקה." }),
      ).toBeVisible();
      await expect(toggle(page, `שנייה ${token}`)).toHaveAttribute("aria-pressed", "false");
    },
  );

  test_(
    "TASK-7: filters by priority, client and project through POST; no id goes into the address",
    async ({ page, token, seedClient, seedProject, seedTask }) => {
      const clientId = await seedClient({ name: `סינון ${token}` });
      const projectId = await seedProject({ client_id: clientId, name: `פרויקט סינון ${token}` });
      await seedTask({ title: `בפרויקט ${token}`, client_id: clientId, project_id: projectId });
      await seedTask({ title: `ללקוח ${token}`, client_id: clientId, priority: "low" });
      await page.goto("/tasks");
      const project = page.getByLabel("פרויקט", { exact: true });
      await expect(project).toBeEnabled();

      const posts: string[] = [];
      page.on("request", (request) => {
        if (request.headers()["next-action"]) {
          posts.push(request.method());
        }
      });
      // Choosing the project chooses its client.
      await project.selectOption(projectId);
      await expect(page.getByLabel("לקוח", { exact: true })).toHaveValue(clientId);
      const main = page.getByRole("main");
      await expect(main).toContainText(`בפרויקט ${token}`);
      await expect(main).not.toContainText(`ללקוח ${token}`);

      await project.selectOption("");
      await page.getByLabel("עדיפות").selectOption("low");
      await expect(main).toContainText(`ללקוח ${token}`);
      await expect(main).not.toContainText(`בפרויקט ${token}`);

      await page.getByLabel("עדיפות").selectOption("high");
      await expect(main.getByText("אין משימות שמתאימות לסינון.")).toBeVisible();
      expect(posts.length).toBeGreaterThan(0);
      expect(posts.every((method) => method === "POST")).toBe(true);
      expect(page.url()).not.toContain(clientId);
      expect(page.url()).not.toContain(projectId);
      expect(page.url()).toMatch(/\/tasks$/);
    },
  );
});

test_.describe("NOTIF-1 / NOTIF-2 / NOTIF-3: in-app reminders", () => {
  test_(
    "NOTIF-1: the badge counts overdue and today's open tasks, with an accessible name, on משימות and on עוד",
    async ({ page, token, seedTask }, testInfo) => {
      await seedTask({ title: `באיחור תג ${token}`, due_date: addDays(today(), -1) });
      await seedTask({ title: `היום תג ${token}`, due_date: today() });
      await seedTask({ title: `מחר תג ${token}`, due_date: addDays(today(), 1) });
      const nav = page.getByRole("navigation", { name: "ניווט ראשי" });
      const isMobile = testInfo.project.name === "android";
      await expect(async () => {
        await page.goto("/clients");
        const counts = await dbCounts();
        const count = counts.overdue + counts.today;
        expect(count).toBeGreaterThanOrEqual(2);
        // On mobile the link sits in the closed "עוד" menu (hidden), so its label is read directly.
        await expect(nav.locator('a[href="/tasks"]').first()).toHaveAttribute(
          "aria-label",
          `משימות, ${count} לטיפול`,
          { timeout: 1000 },
        );
        if (isMobile) {
          await expect(
            nav.getByRole("button", { name: `עוד, ${count} משימות לטיפול` }),
          ).toBeVisible({ timeout: 1000 });
        } else {
          await expect(nav.getByRole("link", { name: `משימות, ${count} לטיפול` })).toBeVisible();
        }
      }).toPass({ timeout: 20_000 });

      await clickNavItem(page, "משימות");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("משימות");
      await expectNavCurrent(page, "משימות");
      await clickNavItem(page, "יומן");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("יומן");
      await expectNavCurrent(page, "יומן");
    },
  );

  test_(
    "NOTIF-1: marking a task due today done lowers the badge without a reload",
    async ({ page, token, seedClient, seedTask }) => {
      const clientId = await seedClient({ name: `תג יורד ${token}` });
      const title = `מוריד תג ${token}`;
      await seedTask({ title, client_id: clientId, due_date: today() });
      await page.goto("/tasks");
      await filterByClient(page, clientId);
      const nav = page.getByRole("navigation", { name: "ניווט ראשי" });
      const badgeName = async () =>
        (await nav.locator('a[href="/tasks"]').first().getAttribute("aria-label")) ?? "משימות";
      await toggle(page, title).click();
      await expect(toggle(page, title)).toHaveAttribute("aria-pressed", "true");
      // The refreshed layout shows the database's count again.
      await expect(async () => {
        const counts = await dbCounts();
        const count = counts.overdue + counts.today;
        const text = await badgeName();
        expect(text === "משימות" ? 0 : Number(/, (\d+) לטיפול/.exec(text)?.[1])).toBe(count);
      }).toPass({ timeout: 20_000 });
    },
  );

  test_(
    "NOTIF-2: the dashboard tasks card (באיחור / להיום / למחר), the overdue banner and the done toggle from the card",
    async ({ page, token, seedTask }) => {
      const title = `בכרטיס ${token}`;
      // The card lists the earliest tasks; a task overdue for decades is among the first.
      const id = await seedTask({ title, due_date: "1900-01-02" });
      await seedTask({ title: `למחר בכרטיס ${token}`, due_date: addDays(today(), 1) });
      const card = page.getByRole("region", { name: "משימות", exact: true });
      await expect(async () => {
        await page.goto("/");
        const counts = await dbCounts();
        const value = (label: string) =>
          card
            .locator("dl > div")
            .filter({ has: page.locator("dt", { hasText: label }) })
            .locator("dd");
        await expect(value("באיחור")).toHaveText(String(counts.overdue), { timeout: 1000 });
        await expect(value("להיום")).toHaveText(String(counts.today), { timeout: 1000 });
        await expect(value("למחר")).toHaveText(String(counts.tomorrow), { timeout: 1000 });
        await expect(
          page.getByRole("region", { name: /^התראה: (משימה אחת|\d+ משימות) באיחור$/ }),
        ).toHaveText(
          new RegExp(counts.overdue === 1 ? "משימה אחת באיחור" : `${counts.overdue} משימות באיחור`),
          { timeout: 1000 },
        );
      }).toPass({ timeout: 20_000 });

      await toggle(page, title).click();
      await expect(toggle(page, title)).toHaveAttribute("aria-pressed", "true");
      expect((await statusOf(id)).status).toBe("done");
      await toggle(page, title).click();
      await expect(toggle(page, title)).toHaveAttribute("aria-pressed", "false");
      expect((await statusOf(id)).status).toBe("open");
      await card.getByRole("link", { name: "לכל המשימות" }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("משימות");
    },
  );
});

test_.describe("TASK-8 / TASK-10: tasks on the client and project cards", () => {
  test_(
    "TASK-8: quick create from the client card and the project card fills the link and returns to the card",
    async ({ page, token, seedClient, seedProject }) => {
      const clientId = await seedClient({ name: `כרטיס לקוח ${token}` });
      const projectId = await seedProject({ client_id: clientId, name: `כרטיס פרויקט ${token}` });

      await page.goto(`/clients/${clientId}`);
      const clientTasks = page.getByRole("region", { name: "משימות פתוחות" });
      await expect(clientTasks).toContainText("אין משימות פתוחות ללקוח.");
      await clientTasks.getByRole("link", { name: "משימה חדשה" }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("משימה חדשה");
      await expect(page.getByLabel("לקוח")).toHaveValue(clientId);
      await expect(page.getByLabel("פרויקט")).toBeEnabled();
      await page.getByLabel("כותרת").fill(`מהכרטיס ${token}`);
      await page.getByRole("button", { name: "שמירת משימה" }).click();
      await expect(page).toHaveURL(new RegExp(`/clients/${clientId}$`));
      await expect(page.getByRole("status").filter({ hasText: "המשימה נשמרה." })).toBeVisible();
      await expect(page.getByRole("region", { name: "משימות פתוחות" })).toContainText(
        `מהכרטיס ${token}`,
      );

      await page.goto(`/projects/${projectId}`);
      await page
        .getByRole("region", { name: "משימות פתוחות" })
        .getByRole("link", { name: "משימה חדשה" })
        .click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("משימה חדשה");
      await expect(page.getByLabel("פרויקט")).toHaveValue(projectId);
      await expect(page.getByLabel("לקוח")).toHaveValue(clientId);
      await page.getByLabel("כותרת").fill(`מהפרויקט ${token}`);
      await page.getByRole("button", { name: "שמירת משימה" }).click();
      await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`));
      const projectTasks = page.getByRole("region", { name: "משימות פתוחות" });
      await expect(projectTasks).toContainText(`מהפרויקט ${token}`);
      await expect(projectTasks).not.toContainText(`מהכרטיס ${token}`);

      // TASK-4 from a card.
      await toggle(page, `מהפרויקט ${token}`).click();
      await expect(toggle(page, `מהפרויקט ${token}`)).toHaveAttribute("aria-pressed", "true");
    },
  );

  test_(
    "TASK-10: archiving the client and the project keeps their tasks",
    async ({ page, token, seedClient, seedProject, seedTask }) => {
      const clientId = await seedClient({ name: `בארכיון ${token}` });
      const projectId = await seedProject({ client_id: clientId, name: `פרויקט ארכיון ${token}` });
      const service = createServiceRoleClient();
      const archivedAt = new Date().toISOString();
      await service.from("projects").update({ archived_at: archivedAt }).eq("id", projectId);
      await service.from("clients").update({ archived_at: archivedAt }).eq("id", clientId);
      await seedTask({ title: `שורדת ${token}`, client_id: clientId, project_id: projectId });
      await page.goto(`/projects/${projectId}`);
      await expect(page.getByRole("region", { name: "משימות פתוחות" })).toContainText(
        `שורדת ${token}`,
      );
      await page.goto(`/clients/${clientId}`);
      await expect(page.getByRole("region", { name: "משימות פתוחות" })).toContainText(
        `שורדת ${token}`,
      );
    },
  );
});

test_.describe("CAL-11: the in-app calendar", () => {
  test_(
    "CAL-1 / CAL-11: agenda by default, day, week and month views show open tasks on their date, with the done toggle, without Google",
    async ({ page, token, seedTask }) => {
      const t = today();
      const title = `ביומן ${token}`;
      const id = await seedTask({ title, due_date: t });
      await seedTask({ title: `בלי דדליין ביומן ${token}`, due_date: null });
      await seedTask({ title: `בוצעה ביומן ${token}`, due_date: t, status: "done" });

      await page.goto("/calendar");
      await expect(page.getByRole("link", { name: "אג׳נדה" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      const main = page.getByRole("main");
      const day = page.getByRole("region", { name: new RegExp(`^${dayLabel(t)}`) });
      await expect(day).toContainText(title);
      await expect(
        day.getByRole("listitem").filter({ hasText: title }).getByText("משימה", { exact: true }),
      ).toBeVisible();
      await expect(main).not.toContainText(`בלי דדליין ביומן ${token}`);
      await expect(main).not.toContainText(`בוצעה ביומן ${token}`);
      await expect(page.getByText(/Google/)).toHaveCount(0);

      await page.getByRole("link", { name: "יום", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`view=day&date=${t}`));
      await expect(page.getByRole("heading", { level: 2, name: dayLabel(t) })).toBeVisible();
      await expect(main).toContainText(title);

      await page.getByRole("link", { name: "שבוע", exact: true }).click();
      const start = weekStart(t);
      await expect(page.getByRole("heading", { level: 2 }).first()).toHaveText(
        `${formatIsoDate(start)} – ${formatIsoDate(addDays(start, 6))}`,
      );
      // Sunday first.
      await expect(main.getByRole("heading", { level: 3 }).first()).toHaveText(
        new RegExp(`^יום ראשון, ${formatIsoDate(start)}`),
      );
      await expect(main.getByRole("heading", { level: 3 })).toHaveCount(7);
      await expect(main).toContainText(title);

      await page.getByRole("link", { name: "חודש", exact: true }).click();
      const table = page.getByRole("table");
      await expect(table.getByRole("columnheader")).toHaveText([
        "א׳ראשון",
        "ב׳שני",
        "ג׳שלישי",
        "ד׳רביעי",
        "ה׳חמישי",
        "ו׳שישי",
        "ש׳שבת",
      ]);
      const todayLink = table.getByRole("link", {
        name: new RegExp(`^${Number(t.slice(8))} – ${dayLabel(t)}, .*היום, נבחר$`),
      });
      await expect(todayLink).toHaveAttribute("aria-current", "date");

      // TASK-4 from the calendar.
      await toggle(page, title).click();
      await expect(toggle(page, title)).toHaveAttribute("aria-pressed", "true");
      expect((await statusOf(id)).status).toBe("done");
      await page.reload();
      await expect(main).not.toContainText(title);
    },
  );

  test_(
    "CAL-1: previous and next move by the view's period; a bad address falls back to agenda and today",
    async ({ page }) => {
      await page.goto("/calendar?view=month&date=2026-11-17");
      await expect(page.getByRole("heading", { level: 2, name: "נובמבר 2026" })).toBeVisible();
      await page.getByRole("link", { name: "החודש הבא" }).click();
      await expect(page.getByRole("heading", { level: 2, name: "דצמבר 2026" })).toBeVisible();
      await page
        .getByRole("link", { name: "1 – יום שלישי, 01/12/2026", exact: false })
        .first()
        .click();
      await expect(page).toHaveURL(/view=month&date=2026-12-01/);
      await page.goto("/calendar?view=year&date=2026-02-30");
      await expect(page.getByRole("link", { name: "אג׳נדה" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await page.goto("/calendar?view=day&date=2026-03-27");
      await page.getByRole("link", { name: "היום הבא" }).click();
      await expect(page).toHaveURL(/date=2026-03-28/);
    },
  );
});

test_.describe("M6-13: layout, accessibility and CSP", () => {
  test_(
    "M6-13: no horizontal scroll and no CSP violations on the task and calendar screens, 44px toggles",
    async ({ page, token, seedClient, seedProject, seedTask }, testInfo) => {
      const violations = await trackCspViolations(page);
      const clientId = await seedClient({ name: `ארוך ${"ארוך".repeat(20)} ${token}` });
      const projectId = await seedProject({
        client_id: clientId,
        name: `פרויקט ארוך ${"ארוך".repeat(20)} ${token}`,
      });
      const longTitle = `${"כותרת ארוכה מאוד ".repeat(10)}${token}`;
      const id = await seedTask({
        title: longTitle,
        client_id: clientId,
        project_id: projectId,
        due_date: today(),
        priority: "high",
      });
      for (const width of VIEWPORT_WIDTHS_BY_PROJECT[testInfo.project.name]) {
        for (const path of [
          "/tasks",
          "/tasks?view=closed",
          "/tasks/new",
          `/tasks/${id}/edit`,
          "/calendar",
          `/calendar?view=day&date=${today()}`,
          `/calendar?view=week&date=${today()}`,
          `/calendar?view=month&date=${today()}`,
          "/",
          `/clients/${clientId}`,
          `/projects/${projectId}`,
        ]) {
          await page.setViewportSize({ width, height: 800 });
          await page.goto(path, { waitUntil: "networkidle" });
          expect(
            await hasHorizontalScroll(page),
            `horizontal scroll at ${width}px on ${path}`,
          ).toBe(false);
        }
      }
      await page.goto(`/calendar?view=day&date=${today()}`);
      const box = (await toggle(page, longTitle).boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
      expect(box.width).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
      expect(violations).toEqual([]);
    },
  );
});

test_.describe("M6-12: export carry-overs", () => {
  test_(
    "M6-12: an over-long hand-made date shows an error, and a malformed echoed date is not put in the input (no console warning)",
    async ({ page }) => {
      const messages: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "warning" || message.type() === "error") {
          messages.push(message.text());
        }
      });
      await page.goto("/export/incomes?from=2026-01-0199&to=2026-12-31");
      await expect(page).toHaveURL(/\/export\?from=2026-01-019&to=2026-12-31$/);
      const from = page.getByLabel("מתאריך");
      await expect(from).toHaveAccessibleDescription("יש להזין תאריך תקין.");
      await expect(from).toHaveValue("");
      await expect(from).toBeFocused();
      await expect(page.getByLabel("עד תאריך (כולל)")).toHaveValue("2026-12-31");
      await page.goto("/export?from=abc&to=2026-12-31");
      await expect(page.getByLabel("מתאריך")).toHaveAccessibleDescription("יש להזין תאריך תקין.");
      expect(messages).toEqual([]);
    },
  );
});
