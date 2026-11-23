import type { Page } from "@playwright/test";

import { todayInJerusalem } from "../../src/lib/dates";

import { createServiceRoleClient, expect, test_ } from "./support/data-fixtures";
import {
  MIN_TOUCH_TARGET,
  VIEWPORT_WIDTHS_BY_PROJECT,
  clickNavItem,
  clickThreeTimesSynchronously,
  expectNavCurrent,
  failServerActions,
  hasHorizontalScroll,
  trackCspViolations,
} from "./support/helpers";

test_.beforeEach(async ({ signIn }) => {
  await signIn({ role: "owner" });
});

const SAVE_UNAVAILABLE = "לא ניתן לשמור כרגע. בדקו את החיבור ונסו שוב.";
const KEEP_ORIGINAL = "יש לשמור את הקבלה המקורית.";
const SAVED_WITH_FILE = `ההוצאה נשמרה. ${KEEP_ORIGINAL}`;
const SAVED_WITHOUT_FILE = 'ההוצאה נשמרה ומסומנת "חסר מסמך". אפשר לצרף את הקבלה בעריכת ההוצאה.';
const MISSING = "חסר מסמך";
const PRINTING = "הדפסות";
const MAX_BYTES = 10 * 1024 * 1024;

/** Formats agorot as the app does, e.g. 1250050 → "‏12,500.50 ‏₪". */
function shekels(agorot: number): string {
  return new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS" }).format(
    (agorot / 100).toFixed(2) as `${number}`,
  );
}

function pdf(size = 0): Buffer {
  const body = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");
  return size > body.length ? Buffer.concat([body, Buffer.alloc(size - body.length, 0x20)]) : body;
}

const field = {
  date: (page: Page) => page.getByLabel(/^תאריך ההוצאה/),
  amount: (page: Page) => page.getByRole("textbox", { name: /^סכום/ }),
  vendor: (page: Page) => page.getByRole("textbox", { name: /^ספק/ }),
  category: (page: Page) => page.getByRole("combobox", { name: /^קטגוריה/ }),
  payment: (page: Page) => page.getByRole("combobox", { name: /^אמצעי תשלום/ }),
  notes: (page: Page) => page.getByRole("textbox", { name: /^הערות/ }),
  photo: (page: Page) => page.getByLabel("צילום הקבלה במצלמה"),
  file: (page: Page) => page.getByLabel("או בחירת קובץ מהמכשיר"),
};

/** Opens the new expense form and waits until it is interactive (the file inputs). */
async function gotoNewExpense(page: Page) {
  await page.goto("/expenses/new");
  await expect(field.file(page)).toBeEnabled();
}

async function fillExpense(
  page: Page,
  {
    vendor,
    amount = "350.90",
    category = PRINTING,
  }: { vendor: string; amount?: string; category?: string },
) {
  await field.amount(page).fill(amount);
  await field.vendor(page).fill(vendor);
  await field.category(page).selectOption({ label: category });
  await field.payment(page).selectOption({ label: "אשראי" });
}

type ExpenseRow = {
  id: string;
  amount: number;
  file_path: string | null;
  deleted_at: string | null;
  category_id: string;
};

async function expensesOf(vendor: string): Promise<ExpenseRow[]> {
  const { data, error } = await createServiceRoleClient()
    .from("expenses")
    .select("id, amount, file_path, deleted_at, category_id")
    .eq("vendor", vendor);
  expect(error).toBeNull();
  return (data ?? []) as ExpenseRow[];
}

async function storedFile(path: string): Promise<Buffer> {
  const { data, error } = await createServiceRoleClient()
    .storage.from("expense-files")
    .download(path);
  expect(error).toBeNull();
  return Buffer.from(await data!.arrayBuffer());
}

async function categoryId(name: string): Promise<string> {
  const { data } = await createServiceRoleClient()
    .from("expense_categories")
    .select("id")
    .eq("name", name)
    .single();
  return (data as { id: string }).id;
}

