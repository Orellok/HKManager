import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import type { Download, Page, TestInfo } from "@playwright/test";

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
 * M4.2: CSV export (EXPORT-1..4). Exports cover whole date ranges, so every test uses years
 * no other test writes to: the Android project 1940–1949, the desktop project 1980–1989,
 * one year per test (by offset).
 */

const YEAR_BASE_BY_PROJECT: Record<string, number> = { android: 1940, desktop: 1980 };

function testYear(testInfo: TestInfo, offset: number): number {
  const base = YEAR_BASE_BY_PROJECT[testInfo.project.name];
  if (base === undefined) {
    throw new Error(`No export years for project ${testInfo.project.name}`);
  }
  return base + offset;
}

const BOM = [0xef, 0xbb, 0xbf];
const INCOME_HEADER = [
  "תאריך",
  "לקוח",
  "פרויקט",
  "אבן דרך",
  "סכום",
  "אמצעי תשלום",
  "מספר קבלה",
  "תאריך קבלה",
];
const EXPENSE_HEADER = ["תאריך", "ספק", "קטגוריה", "סכום", "אמצעי תשלום", "קיים מסמך"];
const EXPENSE_FILES_BUCKET = "expense-files";
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

/**
 * Removes many expenses of a category with their audit rows, in pages and chunks: the data
 * fixture's cleanup reads at most one PostgREST page and sends every id in one address.
 */
async function removeExpensesOfCategory(categoryId: string): Promise<void> {
  const service = createServiceRoleClient();
  for (;;) {
    const { data, error } = await service
      .from("expenses")
      .select("id")
      .eq("category_id", categoryId)
      .limit(100);
    if (error) {
      throw new Error("Could not list the volume test's expenses", { cause: error });
    }
    if (data.length === 0) {
      return;
    }
    const ids = data.map((row) => row.id as string);
    const audit = await service.from("audit_log").delete().in("entity_id", ids);
    const removed = await service.from("expenses").delete().in("id", ids);
    const failure = audit.error ?? removed.error;
    if (failure) {
      throw new Error("Could not remove the volume test's expenses", { cause: failure });
    }
  }
}

/**
 * Parses RFC 4180 CSV strictly: records end in CRLF, quoted fields may hold commas, quotes
 * (doubled) and line breaks. Throws on a bare LF or CR outside quotes.
 */
function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"' && field === "") {
      quoted = true;
    } else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\r" && text[index + 1] === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
      index += 1;
    } else if (char === "\r" || char === "\n") {
      throw new Error(`A bare line break outside quotes at ${index}`);
    } else {
      field += char;
    }
  }
  if (field !== "" || record.length > 0) {
    throw new Error("The file does not end with CRLF");
  }
  return records;
}

type ExportFile = { name: string; bytes: Buffer; records: string[][] };

async function readExport(download: Download): Promise<ExportFile> {
  const bytes = await readFile(await download.path());
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  expect(text.startsWith("﻿")).toBe(true);
  return { name: download.suggestedFilename(), bytes, records: parseCsv(text.slice(1)) };
}

const field = {
  from: (page: Page) => page.getByLabel("מתאריך"),
  to: (page: Page) => page.getByLabel("עד תאריך (כולל)"),
  incomes: (page: Page) => page.getByRole("button", { name: "הורדת קובץ הכנסות" }),
  expenses: (page: Page) => page.getByRole("button", { name: "הורדת קובץ הוצאות" }),
};

async function setRange(page: Page, from: string, to: string) {
  await field.from(page).fill(from);
  await field.to(page).fill(to);
}

async function download(page: Page, button: "incomes" | "expenses"): Promise<ExportFile> {
  const [file] = await Promise.all([page.waitForEvent("download"), field[button](page).click()]);
  return readExport(file);
}

/** Waits until the form is hydrated, so the browser-side checks run on submit. */
async function gotoExport(page: Page) {
  await page.goto("/export");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("ייצוא");
  await page.waitForLoadState("networkidle");
}

