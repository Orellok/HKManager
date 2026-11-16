import type { Page } from "@playwright/test";

import { todayInJerusalem } from "../../src/lib/dates";

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
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** Formats agorot as the app does, e.g. 100000 → "‏1,000.00 ‏₪". */
function shekels(agorot: number): string {
  return new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS" }).format(
    (agorot / 100).toFixed(2) as `${number}`,
  );
}

const field = {
  client: (page: Page) => page.getByRole("combobox", { name: /^לקוח/ }),
  project: (page: Page) => page.getByRole("combobox", { name: /^פרויקט/ }),
  milestone: (page: Page) => page.getByRole("combobox", { name: /^אבן דרך/ }),
  date: (page: Page) => page.getByLabel(/^תאריך קבלת התשלום/),
  amount: (page: Page) => page.getByRole("textbox", { name: /^סכום/ }),
  method: (page: Page) => page.getByRole("combobox", { name: /^אמצעי תשלום/ }),
  notes: (page: Page) => page.getByRole("textbox", { name: /^הערות/ }),
};

function milestonesRegion(page: Page) {
  return page.getByRole("region", { name: "אבני דרך" });
}

function milestoneItem(page: Page, description: string) {
  return milestonesRegion(page)
    .getByRole("list", { name: "אבני דרך" })
    .getByRole("listitem")
    .filter({ hasText: description })
    .first();
}

/** A row of the project card's details list ("שולם", "יתרה", ...). */
function detail(page: Page, label: string) {
  return page
    .locator("dl > div")
    .filter({ has: page.locator("dt", { hasText: label }) })
    .locator("dd");
}

type IncomeRow = {
  id: string;
  client_id: string;
  project_id: string | null;
  milestone_id: string | null;
  received_date: string;
  amount: number;
  payment_method: string;
  notes: string | null;
  deleted_at: string | null;
};

async function incomesOf(clientId: string): Promise<IncomeRow[]> {
  const { data, error } = await createServiceRoleClient()
    .from("incomes")
    .select(
      "id, client_id, project_id, milestone_id, received_date, amount, payment_method, notes, deleted_at",
    )
    .eq("client_id", clientId)
    .order("created_at");
  expect(error).toBeNull();
  return (data ?? []) as IncomeRow[];
}

type Seeds = {
  token: string;
  seedClient: (client: { name: string }) => Promise<string>;
  seedProject: (project: {
    client_id: string;
    name: string;
    contract_amount?: number;
  }) => Promise<string>;
  seedMilestone: (milestone: {
    project_id: string;
    description: string;
    amount: number;
    due_date: string;
    cancelled_at?: string;
  }) => Promise<string>;
};

/** A client, a project and one milestone of ₪1,000 due in the future. */
async function seedMilestoneFor(
  { token, seedClient, seedProject, seedMilestone }: Seeds,
  options: { contract?: number; amount?: number; dueDate?: string } = {},
) {
  const clientId = await seedClient({ name: `לקוח ${token}` });
  const projectId = await seedProject({
    client_id: clientId,
    name: `פרויקט ${token}`,
    contract_amount: options.contract,
  });
  const milestoneId = await seedMilestone({
    project_id: projectId,
    description: `מקדמה ${token}`,
    amount: options.amount ?? 100_000,
    due_date: options.dueDate ?? "2099-01-01",
  });
  return { clientId, projectId, milestoneId };
}