/** An image drawn in the browser (noise, so it does not compress to nothing), as a file. */
async function drawImage(
  page: Page,
  width: number,
  height: number,
  type: "image/png" | "image/jpeg",
): Promise<Buffer> {
  const base64 = await page.evaluate(
    ({ width, height, type }) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d")!;
      const pixels = context.createImageData(width, height);
      for (let index = 0; index < pixels.data.length; index += 4) {
        pixels.data[index] = Math.random() * 256;
        pixels.data[index + 1] = Math.random() * 256;
        pixels.data[index + 2] = Math.random() * 256;
        pixels.data[index + 3] = 255;
      }
      context.putImageData(pixels, 0, 0);
      return canvas.toDataURL(type).split(",")[1];
    },
    { width, height, type },
  );
  return Buffer.from(base64, "base64");
}

/** The JPEG with an EXIF APP1 segment saying "rotate 90° clockwise to show" (orientation 6). */
function withExifOrientation6(jpeg: Buffer): Buffer {
  const tiff = Buffer.from([
    0x4d,
    0x4d,
    0x00,
    0x2a,
    0x00,
    0x00,
    0x00,
    0x08, // big-endian TIFF header, IFD at 8
    0x00,
    0x01, // one entry
    0x01,
    0x12,
    0x00,
    0x03,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    0x06,
    0x00,
    0x00, // Orientation = 6
    0x00,
    0x00,
    0x00,
    0x00, // no next IFD
  ]);
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "binary"), tiff]);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(payload.length + 2);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), length, payload]);
  return Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
}

/** Width and height from a JPEG's SOF segment. */
function jpegSize(jpeg: Buffer): { width: number; height: number } {
  let offset = 2;
  while (offset < jpeg.length) {
    if (jpeg[offset] !== 0xff) {
      throw new Error("Not a JPEG marker");
    }
    const marker = jpeg[offset + 1];
    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) {
      return { height: jpeg.readUInt16BE(offset + 5), width: jpeg.readUInt16BE(offset + 7) };
    }
    offset += 2 + jpeg.readUInt16BE(offset + 2);
  }
  throw new Error("No SOF segment");
}

