import type { Page } from "@playwright/test";

import { todayInJerusalem } from "../../src/lib/dates";

import type { TestAccount } from "./support/auth-fixtures";
import { createServiceRoleClient, expect, test_ } from "./support/data-fixtures";
import {
  MIN_TOUCH_TARGET,
  VIEWPORT_WIDTHS_BY_PROJECT,
  failServerActions,
  hasHorizontalScroll,
  trackCspViolations,
} from "./support/helpers";

let account: TestAccount;

test_.beforeEach(async ({ signIn }) => {
  account = await signIn({ role: "owner" });
});

const SAVE_UNAVAILABLE = "לא ניתן לשמור כרגע. בדקו את החיבור ונסו שוב.";
const LOCKED =
  "להכנסה הזו כבר הופקה קבלה, ולכן אי אפשר לערוך או למחוק אותה. תיקון נעשה אצל ספק הקבלות, ואחר כך אפשר לעדכן כאן את פרטי הקבלה.";
const RECORDED_NOTICE = "הקבלה נשמרה. סטטוס ההכנסה: הופקה קבלה.";
const UPDATED_NOTICE = "פרטי הקבלה עודכנו. השינוי נרשם ביומן השינויים.";
const MAX_BYTES = 10 * 1024 * 1024;

/** A tiny valid-looking PDF, or one padded to `size` bytes. */
function pdf(size = 0): Buffer {
  const body = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");
  return size > body.length ? Buffer.concat([body, Buffer.alloc(size - body.length, 0x20)]) : body;
}

/** Formats agorot as the app does, e.g. 1250050 → "‏12,500.50 ‏₪". */
function shekels(agorot: number): string {
  return new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS" }).format(
    (agorot / 100).toFixed(2) as `${number}`,
  );
}

const field = {
  number: (page: Page) => page.getByRole("textbox", { name: /^מספר קבלה/ }),
  date: (page: Page) => page.getByLabel(/^תאריך הפקת הקבלה/),
  file: (page: Page) => page.getByLabel(/^קובץ הקבלה/),
  url: (page: Page) => page.getByRole("textbox", { name: /^קישור לקבלה/ }),
  fileSource: (page: Page) => page.getByRole("radio", { name: "קובץ PDF" }),
  linkSource: (page: Page) => page.getByRole("radio", { name: "קישור לקבלה" }),
};

/** Opens a receipt page and waits until it is interactive (the source choice and copy buttons). */
async function gotoReceipt(page: Page, incomeId: string) {
  await page.goto(`/incomes/${incomeId}/receipt`);
  await expect(field.fileSource(page)).toBeEnabled();
}

type DocumentRow = {
  id: string;
  doc_number: string;
  issued_date: string;
  provider: string;
  file_path: string | null;
  url: string | null;
};

async function documentOf(incomeId: string): Promise<DocumentRow | null> {
  const { data, error } = await createServiceRoleClient()
    .from("documents")
    .select("id, doc_number, issued_date, provider, file_path, url")
    .eq("income_id", incomeId)
    .maybeSingle<DocumentRow>();
  expect(error).toBeNull();
  return data;
}

async function storedFiles(incomeId: string): Promise<string[]> {
  const { data, error } = await createServiceRoleClient().storage.from("receipts").list(incomeId);
  expect(error).toBeNull();
  return (data ?? []).map((object) => object.name);
}

type Seeds = {
  token: string;
  seedClient: (client: { name: string }) => Promise<string>;
  seedProject: (project: { client_id: string; name: string }) => Promise<string>;
  seedMilestone: (milestone: {
    project_id: string;
    description: string;
    amount: number;
    due_date: string;
  }) => Promise<string>;
  seedIncome: (income: {
    client_id: string;
    project_id?: string;
    milestone_id?: string;
    received_date: string;
    amount: number;
    payment_method?: "bank_transfer" | "cash";
    notes?: string;
  }) => Promise<string>;
};

/** A client, a project with a milestone, and a payment of ₪12,500.50 for it. */
async function seedPayment(
  { token, seedClient, seedProject, seedMilestone, seedIncome }: Seeds,
  receivedDate = todayInJerusalem(),
) {
  const clientName = `דנה "כהן", ${token}`;
  const clientId = await seedClient({ name: clientName });
  const projectId = await seedProject({ client_id: clientId, name: `דירה ${token}` });
  const milestoneId = await seedMilestone({
    project_id: projectId,
    description: `מקדמה ${token}`,
    amount: 2_000_000,
    due_date: "2099-01-01",
  });
  const incomeId = await seedIncome({
    client_id: clientId,
    project_id: projectId,
    milestone_id: milestoneId,
    received_date: receivedDate,
    amount: 1_250_050,
    payment_method: "bank_transfer",
  });
  return { clientName, clientId, projectId, milestoneId, incomeId };
}