test_.describe("MS-4: recording a payment for a milestone", () => {
  test_(
    "MS-4: רשום תשלום fills client, project, milestone and the balance; saving records the payment",
    async ({ page, token, seedClient, seedProject, seedMilestone }) => {
      const { clientId, projectId, milestoneId } = await seedMilestoneFor(
        { token, seedClient, seedProject, seedMilestone },
        { contract: 250_000 },
      );
      await page.goto(`/projects/${projectId}`);

      await page.getByRole("link", { name: `רשום תשלום: מקדמה ${token}` }).click();

      await expect(page.getByRole("heading", { level: 1 })).toHaveText("רישום תשלום");
      await expect(field.client(page)).toHaveValue(clientId);
      await expect(field.project(page)).toHaveValue(projectId);
      await expect(field.milestone(page)).toHaveValue(milestoneId);
      await expect(field.amount(page)).toHaveValue("1000");
      await expect(field.date(page)).toHaveValue(todayInJerusalem());
      await field.method(page).selectOption({ label: "ביט/פייבוקס" });
      await page.getByRole("button", { name: "רישום התשלום" }).click();

      await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`));
      await expect(page.getByRole("status").filter({ hasText: "התשלום נרשם." })).toBeVisible();
      const item = milestoneItem(page, `מקדמה ${token}`);
      await expect(item).toContainText("שולם");
      await expect(item).toContainText(`שולם: ${shekels(100_000)}`);
      await expect(item).toContainText(`יתרה: ${shekels(0)}`);
      await expect(item.getByRole("list", { name: `תשלומים: מקדמה ${token}` })).toContainText(
        "ביט/פייבוקס",
      );
      // PRJ-3: contract, paid and balance.
      await expect(detail(page, "שולם")).toHaveText(shekels(100_000));
      await expect(detail(page, "יתרה")).toHaveText(shekels(150_000));
      expect(await incomesOf(clientId)).toMatchObject([
        {
          project_id: projectId,
          milestone_id: milestoneId,
          amount: 100_000,
          payment_method: "bit_paybox",
          received_date: todayInJerusalem(),
          deleted_at: null,
        },
      ]);
    },
  );

  test_(
    "MS-2 / INC-6: a partial payment and then the completing payment; each payment is one income",
    async ({ page, token, seedClient, seedProject, seedMilestone }) => {
      const { clientId, projectId } = await seedMilestoneFor({
        token,
        seedClient,
        seedProject,
        seedMilestone,
      });
      await page.goto(`/projects/${projectId}`);

      await page.getByRole("link", { name: `רשום תשלום: מקדמה ${token}` }).click();
      await field.amount(page).fill("400");
      await field.method(page).selectOption({ label: "מזומן" });
      await page.getByRole("button", { name: "רישום התשלום" }).click();

      const item = milestoneItem(page, `מקדמה ${token}`);
      await expect(item).toContainText("שולם חלקית");
      await expect(item).toContainText(`יתרה: ${shekels(60_000)}`);

      await page.getByRole("link", { name: `רשום תשלום: מקדמה ${token}` }).click();
      // MS-4: the amount defaults to what is left.
      await expect(field.amount(page)).toHaveValue("600");
      await field.method(page).selectOption({ label: "העברה בנקאית" });
      await page.getByRole("button", { name: "רישום התשלום" }).click();

      await expect(page.getByRole("status").filter({ hasText: "התשלום נרשם." })).toBeVisible();
      await expect(item.getByText("שולם", { exact: true })).toBeVisible();
      await expect(item).toContainText(`יתרה: ${shekels(0)}`);
      await expect(
        item.getByRole("list", { name: `תשלומים: מקדמה ${token}` }).getByRole("listitem"),
      ).toHaveCount(2);
      expect((await incomesOf(clientId)).map((income) => income.amount)).toEqual([40_000, 60_000]);
    },
  );

  test_(
    "MS-5: paying more than the balance warns and saves only after explicit confirmation",
    async ({ page, token, seedClient, seedProject, seedMilestone }) => {
      const { clientId, projectId } = await seedMilestoneFor({
        token,
        seedClient,
        seedProject,
        seedMilestone,
      });
      await page.goto(`/projects/${projectId}`);
      await page.getByRole("link", { name: `רשום תשלום: מקדמה ${token}` }).click();
      await field.amount(page).fill("1,250");
      await field.method(page).selectOption({ label: "צ'ק" });

      await page.getByRole("button", { name: "רישום התשלום" }).click();

      const warning = page.getByRole("alert").filter({ hasText: "שימו לב:" });
      await expect(warning).toContainText(
        `הסכום (${shekels(125_000)}) גבוה מהיתרה של אבן הדרך (${shekels(100_000)}) ב-${shekels(25_000)}. לרשום בכל זאת?`,
      );
      await expect(warning).toBeFocused();
      await expect(field.amount(page)).toHaveValue("1,250");
      expect(await incomesOf(clientId)).toEqual([]);

      // Saving again without confirming warns again and still saves nothing.
      await page.getByRole("button", { name: "רישום התשלום" }).click();
      await expect(warning).toBeVisible();
      expect(await incomesOf(clientId)).toEqual([]);

      await warning.getByRole("button", { name: "כן, לרשום את התשלום" }).click();

      await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`));
      const item = milestoneItem(page, `מקדמה ${token}`);
      await expect(item).toContainText(`שולם ביתר: ${shekels(25_000)}`);
      expect((await incomesOf(clientId)).map((income) => income.amount)).toEqual([125_000]);
    },
  );

  test_(
    "MS-5: changing a field after the warning withdraws it; saving again warns with the new amount",
    async ({ page, token, seedClient, seedProject, seedMilestone }) => {
      const { clientId, projectId } = await seedMilestoneFor({
        token,
        seedClient,
        seedProject,
        seedMilestone,
      });
      await page.goto(`/projects/${projectId}`);
      await page.getByRole("link", { name: `רשום תשלום: מקדמה ${token}` }).click();
      await field.amount(page).fill("1,100");
      await field.method(page).selectOption({ label: "אשראי" });
      await page.getByRole("button", { name: "רישום התשלום" }).click();
      const warning = page.getByRole("alert").filter({ hasText: "שימו לב:" });
      await expect(warning).toContainText(shekels(110_000));

      await field.amount(page).fill("1,300");

      await expect(warning).toHaveCount(0);
      await expect(page.getByRole("button", { name: "כן, לרשום את התשלום" })).toHaveCount(0);
      await page.getByRole("button", { name: "רישום התשלום" }).click();
      await expect(warning).toContainText(`הסכום (${shekels(130_000)})`);
      expect(await incomesOf(clientId)).toEqual([]);

      // Any field counts, not only the amount.
      await field.notes(page).fill("הערה");
      await expect(warning).toHaveCount(0);
      await page.getByRole("button", { name: "רישום התשלום" }).click();
      await warning.getByRole("button", { name: "כן, לרשום את התשלום" }).click();
      await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`));
      expect((await incomesOf(clientId)).map((income) => income.amount)).toEqual([130_000]);
    },
  );

  test_(
    "MS-5: pressing Enter in a field after the warning does not confirm the overpayment",
    async ({ page, token, seedClient, seedProject, seedMilestone }) => {
      const { clientId, milestoneId } = await seedMilestoneFor({
        token,
        seedClient,
        seedProject,
        seedMilestone,
      });
      await page.goto(`/incomes/new?milestone=${milestoneId}&from=project`);
      await field.amount(page).fill("1,250");
      await field.method(page).selectOption({ label: "מזומן" });
      await page.getByRole("button", { name: "רישום התשלום" }).click();
      const warning = page.getByRole("alert").filter({ hasText: "שימו לב:" });
      await expect(warning).toBeVisible();

      // Focus only (no change), then Enter: the form submits with its first submit button.
      await field.amount(page).focus();
      await page.keyboard.press("Enter");

      // The server answered with a new warning: focus moves back to it.
      await expect(warning).toBeFocused();
      await expect(warning).toContainText(`הסכום (${shekels(125_000)})`);
      await expect(page).toHaveURL(/\/incomes\/new\?/);
      expect(await incomesOf(clientId)).toEqual([]);
    },
  );

  test_(
    "MS-4: a cancelled milestone has no רשום תשלום, and its payment address explains why",
    async ({ page, token, seedClient, seedProject, seedMilestone }) => {
      const clientId = await seedClient({ name: `לקוח ${token}` });
      const projectId = await seedProject({ client_id: clientId, name: `פרויקט ${token}` });
      const milestoneId = await seedMilestone({
        project_id: projectId,
        description: `מבוטלת ${token}`,
        amount: 1000,
        due_date: "2099-01-01",
        cancelled_at: new Date().toISOString(),
      });
      await page.goto(`/projects/${projectId}`);
      await expect(milestoneItem(page, `מבוטלת ${token}`)).toContainText("בוטל");
      await expect(page.getByRole("link", { name: `רשום תשלום: מבוטלת ${token}` })).toHaveCount(0);

      await page.goto(`/incomes/new?milestone=${milestoneId}&from=project`);

      await expect(page.getByText("אי אפשר לרשום תשלום לאבן דרך שבוטלה.")).toBeVisible();
      await expect(field.amount(page)).toHaveCount(0);
    },
  );

  test_(
    "MS-4: a triple click records one payment",
    async ({ page, token, seedClient, seedProject, seedMilestone }) => {
      const { clientId, milestoneId } = await seedMilestoneFor({
        token,
        seedClient,
        seedProject,
        seedMilestone,
      });
      await page.goto(`/incomes/new?milestone=${milestoneId}&from=project`);
      await field.method(page).selectOption({ label: "מזומן" });

      await clickThreeTimesSynchronously(page, "רישום התשלום");

      await expect(page.getByRole("status").filter({ hasText: "התשלום נרשם." })).toBeVisible();
      expect(await incomesOf(clientId)).toHaveLength(1);
    },
  );
});

test_.describe("INC-1 / INC-2: the income form", () => {
  test_(
    "INC-2: records an income without a project; it appears in the month's list with the total",
    async ({ page, token, seedClient }) => {
      const clientId = await seedClient({ name: `ייעוץ ${token}` });
      await page.goto("/");
      await page
        .getByRole("navigation", { name: "ניווט ראשי" })
        .getByRole("link", { name: "הכנסות" })
        .click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("הכנסות");
      await expect(
        page.getByRole("navigation", { name: "ניווט ראשי" }).getByRole("link", { name: "הכנסות" }),
      ).toHaveAttribute("aria-current", "page");

      await page.getByRole("link", { name: "הכנסה חדשה" }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("הכנסה חדשה");
      await field.client(page).selectOption({ label: `ייעוץ ${token}` });
      await expect(field.project(page)).toHaveValue("");
      await field.amount(page).fill("750.50");
      await field.method(page).selectOption({ label: "אחר" });
      await field.notes(page).fill("פגישת ייעוץ");
      await page.getByRole("button", { name: "שמירת הכנסה" }).click();

      await expect(page).toHaveURL(/\/incomes$/);
      await expect(page.getByRole("status").filter({ hasText: "ההכנסה נשמרה." })).toBeVisible();
      await page.getByLabel("לקוח").selectOption({ label: `ייעוץ ${token}` });
      const list = page.getByRole("list", { name: "רשימת ההכנסות" });
      await expect(list.getByRole("listitem")).toHaveCount(1);
      await expect(list).toContainText("ללא פרויקט");
      await expect(list).toContainText(shekels(75_050));
      await expect(
        page.locator("dt").filter({ hasText: /סה״כ הכנסות ב-.*לקוח: ייעוץ/ }),
      ).toBeVisible();
      await expect(page.locator("dd").filter({ hasText: shekels(75_050) })).toContainText(
        "הכנסה אחת",
      );
      expect(await incomesOf(clientId)).toMatchObject([
        {
          project_id: null,
          milestone_id: null,
          amount: 75_050,
          payment_method: "other",
          notes: "פגישת ייעוץ",
        },
      ]);
    },
  );

  test_(
    "INC-1: choosing a client loads its projects; a project limits the milestones; a milestone chooses its project and fills the amount",
    async ({ page, token, seedClient, seedProject, seedMilestone }) => {
      const { clientId, projectId, milestoneId } = await seedMilestoneFor(
        { token, seedClient, seedProject, seedMilestone },
        { amount: 123_450 },
      );
      const otherProject = await seedProject({ client_id: clientId, name: `שני ${token}` });
      await seedMilestone({
        project_id: otherProject,
        description: `של השני ${token}`,
        amount: 5_000,
        due_date: "2099-01-01",
      });
      await page.goto("/incomes/new");

      await field.client(page).selectOption({ label: `לקוח ${token}` });
      await expect(field.project(page).locator("option")).toHaveCount(3);
      // Without a project, the milestones of all the client's projects are offered.
      await expect(field.milestone(page).locator("option")).toHaveCount(3);

      await field.project(page).selectOption({ label: `שני ${token}` });
      await expect(field.milestone(page).locator("option")).toHaveText([
        "ללא אבן דרך",
        `של השני ${token} (יתרה: ${shekels(5_000)})`,
      ]);

      await field.project(page).selectOption("");
      await field.milestone(page).selectOption(milestoneId);
      await expect(field.project(page)).toHaveValue(projectId);
      await expect(field.amount(page)).toHaveValue("1234.50");
    },
  );

  test_(
    "INC-1: errors are shown next to the fields in Hebrew; the input is kept and the first error focused",
    async ({ page, token, seedClient }) => {
      await seedClient({ name: `שגיאות ${token}` });
      await page.goto("/incomes/new");
      await field.amount(page).fill("0");
      await field.date(page).fill(isoDaysFromToday(2));

      await page.getByRole("button", { name: "שמירת הכנסה" }).click();

      await expect(page.getByRole("alert").first()).toHaveText(
        "לא ניתן לשמור. יש לתקן את השדות המסומנים.",
      );
      await expect(field.client(page)).toBeFocused();
      await expect(field.client(page)).toHaveAccessibleDescription("יש לבחור לקוח.");
      await expect(field.date(page)).toHaveAccessibleDescription(
        "תאריך קבלת התשלום לא יכול להיות בעתיד.",
      );
      await expect(field.amount(page)).toHaveAccessibleDescription(/הסכום חייב להיות גדול מ-0\./);
      await expect(field.method(page)).toHaveAccessibleDescription("יש לבחור אמצעי תשלום.");
      await expect(field.amount(page)).toHaveValue("0");
    },
  );

  test_(
    "INC-1: edits an income from the list; the project card shows the new amount",
    async ({ page, token, seedClient, seedProject, seedMilestone, seedIncome }) => {
      const { clientId, projectId, milestoneId } = await seedMilestoneFor(
        { token, seedClient, seedProject, seedMilestone },
        { contract: 100_000 },
      );
      const id = await seedIncome({
        client_id: clientId,
        project_id: projectId,
        milestone_id: milestoneId,
        received_date: isoDaysFromToday(0),
        amount: 20_000,
      });
      await page.goto("/incomes");
      await page.getByLabel("לקוח").selectOption({ label: `לקוח ${token}` });
      await page
        .getByRole("list", { name: "רשימת ההכנסות" })
        .getByRole("link", { name: new RegExp(`לקוח ${token}`) })
        .click();

      await expect(page.getByRole("heading", { level: 1 })).toHaveText("עריכת הכנסה");
      await expect(field.amount(page)).toHaveValue("200");
      await expect(field.method(page)).toHaveValue("cash");
      await field.amount(page).fill("300");
      await field.method(page).selectOption({ label: "העברה בנקאית" });
      await page.getByRole("button", { name: "שמירת שינויים" }).click();

      await expect(page).toHaveURL(/\/incomes$/);
      await expect(
        page.getByRole("status").filter({ hasText: "השינויים בהכנסה נשמרו." }),
      ).toBeVisible();
      expect(await incomesOf(clientId)).toMatchObject([
        { id, amount: 30_000, payment_method: "bank_transfer" },
      ]);
      await page.goto(`/projects/${projectId}`);
      await expect(detail(page, "שולם")).toHaveText(shekels(30_000));
      await expect(detail(page, "יתרה")).toHaveText(shekels(70_000));
    },
  );

  test_(
    "SPEC 6: deleting an income after confirmation keeps the record as deleted and updates the card",
    async ({ page, token, seedClient, seedProject, seedMilestone, seedIncome }) => {
      const { clientId, projectId, milestoneId } = await seedMilestoneFor({
        token,
        seedClient,
        seedProject,
        seedMilestone,
      });
      const id = await seedIncome({
        client_id: clientId,
        project_id: projectId,
        milestone_id: milestoneId,
        received_date: "2026-01-15",
        amount: 40_000,
      });
      await page.goto(`/projects/${projectId}`);
      const item = milestoneItem(page, `מקדמה ${token}`);
      await expect(item).toContainText(`יתרה: ${shekels(60_000)}`);
      await item.getByRole("link", { name: /^עריכת תשלום/ }).click();

      await page.getByRole("button", { name: "מחיקת הכנסה" }).click();
      const dialog = page.getByRole("dialog", { name: "למחוק את ההכנסה?" });
      await expect(dialog.getByRole("button", { name: "חזרה" })).toBeFocused();
      await dialog.getByRole("button", { name: "מחיקת ההכנסה" }).click();

      await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`));
      await expect(page.getByRole("status").filter({ hasText: "התשלום נמחק." })).toBeVisible();
      await expect(item).toContainText(`יתרה: ${shekels(100_000)}`);
      await expect(item.getByRole("list", { name: /^תשלומים/ })).toHaveCount(0);
      const [row] = await incomesOf(clientId);
      expect(row.id).toBe(id);
      expect(row.deleted_at).not.toBeNull();
      // A deleted income's edit address is the 404 screen.
      const response = await page.goto(`/incomes/${id}/edit`);
      expect(response?.status()).toBe(404);
    },
  );
});