function isJpeg(bytes: Buffer): boolean {
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function listRow(page: Page, text: string) {
  return page
    .getByRole("list", { name: "רשימת ההוצאות" })
    .getByRole("listitem")
    .filter({ hasText: text });
}

function notice(page: Page, text: string) {
  return page.getByRole("status").filter({ hasText: text });
}

test_.describe("EXP-1 / EXP-6: recording an expense", () => {
  test_(
    "EXP-1 / EXP-6 / M3-9: records an expense without a file from the navigation; it is marked חסר מסמך",
    async ({ page, token }) => {
      const vendor = `אופיס דיפו ${token}`;
      await page.goto("/");
      await clickNavItem(page, "הוצאות");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("הוצאות");
      await expectNavCurrent(page, "הוצאות");

      await page.getByRole("link", { name: "הוצאה חדשה" }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("הוצאה חדשה");
      await expect(field.file(page)).toBeEnabled();
      await expect(field.date(page)).toHaveValue(todayInJerusalem());
      await fillExpense(page, { vendor, amount: "1,250.90" });
      await field.notes(page).fill("טונר למדפסת");
      await page.getByRole("button", { name: "שמירת הוצאה" }).click();

      await expect(page).toHaveURL(/\/expenses$/);
      await expect(notice(page, SAVED_WITHOUT_FILE)).toBeVisible();
      const row = listRow(page, vendor);
      await expect(row).toContainText(PRINTING);
      await expect(row).toContainText(shekels(125_090));
      await expect(row).toContainText("אשראי");
      await expect(row.getByText(MISSING, { exact: true })).toBeVisible();
      const [saved] = await expensesOf(vendor);
      expect(saved).toMatchObject({ amount: 125_090, file_path: null, deleted_at: null });
    },
  );

  test_(
    "EXP-1: invalid input shows errors beside the fields, keeps the input and focuses the first error; Enter submits once",
    async ({ page, token }) => {
      const vendor = `ספק ${token}`;
      await gotoNewExpense(page);
      await field.amount(page).fill("0");
      await field.vendor(page).fill(vendor);
      await field.date(page).fill("2099-01-01");

      await field.vendor(page).press("Enter");

      await expect(page.getByRole("alert").first()).toHaveText(
        "לא ניתן לשמור. יש לתקן את השדות המסומנים.",
      );
      await expect(field.date(page)).toBeFocused();
      await expect(page.getByText("תאריך ההוצאה לא יכול להיות בעתיד.")).toBeVisible();
      await expect(page.getByText("הסכום חייב להיות גדול מ-0.")).toBeVisible();
      await expect(page.getByText("יש לבחור קטגוריה.")).toBeVisible();
      await expect(field.amount(page)).toHaveAttribute("aria-invalid", "true");
      await expect(field.vendor(page)).toHaveValue(vendor);
      await expect(page).toHaveURL(/\/expenses\/new$/);
      expect(await expensesOf(vendor)).toEqual([]);
    },
  );

  test_(
    "M3-11: a triple click on save records one expense (ref-based in-flight guard)",
    async ({ page, token }) => {
      const vendor = `כפול ${token}`;
      await gotoNewExpense(page);
      await fillExpense(page, { vendor });

      await clickThreeTimesSynchronously(page, "שמירת הוצאה");

      await expect(notice(page, SAVED_WITHOUT_FILE)).toBeVisible();
      expect(await expensesOf(vendor)).toHaveLength(1);
    },
  );
});

test_.describe("EXP-2 / EXP-7: receipt photos and files", () => {
  test_(
    "EXP-2 / EXP-7: records an expense with a PDF; the keep-the-original message stays; the file opens through a short-lived link",
    async ({ page, token }) => {
      const vendor = `דפוס ${token}`;
      await gotoNewExpense(page);
      await fillExpense(page, { vendor });
      await field.file(page).setInputFiles({
        name: "receipt.pdf",
        mimeType: "application/pdf",
        buffer: pdf(),
      });
      await expect(page.getByRole("status").filter({ hasText: "נבחר: receipt.pdf" })).toBeVisible();

      await page.getByRole("button", { name: "שמירת הוצאה" }).click();

      await expect(notice(page, SAVED_WITH_FILE)).toBeVisible();
      await expect(page).toHaveURL(/\/expenses$/);
      // EXP-7: persistent – still shown after the user's next actions on the screen.
      await page.getByRole("button", { name: "חיפוש" }).click();
      await page.getByRole("checkbox", { name: "רק הוצאות שחסר להן מסמך" }).click();
      await expect(notice(page, SAVED_WITH_FILE)).toBeVisible();
      // ...but shown once: a reload no longer has it.
      await page.reload();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("הוצאות");
      await expect(notice(page, KEEP_ORIGINAL)).toHaveCount(0);

      const [saved] = await expensesOf(vendor);
      expect(saved.file_path).toMatch(/^[0-9a-f-]{36}\.pdf$/);
      expect(await storedFile(saved.file_path!)).toEqual(pdf());
      await expect(listRow(page, vendor)).toHaveCount(1);
      await expect(listRow(page, vendor).getByText(MISSING, { exact: true })).toHaveCount(0);

      await listRow(page, vendor).getByRole("link").click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("עריכת הוצאה");
      await expect(page.getByText(KEEP_ORIGINAL, { exact: true })).toBeVisible();
      const view = page.getByRole("link", { name: /^צפייה בקובץ המצורף/ });
      await expect(view).toHaveAttribute("href", `/expenses/${saved.id}/file`);
      await expect(view).toHaveAttribute("target", "_blank");
      const response = await page.request.get(`/expenses/${saved.id}/file`, { maxRedirects: 0 });
      expect(response.status()).toBe(303);
      expect(response.headers()["location"]).toContain(
        `/object/sign/expense-files/${saved.file_path}`,
      );
      expect(response.headers()["cache-control"]).toBe("no-store");
    },
  );

  test_(
    "EXP-2: the camera input opens the camera (capture) and the file input accepts JPEG, PNG and PDF",
    async ({ page }) => {
      await gotoNewExpense(page);
      await expect(field.photo(page)).toHaveAttribute("capture", "environment");
      await expect(field.photo(page)).toHaveAttribute("accept", "image/*");
      await expect(field.file(page)).toHaveAttribute(
        "accept",
        "image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf",
      );
    },
  );

  test_(
    "EXP-2: a large photo is compressed in the browser to a JPEG whose longest side is 2000px",
    async ({ page, token }) => {
      const vendor = `צילום ${token}`;
      await gotoNewExpense(page);
      const original = await drawImage(page, 3000, 1500, "image/png");
      await fillExpense(page, { vendor });
      await field.photo(page).setInputFiles({
        name: "photo.png",
        mimeType: "image/png",
        buffer: original,
      });

      await page.getByRole("button", { name: "שמירת הוצאה" }).click();

      await expect(notice(page, SAVED_WITH_FILE)).toBeVisible();
      const [saved] = await expensesOf(vendor);
      expect(saved.file_path).toMatch(/\.jpg$/);
      const stored = await storedFile(saved.file_path!);
      expect(isJpeg(stored)).toBe(true);
      expect(jpegSize(stored)).toEqual({ width: 2000, height: 1000 });
      expect(stored.length).toBeLessThan(original.length);
      expect(stored.length).toBeLessThanOrEqual(MAX_BYTES);
    },
  );

  test_(
    "EXP-2: a sideways phone photo (EXIF orientation) is stored upright, without its EXIF data",
    async ({ page, token }) => {
      const vendor = `מסובב ${token}`;
      await gotoNewExpense(page);
      const sideways = withExifOrientation6(await drawImage(page, 400, 200, "image/jpeg"));
      await fillExpense(page, { vendor });
      await field.file(page).setInputFiles({
        name: "IMG_0001.jpg",
        mimeType: "image/jpeg",
        buffer: sideways,
      });

      await page.getByRole("button", { name: "שמירת הוצאה" }).click();

      await expect(notice(page, SAVED_WITH_FILE)).toBeVisible();
      const [saved] = await expensesOf(vendor);
      const stored = await storedFile(saved.file_path!);
      expect(jpegSize(stored)).toEqual({ width: 200, height: 400 });
      expect(stored.includes(Buffer.from("Exif\0\0", "binary"))).toBe(false);
    },
  );

  test_(
    "EXP-2: an image that cannot be decoded shows an inline error, keeps the input and uploads nothing",
    async ({ page, token }) => {
      const vendor = `פגום ${token}`;
      const uploads: string[] = [];
      page.on("request", (request) => {
        if (request.url().includes("/storage/v1/object/upload/sign/")) {
          uploads.push(request.url());
        }
      });
      await gotoNewExpense(page);
      await fillExpense(page, { vendor });
      await field.photo(page).setInputFiles({
        name: "broken.png",
        mimeType: "image/png",
        buffer: Buffer.from("this is not a png"),
      });

      await page.getByRole("button", { name: "שמירת הוצאה" }).click();

      await expect(
        page.getByText("לא הצלחנו לקרוא את התמונה. אפשר לצלם שוב או לבחור קובץ אחר."),
      ).toBeVisible();
      // M4.1 carry-over: focus goes to the camera input that holds the rejected photo.
      await expect(field.photo(page)).toBeFocused();
      await expect(field.vendor(page)).toHaveValue(vendor);
      expect(uploads).toEqual([]);
      expect(await expensesOf(vendor)).toEqual([]);
    },
  );

  test_(
    "EXP-2 / SPEC 10: an unsupported type and a PDF over 10MB are refused before uploading",
    async ({ page, token }) => {
      const vendor = `לא נתמך ${token}`;
      await gotoNewExpense(page);
      await fillExpense(page, { vendor });

      await field.file(page).setInputFiles({
        name: "receipt.gif",
        mimeType: "image/gif",
        buffer: Buffer.from("GIF89a"),
      });
      await page.getByRole("button", { name: "שמירת הוצאה" }).click();
      await expect(page.getByText("אפשר לצרף רק תמונה (JPEG או PNG) או קובץ PDF.")).toBeVisible();

      await field.file(page).setInputFiles({
        name: "big.pdf",
        mimeType: "application/pdf",
        buffer: pdf(MAX_BYTES + 1),
      });
      await page.getByRole("button", { name: "שמירת הוצאה" }).click();
      await expect(page.getByText("הקובץ גדול מדי. אפשר להעלות קובץ של עד 10MB.")).toBeVisible();

      await field.file(page).setInputFiles({
        name: "fake.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("<html>not a pdf</html>"),
      });
      await page.getByRole("button", { name: "שמירת הוצאה" }).click();
      await expect(
        page.getByText("תוכן הקובץ אינו תמונה (JPEG או PNG) או PDF. יש לבחור קובץ אחר."),
      ).toBeVisible();
      expect(await expensesOf(vendor)).toEqual([]);
    },
  );
});

test_.describe("EXP-1: editing and deleting", () => {
  test_(
    "EXP-1 / EXP-7: attaching a receipt later on the edit page removes חסר מסמך and shows the keep-the-original message",
    async ({ page, token, seedExpense }) => {
      const vendor = `מאוחר ${token}`;
      const id = await seedExpense({
        vendor,
        amount: 10_000,
        expense_date: todayInJerusalem(),
        category_id: await categoryId(PRINTING),
      });
      await page.goto(`/expenses/${id}/edit`);
      await expect(field.file(page)).toBeEnabled();
      await expect(page.getByText(MISSING, { exact: true })).toBeVisible();
      await expect(field.amount(page)).toHaveValue("100");
      await field.amount(page).fill("120");
      await field.file(page).setInputFiles({
        name: "r.pdf",
        mimeType: "application/pdf",
        buffer: pdf(),
      });

      await page.getByRole("button", { name: "שמירת שינויים" }).click();

      await expect(notice(page, `השינויים בהוצאה נשמרו. ${KEEP_ORIGINAL}`)).toBeVisible();
      const [saved] = await expensesOf(vendor);
      expect(saved.amount).toBe(12_000);
      expect(saved.file_path).not.toBeNull();
    },
  );

  test_(
    "owner decision (M3): an archived category stays on its expense but is not offered for a new one",
    async ({ page, token, seedExpense, seedCategory }) => {
      const category = `ישנה ${token}`;
      const categoryIdValue = await seedCategory(category);
      const id = await seedExpense({
        vendor: `ספק ${token}`,
        amount: 5_000,
        expense_date: todayInJerusalem(),
        category_id: categoryIdValue,
      });
      await createServiceRoleClient()
        .from("expense_categories")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", categoryIdValue);

      await page.goto(`/expenses/${id}/edit`);
      await expect(field.category(page).locator("option:checked")).toHaveText(
        `${category} (בארכיון)`,
      );
      await field.notes(page).fill("עודכן");
      await page.getByRole("button", { name: "שמירת שינויים" }).click();
      await expect(notice(page, "השינויים בהוצאה נשמרו.")).toBeVisible();

      await gotoNewExpense(page);
      await expect(field.category(page).locator("option", { hasText: category })).toHaveCount(0);
      await expect(field.category(page).locator("option", { hasText: PRINTING })).toHaveCount(1);
    },
  );

  test_(
    "SPEC 6: deleting an expense asks for confirmation and keeps the record as deleted",
    async ({ page, token, seedExpense }) => {
      const vendor = `למחיקה ${token}`;
      const id = await seedExpense({
        vendor,
        amount: 4_200,
        expense_date: todayInJerusalem(),
        category_id: await categoryId(PRINTING),
      });
      await page.goto(`/expenses/${id}/edit`);

      await page.getByRole("button", { name: "מחיקת הוצאה" }).click();
      const dialog = page.getByRole("dialog", { name: "למחוק את ההוצאה?" });
      await expect(dialog.getByRole("button", { name: "חזרה" })).toBeFocused();
      await dialog.getByRole("button", { name: "מחיקת ההוצאה" }).click();

      await expect(page).toHaveURL(/\/expenses$/);
      await expect(notice(page, "ההוצאה נמחקה.")).toBeVisible();
      await expect(listRow(page, vendor)).toHaveCount(0);
      const [row] = await expensesOf(vendor);
      expect(row.deleted_at).not.toBeNull();
      const notFound = await page.request.get(`/expenses/${id}/edit`);
      expect(notFound.status()).toBe(404);
    },
  );
});

test_.describe("EXP-4 / EXP-6: filters and totals", () => {
  test_(
    "EXP-4 / WCAG 1.4.3: a hovered row's secondary text takes the full text color on the hover background",
    async ({ page, token, seedExpense }, testInfo) => {
      // Tailwind's hover: applies only where the device can hover; touch screens never get
      // the hover background.
      test_.skip(testInfo.project.name !== "desktop", "Hover styles apply on desktop only");
      await seedExpense({
        vendor: `ריחוף ${token}`,
        amount: 1_000,
        expense_date: todayInJerusalem(),
        category_id: await categoryId(PRINTING),
      });
      await page.goto("/expenses");
      const row = page.getByRole("link", { name: new RegExp(`ריחוף ${token}`) });
      const category = row.getByText(PRINTING, { exact: true });
      const vendor = row.getByText(`ריחוף ${token}`, { exact: true });
      const colorOf = (locator: typeof vendor) =>
        locator.evaluate((element) => getComputedStyle(element).color);
      expect(await colorOf(category)).not.toBe(await colorOf(vendor));
      await row.hover();
      await expect.poll(() => colorOf(category)).toBe(await colorOf(vendor));
    },
  );

  test_(
    "EXP-4 / EXP-6: filters by month, vendor (Enter), category and missing document, with the filter's total",
    async ({ page, token, seedExpense, seedCategory }) => {
      const month = "1990-06";
      const other = await seedCategory(`אחרת ${token}`);
      const printing = await categoryId(PRINTING);
      const service = createServiceRoleClient();
      await seedExpense({
        vendor: `Office ${token} א`,
        amount: 10_050,
        expense_date: "1990-06-01",
        category_id: printing,
      });
      await seedExpense({
        vendor: `office ${token} ב`,
        amount: 20_000,
        expense_date: "1990-06-30",
        category_id: other,
      });
      const withFile = await seedExpense({
        vendor: `דפוס ${token}`,
        amount: 5,
        expense_date: "1990-06-15",
        category_id: printing,
      });
      await seedExpense({
        vendor: `Office ${token} ג`,
        amount: 999_999,
        expense_date: "1990-07-01",
        category_id: printing,
      });
      // One of them has a file (stored as the app would, by the service role).
      const path = `${crypto.randomUUID()}.pdf`;
      await service.storage
        .from("expense-files")
        .upload(path, pdf(), { contentType: "application/pdf" });
      await service.from("expenses").update({ file_path: path }).eq("id", withFile);

      await page.goto("/expenses");
      const month_ = page.getByLabel("חודש");
      await expect(month_).toBeEnabled();
      // Enter right after the month change, while its load may still run, is not dropped.
      await month_.fill(month);
      await page.getByRole("searchbox", { name: "ספק" }).fill(token);
      await page.getByRole("searchbox", { name: "ספק" }).press("Enter");

      const total = page.locator("dl").filter({ hasText: "סה״כ הוצאות" });
      await expect(total).toContainText(`סה״כ הוצאות ב-06/1990, ספק: ${token}`);
      await expect(total).toContainText(shekels(30_055));
      await expect(total).toContainText("(3 הוצאות)");
      await expect(page.getByRole("status").filter({ hasText: shekels(30_055) })).toHaveCount(1);
      const items = page.getByRole("list", { name: "רשימת ההוצאות" }).getByRole("listitem");
      await expect(items).toHaveCount(3);
      await expect(items.nth(0)).toContainText(`office ${token} ב`);
      await expect(items.filter({ hasText: `דפוס ${token}` }).getByText(MISSING)).toHaveCount(0);

      await page
        .getByRole("combobox", { name: "קטגוריה" })
        .selectOption({ label: `אחרת ${token}` });
      await expect(total).toContainText(`קטגוריה: אחרת ${token}`);
      await expect(total).toContainText(shekels(20_000));
      await expect(items).toHaveCount(1);

      await page.getByRole("combobox", { name: "קטגוריה" }).selectOption({ label: "כל הקטגוריות" });
      await page.getByRole("checkbox", { name: "רק הוצאות שחסר להן מסמך" }).check();
      await expect(total).toContainText("חסר מסמך בלבד");
      await expect(total).toContainText(shekels(30_050));
      await expect(items).toHaveCount(2);
      for (const item of await items.all()) {
        await expect(item.getByText(MISSING, { exact: true })).toBeVisible();
      }

      await month_.fill("1990-08");
      await expect(total).toContainText(shekels(0));
      await expect(page.getByText("אין הוצאות שמתאימות לסינון.")).toBeVisible();
      // SPEC 8: the vendor searched never appears in the address.
      expect(page.url()).not.toContain(encodeURIComponent(token));
      expect(page.url()).toMatch(/\/expenses$/);
    },
  );

  test_(
    "M3-11: a failed filter request shows an inline error and puts the filters back",
    async ({ page }) => {
      await page.goto("/expenses");
      await expect(page.getByLabel("חודש")).toBeEnabled();
      const before = await page.getByLabel("חודש").inputValue();
      const restore = await failServerActions(page, "abort");

      await page.getByLabel("חודש").fill("1990-01");

      await expect(page.getByRole("main").getByRole("alert")).toHaveText(
        "טעינת ההוצאות נכשלה. אפשר לנסות שוב.",
      );
      await expect(page.getByLabel("חודש")).toHaveValue(before);
      await restore();
    },
  );
});

test_.describe("M3-11: failed requests and ended sessions", () => {
  test_(
    "M3-11: saving while offline shows the inline error, keeps the input and records nothing",
    async ({ page, context, token }) => {
      const vendor = `אופליין ${token}`;
      await gotoNewExpense(page);
      await fillExpense(page, { vendor });
      await field
        .file(page)
        .setInputFiles({ name: "r.pdf", mimeType: "application/pdf", buffer: pdf() });
      await context.setOffline(true);

      await page.getByRole("button", { name: "שמירת הוצאה" }).click();

      await expect(page.getByRole("alert").first()).toHaveText(SAVE_UNAVAILABLE);
      await expect(page).toHaveURL(/\/expenses\/new$/);
      await expect(field.vendor(page)).toHaveValue(vendor);
      await context.setOffline(false);
      expect(await expensesOf(vendor)).toEqual([]);

      await page.getByRole("button", { name: "שמירת הוצאה" }).click();
      await expect(notice(page, SAVED_WITH_FILE)).toBeVisible();
      expect(await expensesOf(vendor)).toHaveLength(1);
    },
  );

  for (const mode of ["abort", "500"] as const) {
    test_(
      `M3-11: a failed save (${mode}) shows an inline error and keeps the input`,
      async ({ page, token }) => {
        const vendor = `כשל ${mode} ${token}`;
        await gotoNewExpense(page);
        await fillExpense(page, { vendor });
        const restore = await failServerActions(page, mode);

        await page.getByRole("button", { name: "שמירת הוצאה" }).click();

        await expect(page.getByRole("alert").first()).toHaveText(SAVE_UNAVAILABLE);
        await expect(field.vendor(page)).toHaveValue(vendor);
        expect(await expensesOf(vendor)).toEqual([]);
        await restore();
      },
    );
  }

  test_(
    "EXP-2: a failed upload to storage shows an inline error and records nothing",
    async ({ page, token }) => {
      const vendor = `העלאה ${token}`;
      await page.route("**/storage/v1/object/upload/sign/**", (route) =>
        route.abort("internetdisconnected"),
      );
      await gotoNewExpense(page);
      await fillExpense(page, { vendor });
      await field
        .file(page)
        .setInputFiles({ name: "r.pdf", mimeType: "application/pdf", buffer: pdf() });

      await page.getByRole("button", { name: "שמירת הוצאה" }).click();

      await expect(page.getByRole("alert").first()).toHaveText(
        "העלאת הקובץ נכשלה. בדקו את החיבור ונסו שוב.",
      );
      expect(await expensesOf(vendor)).toEqual([]);
    },
  );

  test_(
    "AUTH-3: saving an expense after the session ended opens /login",
    async ({ page, context, token }) => {
      const vendor = `פג ${token}`;
      await gotoNewExpense(page);
      await fillExpense(page, { vendor });
      await context.clearCookies();

      await page.getByRole("button", { name: "שמירת הוצאה" }).click();

      await expect(page).toHaveURL(/\/login$/);
      expect(await expensesOf(vendor)).toEqual([]);
    },
  );

  test_(
    "EXP-2: the file link needs a session and answers 404 for an expense without a file",
    async ({ page, context, token, seedExpense }) => {
      const id = await seedExpense({
        vendor: `קישור ${token}`,
        amount: 100,
        expense_date: todayInJerusalem(),
        category_id: await categoryId(PRINTING),
      });
      const withoutFile = await page.request.get(`/expenses/${id}/file`, { maxRedirects: 0 });
      await context.clearCookies();
      const signedOut = await page.request.get(`/expenses/${id}/file`, { maxRedirects: 0 });

      expect(withoutFile.status()).toBe(404);
      expect(signedOut.status()).toBe(307);
      expect(signedOut.headers()["location"]).toMatch(/\/login$/);
    },
  );
});

test_.describe("M3-12: layout, accessibility and CSP", () => {
  test_(
    "M3-12: no horizontal scroll and no CSP violations on the expenses and settings screens",
    async ({ page, token, seedExpense, seedCategory }, testInfo) => {
      const violations = await trackCspViolations(page);
      const category = await seedCategory(`קטגוריה ארוכה ${"ארוכה".repeat(4)} ${token}`);
      const id = await seedExpense({
        vendor: `ספק ארוך ${"ארוך".repeat(20)} ${token}`,
        amount: 9_999_999_999,
        expense_date: todayInJerusalem(),
        category_id: category,
        notes: "הערה ארוכה ".repeat(100).trim(),
      });

      for (const width of VIEWPORT_WIDTHS_BY_PROJECT[testInfo.project.name]) {
        for (const path of [
          "/expenses",
          "/expenses/new",
          `/expenses/${id}/edit`,
          "/settings",
          "/settings/categories/new",
          `/settings/categories/${category}/edit`,
        ]) {
          await page.setViewportSize({ width, height: 800 });
          await page.goto(path, { waitUntil: "networkidle" });
          expect(
            await hasHorizontalScroll(page),
            `horizontal scroll at ${width}px on ${path}`,
          ).toBe(false);
        }
      }
      // Exercise zod, the Server Actions and the canvas in the browser as well.
      await gotoNewExpense(page);
      await page.getByRole("button", { name: "שמירת הוצאה" }).click();
      await expect(field.amount(page)).toHaveAttribute("aria-invalid", "true");
      const box = await page.getByRole("button", { name: "שמירת הוצאה" }).boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
      expect(violations).toEqual([]);
    },
  );
});