/** A unique receipt number for the test (letters and digits only). */
function receiptNumber(token: string, suffix = ""): string {
  return `R${token}${suffix}`;
}

test_.describe("DOC-1: issuing a receipt at the provider", () => {
  test_(
    "DOC-1 / INC-3: הפק קבלה shows the transaction details with copy buttons and opens the provider",
    async ({ page, context, token, seedClient, seedProject, seedMilestone, seedIncome }) => {
      const seeds = { token, seedClient, seedProject, seedMilestone, seedIncome };
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      const { clientName, incomeId } = await seedPayment(seeds);
      await page.goto(`/incomes/${incomeId}/edit`);
      await expect(page.getByText("ממתינה לקבלה", { exact: true })).toBeVisible();

      await page.getByRole("link", { name: "הפק קבלה" }).click();

      await expect(page).toHaveURL(new RegExp(`/incomes/${incomeId}/receipt$`));
      await expect(page.getByRole("heading", { level: 1, name: "הפקת קבלה" })).toBeVisible();
      await expect(field.fileSource(page)).toBeEnabled();
      const details = page.getByRole("region", { name: "פרטי העסקה" });
      for (const text of [
        clientName,
        shekels(1_250_050),
        `דירה ${seeds.token} – מקדמה ${seeds.token}`,
        todayInJerusalem().split("-").reverse().join("/"),
        "העברה בנקאית",
      ]) {
        await expect(details.getByText(text, { exact: true })).toBeVisible();
      }

      await details.getByRole("button", { name: "העתקה שם הלקוח" }).click();
      await expect(details.getByRole("status")).toHaveText("הועתק: שם הלקוח.");
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(clientName);

      await details.getByRole("button", { name: "העתקה סכום" }).click();
      await expect(details.getByRole("status")).toHaveText("הועתק: סכום.");
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("12500.50");

      const provider = details.getByRole("link", { name: /^פתיחת SUMIT/ });
      await expect(provider).toHaveAttribute("href", "https://app.sumit.co.il/");
      await expect(provider).toHaveAttribute("target", "_blank");
      await expect(provider).toHaveAttribute("rel", "noopener noreferrer");
      const box = await details.getByRole("button", { name: "העתקה שם הלקוח" }).boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    },
  );

  test_(
    "DOC-1: when the browser refuses clipboard access, the value is shown selected to copy by hand",
    async ({ page, token, seedClient, seedProject, seedMilestone, seedIncome }) => {
      const seeds = { token, seedClient, seedProject, seedMilestone, seedIncome };
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "clipboard", {
          value: { writeText: () => Promise.reject(new DOMException("denied", "NotAllowedError")) },
        });
      });
      const { clientName, incomeId } = await seedPayment(seeds);
      await gotoReceipt(page, incomeId);
      const details = page.getByRole("region", { name: "פרטי העסקה" });

      await details.getByRole("button", { name: "העתקה שם הלקוח" }).click();

      const manual = details.getByRole("textbox", { name: "שם הלקוח להעתקה ידנית" });
      await expect(manual).toBeFocused();
      await expect(manual).toHaveValue(clientName);
      expect(
        await manual.evaluate((input: HTMLInputElement) =>
          input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0),
        ),
      ).toBe(clientName);
      await expect(details.getByRole("status")).toHaveText(
        "לא הצלחנו להעתיק את שם הלקוח. אפשר להעתיק את הערך מהשדה שסומן.",
      );
    },
  );
});