test_.describe("INC-1: the incomes list", () => {
  test_(
    "INC-1: filters by month and client, newest first, with the month total and paging",
    async ({ page, token, seedClient, seedIncome }) => {
      const clientId = await seedClient({ name: `סינון ${token}` });
      const otherId = await seedClient({ name: `אחר ${token}` });
      // A month long past keeps these incomes apart from the rest of the data.
      await seedIncome({ client_id: clientId, received_date: "1906-03-01", amount: 1_000 });
      await seedIncome({ client_id: clientId, received_date: "1906-03-31", amount: 2_000 });
      await seedIncome({
        client_id: clientId,
        received_date: "1906-03-15",
        amount: 3_050,
        payment_method: "credit_card",
      });
      await seedIncome({ client_id: clientId, received_date: "1906-04-01", amount: 9_000 });
      await seedIncome({ client_id: otherId, received_date: "1906-03-10", amount: 500 });
      const rows = Array.from({ length: 51 }, () => ({
        client_id: otherId,
        received_date: "1906-05-05",
        amount: 100,
        payment_method: "cash",
      }));
      expect((await createServiceRoleClient().from("incomes").insert(rows)).error).toBeNull();
      await page.goto("/incomes");

      await page.getByLabel("חודש").fill("1906-03");
      await page.getByLabel("לקוח").selectOption({ label: `סינון ${token}` });

      const list = page.getByRole("list", { name: "רשימת ההכנסות" });
      await expect(list.getByRole("listitem")).toHaveCount(3);
      await expect(list.getByRole("listitem").nth(0)).toContainText("31/03/1906");
      await expect(list.getByRole("listitem").nth(1)).toContainText("15/03/1906");
      await expect(list.getByRole("listitem").nth(1)).toContainText("אשראי");
      await expect(list.getByRole("listitem").nth(2)).toContainText("01/03/1906");
      await expect(
        page.getByText(`סה״כ הכנסות ב-03/1906, לקוח: סינון ${token}`, { exact: true }),
      ).toBeVisible();
      await expect(page.locator("dd").filter({ hasText: shekels(6_050) })).toContainText(
        "3 הכנסות",
      );

      await page.getByLabel("לקוח").selectOption({ label: `אחר ${token}` });
      await page.getByLabel("חודש").fill("1906-05");
      await expect(list.getByRole("listitem")).toHaveCount(50);
      await expect(page.locator("dd").filter({ hasText: shekels(5_100) })).toContainText(
        "51 הכנסות",
      );
      await page.getByRole("button", { name: "הצגת הכנסות נוספות" }).click();
      await expect(list.getByRole("listitem")).toHaveCount(51);
      await expect(list.getByRole("listitem").nth(50).getByRole("link")).toBeFocused();

      await page.getByLabel("חודש").fill("1906-06");
      await expect(page.getByText("אין הכנסות בחודש הזה.")).toBeVisible();
    },
  );

  test_(
    "INC-1: a failed filter load keeps the list and the shown filters, with an inline error",
    async ({ page, token, seedClient, seedIncome }) => {
      const clientId = await seedClient({ name: `כשל ${token}` });
      await seedIncome({ client_id: clientId, received_date: "1906-07-07", amount: 700 });
      await page.goto("/incomes");
      await page.getByLabel("חודש").fill("1906-07");
      await page.getByLabel("לקוח").selectOption({ label: `כשל ${token}` });
      const list = page.getByRole("list", { name: "רשימת ההכנסות" });
      await expect(list.getByRole("listitem")).toHaveCount(1);
      const restore = await failServerActions(page, "abort");

      await page.getByLabel("חודש").fill("1906-08");

      await expect(
        page.getByRole("alert").filter({ hasText: "טעינת ההכנסות נכשלה. אפשר לנסות שוב." }),
      ).toBeVisible();
      await expect(page.getByLabel("חודש")).toHaveValue("1906-07");
      await expect(list.getByRole("listitem")).toHaveCount(1);
      await restore();
    },
  );
});