test_.describe("EXPORT-1..3: CSV files", () => {
  test_.beforeEach(async ({ signIn }) => {
    await signIn({ role: "owner" });
  });

  test_(
    "EXPORT-1 / EXPORT-2 / EXPORT-3: the incomes file of a range: BOM, columns, exact rows, quoting, injection, no soft-deleted rows",
    async (
      { page, token, seedClient, seedProject, seedMilestone, seedIncome, seedReceipt },
      testInfo,
    ) => {
      const year = testYear(testInfo, 0);
      const violations = await trackCspViolations(page);
      const client = `כהן, "משה" ${token}`;
      const clientId = await seedClient({ name: client });
      const project = `=שיפוץ ${token}`;
      const projectId = await seedProject({ client_id: clientId, name: project });
      const milestoneId = await seedMilestone({
        project_id: projectId,
        description: "מקדמה\nשלב א",
        amount: 100_000,
        due_date: `${year}-01-01`,
      });
      const withReceipt = await seedIncome({
        client_id: clientId,
        project_id: projectId,
        milestone_id: milestoneId,
        received_date: `${year}-01-01`,
        amount: 1,
        payment_method: "bank_transfer",
      });
      await seedReceipt({
        income_id: withReceipt,
        doc_number: "R-17/2",
        issued_date: `${year}-01-02`,
      });
      await seedIncome({
        client_id: clientId,
        received_date: `${year}-12-31`,
        amount: 9_999_999_999,
        payment_method: "check",
      });
      await seedIncome({ client_id: clientId, received_date: `${year - 1}-12-31`, amount: 5 });
      await seedIncome({ client_id: clientId, received_date: `${year + 1}-01-01`, amount: 6 });
      const deleted = await seedIncome({
        client_id: clientId,
        received_date: `${year}-06-06`,
        amount: 777,
      });
      await createServiceRoleClient()
        .from("incomes")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", deleted);

      await page.goto("/");
      await clickNavItem(page, "ייצוא");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("ייצוא");
      await expectNavCurrent(page, "ייצוא");
      await page.waitForLoadState("networkidle");
      await setRange(page, `${year}-01-01`, `${year}-12-31`);
      const file = await download(page, "incomes");

      expect(file.name).toBe(`hkmanager-incomes-${year}-01-01_${year}-12-31.csv`);
      expect([...file.bytes.subarray(0, 3)]).toEqual(BOM);
      expect(file.records).toEqual([
        INCOME_HEADER,
        [
          `01/01/${year}`,
          client,
          `'${project}`,
          "מקדמה\nשלב א",
          "0.01",
          "העברה בנקאית",
          "R-17/2",
          `02/01/${year}`,
        ],
        [`31/12/${year}`, client, "", "", "99999999.99", "צ'ק", "", ""],
      ]);
      // The raw bytes: quotes doubled, CRLF line ends, the apostrophe before "=".
      const raw = file.bytes.toString("utf8");
      expect(raw).toContain(`"כהן, ""משה"" ${token}"`);
      expect(raw).toContain(`,'=שיפוץ ${token},`);
      // Header and two records end in CRLF; the line break inside the quoted field stays LF.
      expect(raw.split("\r\n")).toHaveLength(3 + 1);
      // The screen stays as it was.
      await expect(page).toHaveURL(/\/export$/);
      expect(violations).toEqual([]);
    },
  );

  test_(
    "EXPORT-1 / EXPORT-3: the expenses file: document כן/לא, 0-decimal amounts, oldest first, no soft-deleted rows",
    async ({ page, token, seedCategory, seedExpense }, testInfo) => {
      const year = testYear(testInfo, 1);
      const category = `חומרים ${token}`;
      const categoryId = await seedCategory(category);
      const service = createServiceRoleClient();
      const path = `${randomUUID()}.jpg`;
      const upload = await service.storage
        .from(EXPENSE_FILES_BUCKET)
        .upload(path, JPEG_BYTES, { contentType: "image/jpeg" });
      expect(upload.error).toBeNull();
      const withFile = await seedExpense({
        expense_date: `${year}-03-03`,
        amount: 123_456,
        vendor: `ספק, "הבית" ${token}`,
        category_id: categoryId,
        payment_method: "cash",
      });
      const attached = await service
        .from("expenses")
        .update({ file_path: path })
        .eq("id", withFile);
      expect(attached.error).toBeNull();
      await seedExpense({
        expense_date: `${year}-01-01`,
        amount: 100,
        vendor: `@ספק ${token}`,
        category_id: categoryId,
      });
      await seedExpense({
        expense_date: `${year + 1}-01-01`,
        amount: 1,
        vendor: `אחר ${token}`,
        category_id: categoryId,
      });
      const deleted = await seedExpense({
        expense_date: `${year}-05-05`,
        amount: 2,
        vendor: `נמחק ${token}`,
        category_id: categoryId,
      });
      await service
        .from("expenses")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", deleted);

      // Also reachable from the expenses list.
      await page.goto("/expenses");
      await page.getByRole("link", { name: "ייצוא ל-CSV" }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("ייצוא");
      await page.waitForLoadState("networkidle");
      await setRange(page, `${year}-01-01`, `${year}-12-31`);
      const file = await download(page, "expenses");

      expect(file.name).toBe(`hkmanager-expenses-${year}-01-01_${year}-12-31.csv`);
      expect([...file.bytes.subarray(0, 3)]).toEqual(BOM);
      expect(file.records).toEqual([
        EXPENSE_HEADER,
        [`01/01/${year}`, `'@ספק ${token}`, category, "1.00", "אשראי", "לא"],
        [`03/03/${year}`, `ספק, "הבית" ${token}`, category, "1234.56", "מזומן", "כן"],
      ]);
    },
  );

  test_(
    "EXPORT-1: an empty range gives a file with the header only; the incomes list links to the export",
    async ({ page }, testInfo) => {
      const year = testYear(testInfo, 2);
      await page.goto("/incomes");
      await page.getByRole("link", { name: "ייצוא ל-CSV" }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("ייצוא");
      await page.waitForLoadState("networkidle");
      await setRange(page, `${year}-02-01`, `${year}-02-28`);
      expect((await download(page, "incomes")).records).toEqual([INCOME_HEADER]);
      expect((await download(page, "expenses")).records).toEqual([EXPENSE_HEADER]);
    },
  );

  test_(
    "criterion 5: a file longer than one page is complete and in date order",
    async ({ page, token, seedCategory }, testInfo) => {
      test_.skip(testInfo.project.name !== "desktop", "One run is enough for the volume check");
      const year = testYear(testInfo, 3);
      const categoryId = await seedCategory(`נפח ${token}`);
      const rows = 2_345;
      const service = createServiceRoleClient();
      try {
        const { error } = await service.from("expenses").insert(
          Array.from({ length: rows }, (_, index) => ({
            expense_date: `${year}-${String((index % 12) + 1).padStart(2, "0")}-15`,
            amount: index + 1,
            vendor: `נפח ${token}`,
            category_id: categoryId,
            payment_method: "cash",
          })),
        );
        expect(error).toBeNull();
        await gotoExport(page);
        await setRange(page, `${year}-01-01`, `${year}-12-31`);
        const file = await download(page, "expenses");
        const records = file.records.slice(1);
        expect(records).toHaveLength(rows);
        const amounts = new Set(records.map((record) => record[3]));
        expect(amounts.size).toBe(rows);
        const isoDates = records.map((record) => record[0].split("/").reverse().join("-"));
        expect(isoDates).toEqual([...isoDates].sort());
      } finally {
        await removeExpensesOfCategory(categoryId);
      }
    },
  );
});

test_.describe("criterion 4 / 5: validation and security", () => {
  test_.beforeEach(async ({ signIn }) => {
    await signIn({ role: "owner" });
  });

  test_(
    "criterion 5: an invalid range shows an inline error next to the field, focuses it and downloads nothing",
    async ({ page }) => {
      let downloads = 0;
      page.on("download", () => {
        downloads += 1;
      });
      const consoleMessages: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "warning" || message.type() === "error") {
          consoleMessages.push(message.text());
        }
      });
      await gotoExport(page);
      // Defaults: 1 January of this year to today.
      const today = await field.to(page).inputValue();
      expect(await field.from(page).inputValue()).toBe(`${today.slice(0, 4)}-01-01`);

      await setRange(page, "2026-02-01", "2026-01-31");
      await field.incomes(page).click();
      await expect(field.to(page)).toHaveAccessibleDescription(
        "תאריך הסיום לא יכול להיות לפני תאריך ההתחלה.",
      );
      await expect(field.to(page)).toHaveAttribute("aria-invalid", "true");
      await expect(field.to(page)).toBeFocused();

      await setRange(page, "2020-01-01", "2025-01-01");
      await field.expenses(page).click();
      await expect(field.to(page)).toHaveAccessibleDescription(
        "אפשר לייצא עד 5 שנים בכל קובץ. לתאריך ההתחלה הזה, תאריך הסיום יכול להיות עד 31/12/2024.",
      );

      await setRange(page, "", "2025-01-01");
      await field.incomes(page).click();
      await expect(field.from(page)).toHaveAccessibleDescription("יש לבחור תאריך התחלה.");
      await expect(field.from(page)).toBeFocused();
      await expect(field.to(page)).not.toHaveAttribute("aria-invalid", /.*/);

      await setRange(page, "1899-12-31", "1900-01-02");
      await field.incomes(page).click();
      await expect(field.from(page)).toHaveAccessibleDescription(
        "יש להזין תאריך בין 01/01/1900 ל-31/12/2100.",
      );
      expect(downloads).toBe(0);
      await expect(page).toHaveURL(/\/export$/);
      expect(consoleMessages).toEqual([]);
    },
  );

  test_(
    "criterion 5: a hand-made address with a bad range returns to the screen with the error, not a broken download",
    async ({ page }) => {
      await page.goto("/export/expenses?from=2026-03-01&to=2026-02-01");
      await expect(page).toHaveURL(/\/export\?from=2026-03-01&to=2026-02-01$/);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("ייצוא");
      await expect(field.from(page)).toHaveValue("2026-03-01");
      await expect(field.to(page)).toHaveAccessibleDescription(
        "תאריך הסיום לא יכול להיות לפני תאריך ההתחלה.",
      );
      await expect(field.to(page)).toBeFocused();

      await page.goto("/export/incomes?from=junk&to=");
      await expect(field.from(page)).toHaveAccessibleDescription("יש להזין תאריך תקין.");
      await expect(field.to(page)).toHaveAccessibleDescription("יש לבחור תאריך סיום.");

      await page.goto("/export/incomes");
      await expect(field.from(page)).toHaveAccessibleDescription("יש לבחור תאריך התחלה.");

      // The Route Handler's address after a failure before the first byte.
      await page.goto("/export?from=2026-01-01&to=2026-12-31&error=failed");
      // Scoped to the form: Next.js keeps its own (empty) route announcer with role "alert".
      await expect(page.getByRole("form", { name: "טווח הייצוא" }).getByRole("alert")).toHaveText(
        "הייצוא נכשל ולא נוצר קובץ. אפשר לנסות שוב.",
      );
      await expect(field.from(page)).toHaveValue("2026-01-01");
    },
  );

  test_(
    "criterion 4: the file response: attachment with an ASCII name, CSV type, never cached",
    async ({ page }, testInfo) => {
      const year = testYear(testInfo, 4);
      await page.goto("/export");
      const response = await page.request.get(
        `/export/incomes?from=${year}-01-01&to=${year}-12-31`,
        { maxRedirects: 0 },
      );
      expect(response.status()).toBe(200);
      const headers = response.headers();
      expect(headers["content-type"]).toBe("text/csv; charset=utf-8");
      expect(headers["content-disposition"]).toBe(
        `attachment; filename="hkmanager-incomes-${year}-01-01_${year}-12-31.csv"`,
      );
      expect(headers["cache-control"]).toContain("no-store");
      expect(headers["x-content-type-options"]).toBe("nosniff");
      expect([...(await response.body()).subarray(0, 3)]).toEqual(BOM);
    },
  );

  test_(
    "EXPORT-1: the screen fits every viewport with 44px targets and labelled fields",
    async ({ page }, testInfo) => {
      await gotoExport(page);
      for (const width of VIEWPORT_WIDTHS_BY_PROJECT[testInfo.project.name]) {
        await page.setViewportSize({ width, height: 800 });
        expect(await hasHorizontalScroll(page)).toBe(false);
        for (const control of [
          field.from(page),
          field.to(page),
          field.incomes(page),
          field.expenses(page),
        ]) {
          expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
        }
      }
      // EXPORT-4: no receipt files.
      await expect(page.getByRole("button", { name: /קבל/ })).toHaveCount(0);
    },
  );
});

test_.describe("criterion 4: access", () => {
  for (const kind of ["incomes", "expenses"]) {
    test_(
      `criterion 4 / AUTH-3: without a session /export/${kind} redirects to /login`,
      async ({ page }) => {
        const response = await page.request.get(`/export/${kind}?from=2026-01-01&to=2026-12-31`, {
          maxRedirects: 0,
        });
        expect([302, 303, 307, 308]).toContain(response.status());
        expect(new URL(response.headers()["location"], "http://x").pathname).toBe("/login");
        expect(response.headers()["content-disposition"]).toBeUndefined();
      },
    );
  }

  test_(
    "criterion 4 / AUTH-2: an account outside the allowlist gets no file",
    async ({ page, signIn }) => {
      await signIn({ role: null });
      const response = await page.request.get("/export/incomes?from=2026-01-01&to=2026-12-31", {
        maxRedirects: 0,
      });
      expect([302, 303, 307, 308]).toContain(response.status());
      expect(new URL(response.headers()["location"], "http://x").pathname).toBe("/unauthorized");
      expect(response.headers()["content-disposition"]).toBeUndefined();
    },
  );
});