test_.describe("DOC-2: recording the receipt", () => {
  test_(
    "DOC-2 / INC-3: records a receipt with a PDF; the status changes and the file opens through a signed URL",
    async ({ page, token, seedClient, seedProject, seedMilestone, seedIncome }) => {
      const seeds = { token, seedClient, seedProject, seedMilestone, seedIncome };
      const violations = await trackCspViolations(page);
      const { incomeId } = await seedPayment(seeds);
      await gotoReceipt(page, incomeId);
      await expect(field.date(page)).toHaveValue(todayInJerusalem());
      await field.number(page).fill(receiptNumber(seeds.token));
      await field.file(page).setInputFiles({
        name: "קבלה של דנה.pdf",
        mimeType: "application/pdf",
        buffer: pdf(),
      });

      await page.getByRole("button", { name: "שמירת הקבלה" }).click();

      await expect(page.getByRole("status").filter({ hasText: RECORDED_NOTICE })).toBeVisible();
      await expect(page.getByRole("heading", { level: 1, name: "קבלה להכנסה" })).toBeVisible();
      await expect(page.getByText("הופקה קבלה", { exact: true })).toBeVisible();
      const document = await documentOf(incomeId);
      expect(document).toMatchObject({
        doc_number: receiptNumber(seeds.token),
        issued_date: todayInJerusalem(),
        provider: "SUMIT",
        url: null,
      });
      // No personal data in the stored path: the income id and a random name only.
      expect(document?.file_path).toMatch(new RegExp(`^${incomeId}/[0-9a-f-]{36}\\.pdf$`));
      expect(page.url()).not.toContain("notice=");

      const redirect = await page.request.get(`/incomes/${incomeId}/receipt/file`, {
        maxRedirects: 0,
      });
      expect(redirect.status()).toBe(303);
      const signedUrl = new URL(redirect.headers()["location"]);
      expect(signedUrl.pathname).toContain("/storage/v1/object/sign/receipts/");
      expect(signedUrl.searchParams.get("token")).toBeTruthy();
      const file = await page.request.get(signedUrl.toString());
      expect(file.status()).toBe(200);
      expect((await file.body()).subarray(0, 5).toString()).toBe("%PDF-");

      // The link opens a new tab that is redirected to the signed URL (headless Chromium
      // downloads a PDF instead of showing it, so the request is what is checked).
      const popupPromise = page.waitForEvent("popup");
      const storageRequest = page
        .context()
        .waitForEvent("request", (request) =>
          request.url().includes("/storage/v1/object/sign/receipts/"),
        );
      await page.getByRole("link", { name: /^צפייה בקובץ הקבלה/ }).click();
      await storageRequest;
      await (await popupPromise).close();
      expect(violations).toEqual([]);
    },
  );

  test_(
    "DOC-2: records a receipt with an https link; an http link is refused first",
    async ({ page, token, seedClient, seedProject, seedMilestone, seedIncome }) => {
      const seeds = { token, seedClient, seedProject, seedMilestone, seedIncome };
      const { incomeId } = await seedPayment(seeds);
      await gotoReceipt(page, incomeId);
      await field.number(page).fill(receiptNumber(seeds.token));
      await field.linkSource(page).check();
      await expect(field.file(page)).toBeHidden();
      await field.url(page).fill("http://app.sumit.co.il/doc/1");

      await page.getByRole("button", { name: "שמירת הקבלה" }).click();

      await expect(page.getByText("הקישור חייב להתחיל ב-https://.")).toBeVisible();
      await expect(field.url(page)).toBeFocused();
      await expect(field.url(page)).toHaveAttribute("aria-invalid", "true");
      await field.url(page).fill("https://app.sumit.co.il/doc/1");
      await page.getByRole("button", { name: "שמירת הקבלה" }).click();

      await expect(page.getByRole("status").filter({ hasText: RECORDED_NOTICE })).toBeVisible();
      await expect(page.getByRole("link", { name: /^פתיחת הקישור לקבלה/ })).toHaveAttribute(
        "href",
        "https://app.sumit.co.il/doc/1",
      );
      expect(await documentOf(incomeId)).toMatchObject({
        url: "https://app.sumit.co.il/doc/1",
        file_path: null,
      });
    },
  );

  test_(
    "DOC-2: a file that is not a PDF, an empty choice and a file over 10MB are refused beside the field",
    async ({ page, token, seedClient, seedProject, seedMilestone, seedIncome }) => {
      const seeds = { token, seedClient, seedProject, seedMilestone, seedIncome };
      const { incomeId } = await seedPayment(seeds);
      await gotoReceipt(page, incomeId);
      await field.number(page).fill(receiptNumber(seeds.token));
      const save = page.getByRole("button", { name: "שמירת הקבלה" });

      await save.click();
      await expect(page.getByText("יש לבחור קובץ PDF של הקבלה.")).toBeVisible();
      await expect(field.file(page)).toBeFocused();

      await field.file(page).setInputFiles({
        name: "receipt.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("<html>not a pdf</html>"),
      });
      await save.click();
      await expect(page.getByText("אפשר להעלות רק קובץ PDF.")).toBeVisible();

      await field.file(page).setInputFiles({
        name: "receipt.png",
        mimeType: "image/png",
        buffer: Buffer.from("png"),
      });
      await save.click();
      await expect(page.getByText("אפשר להעלות רק קובץ PDF.")).toBeVisible();

      await field.file(page).setInputFiles({
        name: "big.pdf",
        mimeType: "application/pdf",
        buffer: pdf(MAX_BYTES + 1),
      });
      await save.click();
      await expect(
        page.getByText("הקובץ גדול מדי. אפשר להעלות קובץ PDF של עד 10MB."),
      ).toBeVisible();
      await expect(field.number(page)).toHaveValue(receiptNumber(seeds.token));

      expect(await documentOf(incomeId)).toBeNull();
      expect(await storedFiles(incomeId)).toEqual([]);
    },
  );

  test_(
    "DOC-2: a PDF of exactly 10MB is accepted",
    async ({ page, token, seedClient, seedProject, seedMilestone, seedIncome }, testInfo) => {
      const seeds = { token, seedClient, seedProject, seedMilestone, seedIncome };
      test_.skip(testInfo.project.name !== "desktop", "One large upload is enough");
      const { incomeId } = await seedPayment(seeds);
      await gotoReceipt(page, incomeId);
      await field.number(page).fill(receiptNumber(seeds.token));
      await field.file(page).setInputFiles({
        name: "big.pdf",
        mimeType: "application/pdf",
        buffer: pdf(MAX_BYTES),
      });

      await page.getByRole("button", { name: "שמירת הקבלה" }).click();

      await expect(page.getByRole("status").filter({ hasText: RECORDED_NOTICE })).toBeVisible();
      expect((await documentOf(incomeId))?.file_path).not.toBeNull();
    },
  );
});