test_.describe("PRJ-3 / CLI-4 / MS-6: balances on the cards and in open debts", () => {
  test_(
    "PRJ-3 / CLI-4: project and client cards show paid and balance from the incomes",
    async ({ page, token, seedClient, seedProject, seedMilestone, seedIncome }) => {
      const clientId = await seedClient({ name: `כרטיס ${token}` });
      const projectId = await seedProject({
        client_id: clientId,
        name: `כרטיס ${token}`,
        contract_amount: 500_000,
      });
      const first = await seedMilestone({
        project_id: projectId,
        description: `ראשונה ${token}`,
        amount: 200_000,
        due_date: "2099-01-01",
      });
      await seedMilestone({
        project_id: projectId,
        description: `שנייה ${token}`,
        amount: 300_000,
        due_date: "2099-02-01",
      });
      await seedIncome({
        client_id: clientId,
        project_id: projectId,
        milestone_id: first,
        received_date: "2026-01-10",
        amount: 50_000,
      });
      await seedIncome({
        client_id: clientId,
        project_id: projectId,
        received_date: "2026-01-11",
        amount: 10_000,
        payment_method: "check",
      });
      await seedIncome({ client_id: clientId, received_date: "2026-01-12", amount: 1_000 });

      await page.goto(`/projects/${projectId}`);
      await expect(detail(page, "סכום חוזה")).toHaveText(shekels(500_000));
      await expect(detail(page, "שולם")).toHaveText(shekels(60_000));
      await expect(detail(page, "יתרה")).toHaveText(shekels(440_000));
      await expect(milestoneItem(page, `ראשונה ${token}`)).toContainText("שולם חלקית");
      await expect(milestonesRegion(page)).toContainText(
        `שולם על אבני הדרך: ${shekels(50_000)}. נותר לתשלום באבני הדרך: ${shekels(450_000)}.`,
      );
      const withoutMilestone = page.getByRole("region", { name: "הכנסות ללא אבן דרך" });
      await expect(withoutMilestone.getByRole("listitem")).toHaveCount(1);
      await expect(withoutMilestone).toContainText("צ'ק");

      await page.goto(`/clients/${clientId}`);
      const payments = page.getByRole("region", { name: "תשלומים" });
      await expect(payments).toContainText(`סה״כ שולם${shekels(61_000)}`);
      await expect(payments).toContainText(
        `יתרה פתוחה באבני דרך (פרויקטים שאינם בארכיון)${shekels(450_000)}`,
      );
    },
  );

  test_(
    "MS-6: open debts show the balance after payments; a fully paid milestone leaves the list",
    async ({ page, token, seedClient, seedProject, seedMilestone, seedIncome }) => {
      const { clientId, projectId, milestoneId } = await seedMilestoneFor(
        { token, seedClient, seedProject, seedMilestone },
        { dueDate: isoDaysFromToday(-5) },
      );
      await seedIncome({
        client_id: clientId,
        project_id: projectId,
        milestone_id: milestoneId,
        received_date: isoDaysFromToday(-1),
        amount: 30_000,
      });
      const list = page.getByRole("list", { name: "רשימת החובות הפתוחים" });
      const mine = list.getByRole("listitem").filter({ hasText: token });
      // Load every page until this test's debt shows (or the list ends). Other tests add and
      // remove debts meanwhile, which can shift a row across a page boundary, so a pass that
      // does not see the expected count starts over from a fresh page.
      const expectDebtCount = async (count: number) => {
        await expect(async () => {
          await page.goto("/debts");
          const loadMore = page.getByRole("button", { name: "הצגת חובות נוספים" });
          while ((await mine.count()) === 0 && (await loadMore.isVisible())) {
            const shown = await list.getByRole("listitem").count();
            await loadMore.click();
            await expect(list.getByRole("listitem")).not.toHaveCount(shown, { timeout: 5_000 });
          }
          expect(await mine.count()).toBe(count);
        }).toPass({ timeout: 60_000 });
      };

      await expectDebtCount(1);
      await expect(mine).toContainText(shekels(70_000));

      await seedIncome({
        client_id: clientId,
        project_id: projectId,
        milestone_id: milestoneId,
        received_date: isoDaysFromToday(0),
        amount: 70_000,
      });
      await expectDebtCount(0);
    },
  );
});