test_.describe("DOC-3: unique receipt numbers", () => {
  test_(
    "DOC-3: a receipt number already recorded shows a field error, keeps the input and removes the upload",
    async ({ page, seedReceipt, token, seedClient, seedProject, seedMilestone, seedIncome }) => {
      const seeds = { token, seedClient, seedProject, seedMilestone, seedIncome };
      const { incomeId, clientId } = await seedPayment(seeds);
      const otherIncome = await seeds.seedIncome({
        client_id: clientId,
        received_date: todayInJerusalem(),
        amount: 100,
      });
      const taken = receiptNumber(seeds.token, "A");
      await seedReceipt({
        income_id: otherIncome,
        doc_number: taken,
        issued_date: todayInJerusalem(),
      });
      await gotoReceipt(page, incomeId);
      await field.number(page).fill(taken);
      await field.file(page).setInputFiles({
        name: "receipt.pdf",
        mimeType: "application/pdf",
        buffer: pdf(),
      });

      await page.getByRole("button", { name: "שמירת הקבלה" }).click();

      await expect(
        page.getByText("מספר הקבלה הזה כבר רשום לקבלה אחרת. יש לבדוק את המספר."),
      ).toBeVisible();
      await expect(field.number(page)).toBeFocused();
      await expect(field.number(page)).toHaveValue(taken);
      expect(await documentOf(incomeId)).toBeNull();
      await expect.poll(() => storedFiles(incomeId)).toEqual([]);
    },
  );
});

test_.describe("INC-4: an income with a receipt is locked", () => {
  test_(
    "INC-4: the income page is read-only with the reason, without the form or delete",
    async ({ page, seedReceipt, token, seedClient, seedProject, seedMilestone, seedIncome }) => {
      const seeds = { token, seedClient, seedProject, seedMilestone, seedIncome };
      const { incomeId } = await seedPayment(seeds);
      await seedReceipt({
        income_id: incomeId,
        doc_number: receiptNumber(seeds.token),
        issued_date: todayInJerusalem(),
      });

      await page.goto(`/incomes/${incomeId}/edit`);

      await expect(page.getByRole("heading", { level: 1, name: "פרטי הכנסה" })).toBeVisible();
      await expect(page.getByText(LOCKED)).toBeVisible();
      await expect(page.getByText("הופקה קבלה", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "שמירת שינויים" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "מחיקת הכנסה" })).toHaveCount(0);
      await page.getByRole("link", { name: "לפרטי הקבלה" }).click();
      await expect(page).toHaveURL(new RegExp(`/incomes/${incomeId}/receipt$`));
    },
  );

  test_(
    "INC-4: saving or deleting an income whose receipt was recorded meanwhile is refused with the reason",
    async ({ page, seedReceipt, token, seedClient, seedProject, seedMilestone, seedIncome }) => {
      const seeds = { token, seedClient, seedProject, seedMilestone, seedIncome };
      const { incomeId } = await seedPayment(seeds);
      await page.goto(`/incomes/${incomeId}/edit`);
      await expect(page.getByRole("combobox", { name: /^לקוח/ })).toBeEnabled();
      await seedReceipt({
        income_id: incomeId,
        doc_number: receiptNumber(seeds.token),
        issued_date: todayInJerusalem(),
      });

      await page.getByRole("textbox", { name: /^סכום/ }).fill("1");
      await page.getByRole("button", { name: "שמירת שינויים" }).click();
      await expect(page.getByRole("alert").first()).toHaveText(LOCKED);
      await expect(page.getByRole("textbox", { name: /^סכום/ })).toHaveValue("1");

      await page.getByRole("button", { name: "מחיקת הכנסה" }).click();
      const dialog = page.getByRole("dialog", { name: "למחוק את ההכנסה?" });
      await dialog.getByRole("button", { name: "מחיקת ההכנסה" }).click();
      await expect(dialog.getByRole("alert")).toHaveText(LOCKED);

      const { data } = await createServiceRoleClient()
        .from("incomes")
        .select("amount, deleted_at")
        .eq("id", incomeId)
        .single();
      expect(data).toEqual({ amount: 1_250_050, deleted_at: null });
    },
  );
});

test_.describe("owner decision: receipt details stay editable, with audit", () => {
  test_(
    "owner decision: changing the number and replacing the link with a PDF is saved and audited",
    async ({ page, seedReceipt, token, seedClient, seedProject, seedMilestone, seedIncome }) => {
      const seeds = { token, seedClient, seedProject, seedMilestone, seedIncome };
      const { incomeId } = await seedPayment(seeds);
      const documentId = await seedReceipt({
        income_id: incomeId,
        doc_number: receiptNumber(seeds.token, "A"),
        issued_date: todayInJerusalem(),
        url: "https://app.sumit.co.il/doc/old",
      });
      await gotoReceipt(page, incomeId);
      await expect(page.getByRole("heading", { level: 1, name: "קבלה להכנסה" })).toBeVisible();
      await expect(field.linkSource(page)).toBeChecked();
      await expect(field.url(page)).toHaveValue("https://app.sumit.co.il/doc/old");

      await field.number(page).fill(receiptNumber(seeds.token, "B"));
      await field.fileSource(page).check();
      await field.file(page).setInputFiles({
        name: "receipt.pdf",
        mimeType: "application/pdf",
        buffer: pdf(),
      });
      await page.getByRole("button", { name: "שמירת פרטי הקבלה" }).click();

      await expect(page.getByRole("status").filter({ hasText: UPDATED_NOTICE })).toBeVisible();
      await expect(page.getByText(receiptNumber(seeds.token, "B"), { exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: /^צפייה בקובץ הקבלה/ })).toBeVisible();
      const document = await documentOf(incomeId);
      expect(document).toMatchObject({ doc_number: receiptNumber(seeds.token, "B"), url: null });
      const { data: audit } = await createServiceRoleClient()
        .from("audit_log")
        .select("actor, action, diff")
        .eq("entity_id", documentId)
        .eq("action", "update");
      expect(audit).toEqual([
        {
          actor: account.id,
          action: "update",
          diff: {
            doc_number: {
              old: receiptNumber(seeds.token, "A"),
              new: receiptNumber(seeds.token, "B"),
            },
            file_path: { old: null, new: document?.file_path },
            url: { changed: true },
          },
        },
      ]);
      // A receipt cannot be deleted: the page offers no way to.
      await expect(page.getByRole("button", { name: /מחיקה|מחיקת/ })).toHaveCount(0);
    },
  );

  test_(
    "owner decision: saving the details without a new file keeps the stored PDF",
    async ({ page, token, seedClient, seedProject, seedMilestone, seedIncome }) => {
      const seeds = { token, seedClient, seedProject, seedMilestone, seedIncome };
      const { incomeId } = await seedPayment(seeds);
      await gotoReceipt(page, incomeId);
      await field.number(page).fill(receiptNumber(seeds.token, "A"));
      await field
        .file(page)
        .setInputFiles({ name: "r.pdf", mimeType: "application/pdf", buffer: pdf() });
      await page.getByRole("button", { name: "שמירת הקבלה" }).click();
      await expect(page.getByRole("status").filter({ hasText: RECORDED_NOTICE })).toBeVisible();
      const recorded = await documentOf(incomeId);
      await expect(field.fileSource(page)).toBeEnabled();

      await field.number(page).fill(receiptNumber(seeds.token, "B"));
      await page.getByRole("button", { name: "שמירת פרטי הקבלה" }).click();

      await expect(page.getByRole("status").filter({ hasText: UPDATED_NOTICE })).toBeVisible();
      expect(await documentOf(incomeId)).toMatchObject({
        doc_number: receiptNumber(seeds.token, "B"),
        file_path: recorded?.file_path,
      });
    },
  );
});