test_.describe("M2.1-10: failed requests and ended sessions", () => {
  for (const mode of ["abort", "500"] as const) {
    test_(
      `INC-1: a failed save (${mode}) shows an inline error and keeps the input`,
      async ({ page, token, seedClient, seedProject, seedMilestone }) => {
        const { clientId, milestoneId } = await seedMilestoneFor({
          token,
          seedClient,
          seedProject,
          seedMilestone,
        });
        await page.goto(`/incomes/new?milestone=${milestoneId}&from=project`);
        await field.amount(page).fill("123");
        await field.method(page).selectOption({ label: "מזומן" });
        const restore = await failServerActions(page, mode);

        await page.getByRole("button", { name: "רישום התשלום" }).click();

        await expect(page.getByRole("alert").first()).toHaveText(SAVE_UNAVAILABLE);
        await expect(field.amount(page)).toHaveValue("123");
        await expect(field.milestone(page)).toHaveValue(milestoneId);
        expect(await incomesOf(clientId)).toEqual([]);
        await restore();
      },
    );
  }

  test_(
    "INC-1: saving while offline shows the inline error and does not redirect",
    async ({ page, context, token, seedClient }) => {
      const clientId = await seedClient({ name: `לא מקוון ${token}` });
      await page.goto("/incomes/new");
      await field.client(page).selectOption({ label: `לא מקוון ${token}` });
      await field.amount(page).fill("10");
      await field.method(page).selectOption({ label: "מזומן" });
      await context.setOffline(true);

      await page.getByRole("button", { name: "שמירת הכנסה" }).click();

      await expect(page.getByRole("alert").first()).toHaveText(SAVE_UNAVAILABLE);
      await expect(page).toHaveURL(/\/incomes\/new$/);
      await expect(field.amount(page)).toHaveValue("10");
      await context.setOffline(false);
      expect(await incomesOf(clientId)).toEqual([]);
    },
  );

  test_(
    "SPEC 6: a failed delete (500) shows the error inside the dialog and keeps the income",
    async ({ page, token, seedClient, seedIncome }) => {
      const clientId = await seedClient({ name: `מחיקה ${token}` });
      const id = await seedIncome({ client_id: clientId, received_date: "2026-01-01", amount: 1 });
      await page.goto(`/incomes/${id}/edit`);
      const restore = await failServerActions(page, "500");

      await page.getByRole("button", { name: "מחיקת הכנסה" }).click();
      const dialog = page.getByRole("dialog", { name: "למחוק את ההכנסה?" });
      await dialog.getByRole("button", { name: "מחיקת ההכנסה" }).click();

      await expect(dialog.getByRole("alert")).toHaveText(REQUEST_FAILED);
      expect((await incomesOf(clientId))[0].deleted_at).toBeNull();
      await restore();
    },
  );

  test_(
    "AUTH-3: recording a payment after the session ended opens /login",
    async ({ page, context, token, seedClient, seedProject, seedMilestone }) => {
      const { clientId, milestoneId } = await seedMilestoneFor({
        token,
        seedClient,
        seedProject,
        seedMilestone,
      });
      await page.goto(`/incomes/new?milestone=${milestoneId}&from=project`);
      await field.method(page).selectOption({ label: "מזומן" });
      await context.clearCookies();

      await page.getByRole("button", { name: "רישום התשלום" }).click();

      await expect(page).toHaveURL(/\/login$/);
      expect(await incomesOf(clientId)).toEqual([]);
    },
  );
});