test_.describe("DOC-4 / DOC-5: counters, the home card and the pending list", () => {
  test_(
    "DOC-5: the home card counts the pending receipts and leads to their list; recording one removes it",
    async ({ page, token, seedClient, seedProject, seedMilestone, seedIncome }) => {
      const seeds = { token, seedClient, seedProject, seedMilestone, seedIncome };
      // An old received date sorts first in the pending list (oldest first).
      const { clientName, incomeId } = await seedPayment(seeds, "1901-02-03");
      await page.goto("/");
      const card = page.getByRole("region", { name: "קבלות ממתינות" });
      await expect(card.getByText(/^(הכנסה אחת ממתינה|\d+ הכנסות ממתינות) לקבלה\.$/)).toBeVisible();
      await expect(card.getByText(/^קבלות שהופקו החודש: \d+ מתוך 10$/)).toBeVisible();

      await card.getByRole("link", { name: "להכנסות שממתינות לקבלה" }).click();

      await expect(page).toHaveURL(/\/incomes\?view=pending$/);
      await expect(
        page.getByRole("navigation", { name: "תצוגת ההכנסות" }).getByRole("link", {
          name: "ממתינות לקבלה",
        }),
      ).toHaveAttribute("aria-current", "page");
      const row = page
        .getByRole("list", { name: "הכנסות שממתינות לקבלה" })
        .getByRole("link")
        .filter({ hasText: clientName });
      await expect(row).toContainText("ממתינה לקבלה");
      await row.click();
      await expect(page).toHaveURL(new RegExp(`/incomes/${incomeId}/receipt$`));
      await expect(field.fileSource(page)).toBeEnabled();
      await field.number(page).fill(receiptNumber(seeds.token));
      await field.linkSource(page).check();
      await field.url(page).fill("https://app.sumit.co.il/doc/9");
      await page.getByRole("button", { name: "שמירת הקבלה" }).click();
      await expect(page.getByRole("status").filter({ hasText: RECORDED_NOTICE })).toBeVisible();

      await page.getByRole("link", { name: "לכל ההכנסות שממתינות לקבלה" }).click();
      await expect(page.getByRole("heading", { level: 1, name: "הכנסות" })).toBeVisible();
      await expect(page.getByText(clientName)).toHaveCount(0);
    },
  );

  test_(
    "DOC-4: past the monthly quota the counter warns, and recording a receipt still works",
    async (
      { page, seedReceipt, token, seedClient, seedProject, seedMilestone, seedIncome },
      testInfo,
    ) => {
      const seeds = { token, seedClient, seedProject, seedMilestone, seedIncome };
      // The counter is global; one browser project is enough and keeps the seeding small.
      test_.skip(testInfo.project.name !== "desktop", "The quota is checked on desktop only");
      const clientId = await seeds.seedClient({ name: `מכסה ${seeds.token}` });
      // Eleven receipts this month put the count above the quota of 10, whatever else exists.
      for (let index = 0; index < 11; index += 1) {
        const income = await seeds.seedIncome({
          client_id: clientId,
          received_date: todayInJerusalem(),
          amount: 100,
        });
        await seedReceipt({
          income_id: income,
          doc_number: receiptNumber(seeds.token, `Q${index}`),
          issued_date: todayInJerusalem(),
        });
      }
      const pending = await seeds.seedIncome({
        client_id: clientId,
        received_date: todayInJerusalem(),
        amount: 100,
      });

      await page.goto("/");
      const card = page.getByRole("region", { name: "קבלות ממתינות" });
      await expect(
        card.getByText(/^קבלות שהופקו החודש: (1[1-9]|[2-9]\d|\d{3,}) מתוך 10$/),
      ).toBeVisible();
      await expect(card.getByText(/^שימו לב:.*מעבר למכסה החודשית/)).toBeVisible();

      await gotoReceipt(page, pending);
      await expect(page.getByText(/^שימו לב:.*מעבר למכסה החודשית/)).toBeVisible();
      await field.number(page).fill(receiptNumber(seeds.token, "P"));
      await field.linkSource(page).check();
      await field.url(page).fill("https://app.sumit.co.il/doc/p");
      await page.getByRole("button", { name: "שמירת הקבלה" }).click();
      await expect(page.getByRole("status").filter({ hasText: RECORDED_NOTICE })).toBeVisible();
    },
  );

  test_(
    "INC-3: the incomes list and the project card show each income's receipt status",
    async ({ page, seedReceipt, token, seedClient, seedProject, seedMilestone, seedIncome }) => {
      const seeds = { token, seedClient, seedProject, seedMilestone, seedIncome };
      const { projectId, clientId, incomeId } = await seedPayment(seeds, "1905-05-05");
      await seeds.seedIncome({
        client_id: clientId,
        project_id: projectId,
        received_date: "1905-05-06",
        amount: 700,
      });
      await seedReceipt({
        income_id: incomeId,
        doc_number: receiptNumber(seeds.token),
        issued_date: todayInJerusalem(),
      });

      await page.goto(`/projects/${projectId}`);
      await expect(
        page.getByRole("list", { name: `תשלומים: מקדמה ${seeds.token}` }).getByText("הופקה קבלה"),
      ).toBeVisible();
      await expect(
        page.getByRole("region", { name: "הכנסות ללא אבן דרך" }).getByText("ממתינה לקבלה"),
      ).toBeVisible();

      await page.goto("/incomes");
      await expect(page.getByLabel("חודש")).toBeEnabled();
      await page.getByLabel("חודש").fill("1905-05");
      const rows = page.getByRole("list", { name: "רשימת ההכנסות" }).getByRole("link");
      await expect(rows.filter({ hasText: shekels(1_250_050) })).toContainText("הופקה קבלה");
      await expect(rows.filter({ hasText: shekels(700) })).toContainText("ממתינה לקבלה");
    },
  );
});

test_.describe("M2.2-11: failed requests and ended sessions", () => {
  test_(
    "DOC-2: recording while offline shows the inline error, keeps the input and records nothing",
    async ({ page, context, token, seedClient, seedProject, seedMilestone, seedIncome }) => {
      const seeds = { token, seedClient, seedProject, seedMilestone, seedIncome };
      const { incomeId } = await seedPayment(seeds);
      await gotoReceipt(page, incomeId);
      await field.number(page).fill(receiptNumber(seeds.token));
      await field
        .file(page)
        .setInputFiles({ name: "r.pdf", mimeType: "application/pdf", buffer: pdf() });
      await context.setOffline(true);

      await page.getByRole("button", { name: "שמירת הקבלה" }).click();

      await expect(page.getByRole("alert").first()).toHaveText(SAVE_UNAVAILABLE);
      await expect(page).toHaveURL(new RegExp(`/incomes/${incomeId}/receipt$`));
      await expect(field.number(page)).toHaveValue(receiptNumber(seeds.token));
      await context.setOffline(false);
      expect(await documentOf(incomeId)).toBeNull();
    },
  );

  for (const mode of ["abort", "500"] as const) {
    test_(
      `DOC-2: a failed save (${mode}) shows an inline error and keeps the input`,
      async ({ page, token, seedClient, seedProject, seedMilestone, seedIncome }) => {
        const seeds = { token, seedClient, seedProject, seedMilestone, seedIncome };
        const { incomeId } = await seedPayment(seeds);
        await gotoReceipt(page, incomeId);
        await field.number(page).fill(receiptNumber(seeds.token));
        await field.linkSource(page).check();
        await field.url(page).fill("https://app.sumit.co.il/doc/1");
        const restore = await failServerActions(page, mode);

        await page.getByRole("button", { name: "שמירת הקבלה" }).click();

        await expect(page.getByRole("alert").first()).toHaveText(SAVE_UNAVAILABLE);
        await expect(field.url(page)).toHaveValue("https://app.sumit.co.il/doc/1");
        expect(await documentOf(incomeId)).toBeNull();
        await restore();
        await page.getByRole("button", { name: "שמירת הקבלה" }).click();
        await expect(page.getByRole("status").filter({ hasText: RECORDED_NOTICE })).toBeVisible();
      },
    );
  }

  test_(
    "DOC-2: a failed upload to storage shows an inline error and records nothing",
    async ({ page, token, seedClient, seedProject, seedMilestone, seedIncome }) => {
      const seeds = { token, seedClient, seedProject, seedMilestone, seedIncome };
      const { incomeId } = await seedPayment(seeds);
      await page.route("**/storage/v1/object/upload/sign/**", (route) =>
        route.abort("internetdisconnected"),
      );
      await gotoReceipt(page, incomeId);
      await field.number(page).fill(receiptNumber(seeds.token));
      await field
        .file(page)
        .setInputFiles({ name: "r.pdf", mimeType: "application/pdf", buffer: pdf() });

      await page.getByRole("button", { name: "שמירת הקבלה" }).click();

      await expect(page.getByRole("alert").first()).toHaveText(
        "העלאת הקובץ נכשלה. בדקו את החיבור ונסו שוב.",
      );
      expect(await documentOf(incomeId)).toBeNull();
    },
  );

  test_(
    "AUTH-3: recording a receipt after the session ended opens /login",
    async ({ page, context, token, seedClient, seedProject, seedMilestone, seedIncome }) => {
      const seeds = { token, seedClient, seedProject, seedMilestone, seedIncome };
      const { incomeId } = await seedPayment(seeds);
      await gotoReceipt(page, incomeId);
      await field.number(page).fill(receiptNumber(seeds.token));
      await field
        .file(page)
        .setInputFiles({ name: "r.pdf", mimeType: "application/pdf", buffer: pdf() });
      await context.clearCookies();

      await page.getByRole("button", { name: "שמירת הקבלה" }).click();

      await expect(page).toHaveURL(/\/login$/);
      expect(await documentOf(incomeId)).toBeNull();
    },
  );

  test_(
    "DOC-2: the file link of an income without a stored file answers 404, and needs a session",
    async ({
      page,
      context,
      seedReceipt,
      token,
      seedClient,
      seedProject,
      seedMilestone,
      seedIncome,
    }) => {
      const seeds = { token, seedClient, seedProject, seedMilestone, seedIncome };
      const { incomeId } = await seedPayment(seeds);
      const pending = await page.request.get(`/incomes/${incomeId}/receipt/file`, {
        maxRedirects: 0,
      });
      await seedReceipt({
        income_id: incomeId,
        doc_number: receiptNumber(seeds.token),
        issued_date: todayInJerusalem(),
      });
      const linkOnly = await page.request.get(`/incomes/${incomeId}/receipt/file`, {
        maxRedirects: 0,
      });
      await context.clearCookies();
      const signedOut = await page.request.get(`/incomes/${incomeId}/receipt/file`, {
        maxRedirects: 0,
      });

      expect(pending.status()).toBe(404);
      expect(linkOnly.status()).toBe(404);
      expect(signedOut.status()).toBe(307);
      expect(signedOut.headers()["location"]).toMatch(/\/login$/);
    },
  );
});