test_.describe("M2.1-12: layout and CSP", () => {
  test_(
    "INC-1 / PRJ-3: no horizontal scroll and no CSP violations on the incomes screens",
    async ({ page, token, seedClient, seedProject, seedMilestone, seedIncome }, testInfo) => {
      const violations = await trackCspViolations(page);
      const clientId = await seedClient({ name: `לקוח ארוך ${"ארוך".repeat(20)} ${token}` });
      const projectId = await seedProject({
        client_id: clientId,
        name: `פרויקט ארוך ${"ארוך".repeat(20)} ${token}`,
        contract_amount: 9_999_999_999,
      });
      const milestoneId = await seedMilestone({
        project_id: projectId,
        description: `${"תיאור ארוך ".repeat(18).trim()} ${token}`.slice(0, 200),
        amount: 9_999_999_999,
        due_date: "2099-01-01",
      });
      const id = await seedIncome({
        client_id: clientId,
        project_id: projectId,
        milestone_id: milestoneId,
        received_date: isoDaysFromToday(0),
        amount: 9_999_999_999,
        notes: "הערה ארוכה ".repeat(100).trim(),
      });

      for (const width of VIEWPORT_WIDTHS_BY_PROJECT[testInfo.project.name]) {
        for (const path of [
          "/incomes",
          "/incomes/new",
          `/incomes/new?milestone=${milestoneId}&from=project`,
          `/incomes/${id}/edit`,
          `/projects/${projectId}`,
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
      // Exercise zod, the overpayment warning and the Server Actions in the browser as well.
      await page.goto(`/incomes/new?milestone=${milestoneId}&from=project`);
      await field.amount(page).fill("abc");
      await page.getByRole("button", { name: "רישום התשלום" }).click();
      await expect(field.amount(page)).toHaveAttribute("aria-invalid", "true");
      await field.amount(page).fill("1");
      await field.method(page).selectOption({ label: "מזומן" });
      await page.getByRole("button", { name: "רישום התשלום" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "שימו לב:" })).toBeVisible();
      expect(violations).toEqual([]);
    },
  );
});