test_.describe("M2.2-13: layout and CSP", () => {
  test_(
    "DOC-1 / DOC-5: no horizontal scroll and no CSP violations on the receipt screens",
    async (
      { page, seedReceipt, token, seedClient, seedProject, seedMilestone, seedIncome },
      testInfo,
    ) => {
      const seeds = { token, seedClient, seedProject, seedMilestone, seedIncome };
      const violations = await trackCspViolations(page);
      const clientId = await seeds.seedClient({
        name: `לקוח ארוך ${"ארוך".repeat(20)} ${seeds.token}`,
      });
      const projectId = await seeds.seedProject({
        client_id: clientId,
        name: `פרויקט ארוך ${"ארוך".repeat(20)} ${seeds.token}`,
      });
      const pending = await seeds.seedIncome({
        client_id: clientId,
        project_id: projectId,
        received_date: todayInJerusalem(),
        amount: 9_999_999_999,
      });
      const issued = await seeds.seedIncome({
        client_id: clientId,
        received_date: todayInJerusalem(),
        amount: 9_999_999_999,
        notes: "הערה ארוכה ".repeat(100).trim(),
      });
      await seedReceipt({
        income_id: issued,
        doc_number: `${receiptNumber(seeds.token)}${"9".repeat(15)}`.slice(0, 30),
        issued_date: todayInJerusalem(),
        url: `https://app.sumit.co.il/${"a".repeat(300)}`,
      });

      for (const width of VIEWPORT_WIDTHS_BY_PROJECT[testInfo.project.name]) {
        for (const path of [
          "/",
          "/incomes?view=pending",
          `/incomes/${pending}/receipt`,
          `/incomes/${issued}/receipt`,
          `/incomes/${issued}/edit`,
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
      await gotoReceipt(page, pending);
      await page.getByRole("button", { name: "שמירת הקבלה" }).click();
      await expect(field.number(page)).toHaveAttribute("aria-invalid", "true");
      expect(violations).toEqual([]);
    },
  );
});
