import type { Page, TestInfo } from "@playwright/test";

import { todayInJerusalem } from "../../src/lib/dates";
import { formatAgorot } from "../../src/lib/money";

import { createServiceRoleClient, expect, test_ } from "./support/data-fixtures";
import {
  VIEWPORT_WIDTHS_BY_PROJECT,
  failServerActions,
  hasHorizontalScroll,
  trackCspViolations,
} from "./support/helpers";

/**
 * M4.1: the dashboard (DASH-1..5) and the exempt-dealer ceiling (CEIL-1, CEIL-3..6).
 *
 * The dashboard sums every income and expense of a period, and other tests run in parallel,
 * so each test here works in its own past years (incomes cannot be in the future): the
 * Android project in 1920–1939, the desktop project in 1960–1979, one year (or two) per
 * test. The ceiling and its banners follow the selected period's tax year. Ceilings and
 * acknowledgements of those years are removed before and after each test.
 */

const YEAR_BASE_BY_PROJECT: Record<string, number> = { android: 1920, desktop: 1960 };

function testYear(testInfo: TestInfo, offset: number): number {
  const base = YEAR_BASE_BY_PROJECT[testInfo.project.name];
  if (base === undefined) {
    throw new Error(`No dashboard years for project ${testInfo.project.name}`);
  }
  return base + offset;
}

async function clearCeilingYears(years: readonly number[]): Promise<void> {
  const service = createServiceRoleClient();
  const acks = await service.from("ceiling_alert_acks").delete().in("year", years);
  const ceilings = await service.from("tax_year_settings").delete().in("year", years);
  const error = acks.error ?? ceilings.error;
  if (error) {
    throw new Error("Could not clear the test years' ceilings", { cause: error });
  }
}

async function setCeiling(year: number, agorot: number): Promise<void> {
  const { error } = await createServiceRoleClient()
    .from("tax_year_settings")
    .upsert({ year, exempt_ceiling: agorot }, { onConflict: "year" });
  if (error) {
    throw new Error("Could not set a test ceiling", { cause: error });
  }
}

/** Agorot as the app shows them, direction marks included (e.g. "‏12,500.50 ‏₪"). */
function money(agorot: number): string {
  return formatAgorot(agorot);
}

function monthUrl(month: string): string {
  return `/?period=month&month=${month}`;
}

function yearUrl(year: number): string {
  return `/?period=year&year=${year}`;
}

function measure(page: Page, label: string) {
  return page
    .getByRole("region", { name: /^סיכום/ })
    .locator("dl > div")
    .filter({ has: page.locator("dt", { hasText: new RegExp(`^${label}$`) }) });
}

/**
 * The ceiling banners' live region. M6 adds the tasks card's live region further down the
 * page; the ceiling's comes first in the document.
 */
function ceilingStatus(page: Page) {
  return page.getByRole("status").first();
}

function ceilingRegion(page: Page, year: number) {
  return page.getByRole("region", { name: `תקרת עוסק פטור – ${year}` });
}

test_.describe("DASH-1..5: the dashboard", () => {
  test_(
    "DASH-1 (M4.1 carry-over): the period field follows the previous/next links and the type switch, without console warnings",
    async ({ page, signIn }) => {
      await signIn({ role: "owner" });
      const messages: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "warning" || message.type() === "error") {
          messages.push(message.text());
        }
      });
      await page.goto(monthUrl("2000-03"));
      const month = page.getByLabel("חודש", { exact: true });
      await expect(month).toHaveValue("2000-03");
      await page.waitForLoadState("networkidle");

      await page.getByRole("link", { name: "החודש הקודם: 02/2000" }).click();
      await expect(page).toHaveURL(/month=2000-02/);
      await expect(month).toHaveValue("2000-02");
      await page.getByRole("link", { name: "החודש הבא: 03/2000" }).click();
      await expect(month).toHaveValue("2000-03");

      // A value typed but not submitted gives way to the period a link opens.
      await month.fill("2000-07");
      await page.getByRole("link", { name: "החודש הקודם: 02/2000" }).click();
      await expect(month).toHaveValue("2000-02");

      await page.getByRole("link", { name: "שנה", exact: true }).click();
      const year = page.getByLabel("שנה", { exact: true });
      await expect(year).toHaveValue("2000");
      await page.getByRole("link", { name: "השנה הקודמת: 1999" }).click();
      await expect(year).toHaveValue("1999");
      await page.getByRole("link", { name: "חודש", exact: true }).click();
      await expect(month).toHaveValue("1999-12");
      expect(messages).toEqual([]);
    },
  );

  test_(
    "DASH-1 / DASH-2: opens on the current month and switches between months and years with exact totals and comparisons",
    async ({ page, signIn, token, seedClient, seedExpense, seedCategory }, testInfo) => {
      await signIn({ role: "owner" });
      const year = testYear(testInfo, 0);
      const clientId = await seedClient({ name: `לוח ${token}` });
      const categoryId = await seedCategory(`קטגוריה ${token}`);
      const service = createServiceRoleClient();
      const incomes = [
        { received_date: `${year}-02-10`, amount: 100_000 },
        { received_date: `${year}-03-01`, amount: 123_456 },
        { received_date: `${year}-03-31`, amount: 1 },
      ];
      for (const income of incomes) {
        const { error } = await service
          .from("incomes")
          .insert({ client_id: clientId, payment_method: "cash", ...income });
        expect(error).toBeNull();
      }
      // A soft-deleted income never counts.
      const { data: deleted } = await service
        .from("incomes")
        .insert({
          client_id: clientId,
          payment_method: "cash",
          received_date: `${year}-03-15`,
          amount: 999_999,
        })
        .select("id")
        .single();
      await service
        .from("incomes")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", deleted?.id);
      await seedExpense({
        expense_date: `${year}-03-20`,
        amount: 23_456,
        vendor: `ספק ${token}`,
        category_id: categoryId,
      });

      await page.goto("/");
      const today = todayInJerusalem();
      const [currentYear, currentMonth] = today.split("-");
      await expect(page.getByRole("heading", { level: 2, name: /^תקופה:/ })).toHaveText(
        `תקופה: ${currentMonth}/${currentYear}`,
      );
      await expect(page.getByRole("link", { name: "חודש", exact: true })).toHaveAttribute(
        "aria-current",
        "page",
      );
      // No "next" period after the current one.
      await expect(page.getByRole("link", { name: /^החודש הבא/ })).toHaveCount(0);

      await page.goto(monthUrl(`${year}-03`));
      await expect(measure(page, "הכנסות").locator("dd").first()).toHaveText(money(123_457));
      await expect(measure(page, "הכנסות").locator("dd").nth(1)).toHaveText(
        `עלייה של ${money(23_457)} (23.4%) לעומת 02/${year}`,
      );
      await expect(measure(page, "הוצאות").locator("dd").first()).toHaveText(money(23_456));
      await expect(measure(page, "הוצאות").locator("dd").nth(1)).toHaveText(
        `עלייה של ${money(23_456)} (—) לעומת 02/${year}`,
      );
      await expect(measure(page, "רווח").locator("dd").first()).toHaveText(money(100_001));
      await expect(measure(page, "רווח").locator("dd").nth(1)).toHaveText(
        `עלייה של ${money(1)} (0.0%) לעומת 02/${year}`,
      );

      await page.getByRole("link", { name: `החודש הקודם: 02/${year}` }).click();
      await expect(page.getByRole("heading", { level: 2, name: /^תקופה:/ })).toHaveText(
        `תקופה: 02/${year}`,
      );
      await expect(measure(page, "הכנסות").locator("dd").first()).toHaveText(money(100_000));
      await expect(measure(page, "הכנסות").locator("dd").nth(1)).toHaveText(
        `עלייה של ${money(100_000)} (—) לעומת 01/${year}`,
      );

      await page.getByRole("link", { name: "שנה", exact: true }).click();
      await expect(page.getByRole("heading", { level: 2, name: /^תקופה:/ })).toHaveText(
        `תקופה: ${year}`,
      );
      await expect(measure(page, "הכנסות").locator("dd").first()).toHaveText(money(223_457));
      await expect(measure(page, "הכנסות").locator("dd").nth(1)).toHaveText(
        `עלייה של ${money(223_457)} (—) לעומת ${year - 1}`,
      );
      await expect(measure(page, "רווח").locator("dd").first()).toHaveText(money(200_001));

      // The form jumps to any month.
      await page.getByRole("link", { name: "חודש", exact: true }).click();
      await expect(page.getByRole("heading", { level: 2, name: /^תקופה:/ })).toHaveText(
        `תקופה: 12/${year}`,
      );
      await page.getByLabel("חודש", { exact: true }).fill(`${year}-03`);
      await page.getByRole("button", { name: "הצגה" }).click();
      await expect(page).toHaveURL(new RegExp(`period=month&month=${year}-03`));
      await expect(measure(page, "הכנסות").locator("dd").first()).toHaveText(money(123_457));
    },
  );

  test_(
    "DASH-3 / DASH-4: the 12-month chart and the categories chart render without CSP violations, with table and list alternatives",
    async (
      { page, signIn, token, seedClient, seedIncome, seedExpense, seedCategory },
      testInfo,
    ) => {
      const violations = await trackCspViolations(page);
      await signIn({ role: "owner" });
      const year = testYear(testInfo, 1);
      const clientId = await seedClient({ name: `גרף ${token}` });
      const big = await seedCategory(`גדולה ${token}`);
      const small = await seedCategory(`קטנה ${token}`);
      await seedIncome({ client_id: clientId, received_date: `${year}-01-05`, amount: 500_050 });
      await seedIncome({ client_id: clientId, received_date: `${year}-06-05`, amount: 250_000 });
      await seedExpense({
        expense_date: `${year}-06-07`,
        amount: 75_000,
        vendor: `א ${token}`,
        category_id: big,
      });
      await seedExpense({
        expense_date: `${year}-06-08`,
        amount: 25_000,
        vendor: `ב ${token}`,
        category_id: small,
      });

      await page.goto(monthUrl(`${year}-06`));
      const monthly = page.getByRole("region", { name: "הכנסות מול הוצאות – 12 חודשים" });
      await expect(
        monthly.getByText(`07/${year - 1} עד 06/${year}`, { exact: true }),
      ).toBeVisible();
      const chart = monthly.getByRole("img", { name: /^גרף עמודות של הכנסות מול הוצאות/ });
      await expect(chart.locator(".recharts-wrapper > svg.recharts-surface")).toBeVisible();
      // Two months have an income and one an expense: three bars drawn.
      await expect(chart.locator(".recharts-bar-rectangle path")).toHaveCount(3);
      await expect(chart.getByText("הכנסות", { exact: true })).toBeVisible();

      await monthly.getByText("טבלת הנתונים של הגרף").click();
      const table = monthly.getByRole("table", {
        name: `הכנסות והוצאות לפי חודש, 07/${year - 1} עד 06/${year}`,
      });
      await expect(table.getByRole("row")).toHaveCount(13);
      await expect(table.getByRole("row", { name: new RegExp(`^01/${year}`) })).toContainText(
        money(500_050),
      );
      const june = table.getByRole("row", { name: new RegExp(`^06/${year}`) });
      await expect(june.getByRole("cell").nth(0)).toHaveText(money(250_000));
      await expect(june.getByRole("cell").nth(1)).toHaveText(money(100_000));

      const categories = page.getByRole("region", { name: `הוצאות לפי קטגוריה – 06/${year}` });
      await expect(
        categories
          .getByRole("img", { name: /^גרף עמודות של ההוצאות לפי קטגוריה/ })
          .locator(".recharts-bar-rectangle path"),
      ).toHaveCount(2);
      const items = categories
        .getByRole("list", { name: "פירוט ההוצאות לפי קטגוריה" })
        .getByRole("listitem");
      await expect(items).toHaveCount(2);
      await expect(items.nth(0)).toContainText(`גדולה ${token}`);
      await expect(items.nth(0)).toContainText(money(75_000));
      await expect(items.nth(0)).toContainText("75%");
      await expect(items.nth(1)).toContainText("25%");
      await expect(items.nth(1)).toContainText("הוצאה אחת");

      // Hovering a bar shows its exact amount.
      await chart.locator(".recharts-bar-rectangle path").first().hover();
      await expect(chart.locator(".recharts-tooltip-wrapper")).toContainText(money(500_050));

      for (const width of VIEWPORT_WIDTHS_BY_PROJECT[testInfo.project.name]) {
        await page.setViewportSize({ width, height: 900 });
        await expect(chart.locator(".recharts-wrapper > svg.recharts-surface")).toBeVisible();
        expect(await hasHorizontalScroll(page), `horizontal scroll at ${width}px`).toBe(false);
      }

      // An empty period says so instead of drawing an empty chart.
      await page.goto(monthUrl(`${year}-02`));
      await expect(page.getByText("אין הוצאות בתקופה הזו.")).toBeVisible();
      expect(violations).toEqual([]);
    },
  );

  test_(
    "DASH-5: the action cards link to open debts, pending receipts and this month's expenses without a document",
    async ({ page, signIn, token, seedExpense, seedCategory }) => {
      await signIn({ role: "owner" });
      const categoryId = await seedCategory(`כרטיס ${token}`);
      await seedExpense({
        expense_date: todayInJerusalem(),
        amount: 1_000,
        vendor: `חסר ${token}`,
        category_id: categoryId,
      });
      await page.goto("/");
      const cards = page.getByRole("region", { name: "לטיפול" });
      await expect(cards.getByRole("region", { name: "חובות פתוחים" })).toBeVisible();
      await expect(cards.getByRole("region", { name: "קבלות ממתינות" })).toBeVisible();
      const missing = cards.getByRole("region", { name: "הוצאות ללא מסמך" });
      await expect(missing).toContainText(/(הוצאה אחת|\d+ הוצאות) החודש בלי מסמך\./);
      // DASH-5: the tasks card came with M6; no placeholder for today's events before M5.
      await expect(cards.getByRole("region", { name: "משימות", exact: true })).toBeVisible();
      await expect(page.getByText(/אירועי היום/)).toHaveCount(0);

      await missing.getByRole("link", { name: "להוצאות החודש שחסר להן מסמך" }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("הוצאות");
      await expect(page.getByRole("checkbox", { name: "רק הוצאות שחסר להן מסמך" })).toBeChecked();
      await expect(page.getByRole("list", { name: "רשימת ההוצאות" })).toContainText(`חסר ${token}`);
    },
  );
});

test_.describe("CEIL-3..6: the exempt-dealer ceiling", () => {
  test_(
    "CEIL-3 / CEIL-4 / CEIL-5: banners at 70, 85 and 95% until acknowledged (shared by both users), and a permanent one at 100%",
    async ({ page, signIn, token, seedClient, seedIncome }, testInfo) => {
      const year = testYear(testInfo, 2);
      await clearCeilingYears([year]);
      try {
        await signIn({ role: "owner" });
        // ₪10,000.
        await setCeiling(year, 1_000_000);
        const clientId = await seedClient({ name: `תקרה ${token}` });
        const url = yearUrl(year);
        const ceiling = ceilingRegion(page, year);
        const thresholdBanner = page.getByRole("region", { name: /^התראה: המחזור בשנת \d+ עבר/ });
        const exceededBanner = page.getByRole("region", {
          name: /^התראה: המחזור בשנת \d+ הגיע לתקרת/,
        });

        // 69.99%: nothing yet.
        await seedIncome({ client_id: clientId, received_date: `${year}-01-10`, amount: 699_900 });
        await page.goto(url);
        await expect(ceiling.getByRole("progressbar")).toHaveAttribute("value", "699");
        await expect(ceiling).toContainText(money(699_900));
        await expect(ceiling).toContainText(money(1_000_000));
        await expect(ceiling).toContainText("69.9%");
        await expect(ceiling).toContainText(money(300_100));
        await expect(thresholdBanner).toHaveCount(0);

        // Exactly 70%.
        await seedIncome({ client_id: clientId, received_date: `${year}-12-31`, amount: 100 });
        await page.reload();
        await expect(thresholdBanner).toHaveAccessibleName(
          `התראה: המחזור בשנת ${year} עבר 70% מתקרת עוסק פטור (70.0%)`,
        );
        await thresholdBanner.getByRole("button", { name: "קראתי, אפשר להסתיר" }).click();
        // M4.1 carry-over: the confirmation says what the acknowledgement covers.
        await expect(ceilingStatus(page)).toHaveText(
          `ההתראה אושרה: התראת 70% לא תוצג שוב בשנת ${year}. התראה חדשה תוצג אם המחזור יעבור 85% מהתקרה.`,
        );
        await expect(thresholdBanner).toHaveCount(0);
        await expect(page.getByRole("heading", { name: `תקרת עוסק פטור – ${year}` })).toBeFocused();
        await page.reload();
        await expect(thresholdBanner).toHaveCount(0);

        // The acknowledgement is shared: the admin does not see the 70% banner either.
        await signIn({ role: "admin" });
        await page.reload();
        await expect(ceiling).toContainText("70.0%");
        await expect(thresholdBanner).toHaveCount(0);

        // 85%: a new banner, acknowledged by the admin.
        await seedIncome({ client_id: clientId, received_date: `${year}-05-05`, amount: 150_000 });
        await page.reload();
        await expect(thresholdBanner).toHaveAccessibleName(
          `התראה: המחזור בשנת ${year} עבר 85% מתקרת עוסק פטור (85.0%)`,
        );
        await thresholdBanner.getByRole("button", { name: "קראתי, אפשר להסתיר" }).click();
        await expect(thresholdBanner).toHaveCount(0);

        // 95%, straight past it to 99.99%: one banner, the highest.
        await seedIncome({ client_id: clientId, received_date: `${year}-06-06`, amount: 149_900 });
        await page.reload();
        await expect(thresholdBanner).toHaveAccessibleName(
          `התראה: המחזור בשנת ${year} עבר 95% מתקרת עוסק פטור (99.9%)`,
        );
        await expect(thresholdBanner).toHaveCount(1);

        // 100%: the permanent banner replaces it, with no way to dismiss it.
        await seedIncome({ client_id: clientId, received_date: `${year}-07-07`, amount: 100 });
        await page.reload();
        await expect(exceededBanner).toBeVisible();
        await expect(exceededBanner).toContainText("יש לפנות לרואה חשבון/רשות המסים");
        await expect(exceededBanner.getByRole("button")).toHaveCount(0);
        await expect(thresholdBanner).toHaveCount(0);
        await expect(ceiling).toContainText("100.0%");
        await expect(ceiling.getByRole("progressbar")).toHaveAttribute("value", "1000");

        // Above it: the bar is full and says how far above.
        await seedIncome({ client_id: clientId, received_date: `${year}-08-08`, amount: 50_000 });
        await page.reload();
        await expect(exceededBanner).toBeVisible();
        await expect(ceiling).toContainText("105.0%");
        await expect(ceiling).toContainText("מעל התקרה");
        await expect(ceiling).toContainText(money(50_000));

        const { data: acks } = await createServiceRoleClient()
          .from("ceiling_alert_acks")
          .select("threshold")
          .eq("year", year)
          .order("threshold");
        expect(acks).toEqual([{ threshold: 70 }, { threshold: 85 }]);
      } finally {
        await clearCeilingYears([year]);
      }
    },
  );

  test_(
    "CEIL-4: a failed acknowledgement keeps the banner and says so",
    async ({ page, signIn, token, seedClient, seedIncome }, testInfo) => {
      const year = testYear(testInfo, 3);
      await clearCeilingYears([year]);
      try {
        await signIn({ role: "owner" });
        await setCeiling(year, 1_000);
        const clientId = await seedClient({ name: `כשל ${token}` });
        await seedIncome({ client_id: clientId, received_date: `${year}-03-03`, amount: 800 });
        await page.goto(yearUrl(year));
        const banner = page.getByRole("region", { name: /^התראה: המחזור בשנת \d+ עבר 70%/ });
        await expect(banner).toBeVisible();
        const restore = await failServerActions(page, "abort");
        await banner.getByRole("button", { name: "קראתי, אפשר להסתיר" }).click();
        await expect(ceilingStatus(page)).toContainText("הפעולה לא בוצעה");
        await expect(banner).toBeVisible();
        await restore();
      } finally {
        await clearCeilingYears([year]);
      }
    },
  );

  test_(
    "CEIL-4 (M4.1 carry-over): a threshold the turnover no longer reaches is not acknowledged, and the banner goes",
    async ({ page, signIn, token, seedClient, seedIncome }, testInfo) => {
      const year = testYear(testInfo, 9);
      await clearCeilingYears([year]);
      try {
        await signIn({ role: "owner" });
        await setCeiling(year, 1_000);
        const clientId = await seedClient({ name: `ירידה ${token}` });
        const incomeId = await seedIncome({
          client_id: clientId,
          received_date: `${year}-03-03`,
          amount: 800,
        });
        await page.goto(yearUrl(year));
        const banner = page.getByRole("region", { name: /^התראה: המחזור בשנת \d+ עבר 70%/ });
        await expect(banner).toBeVisible();
        await page.waitForLoadState("networkidle");
        // The income is deleted elsewhere while the banner is on screen.
        const { error } = await createServiceRoleClient()
          .from("incomes")
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", incomeId);
        expect(error).toBeNull();
        await banner.getByRole("button", { name: "קראתי, אפשר להסתיר" }).click();
        await expect(ceilingStatus(page)).toHaveText(
          `ההתראה לא אושרה: המחזור בשנת ${year} לא הגיע ל-70% מהתקרה. הנתונים בדף עודכנו.`,
        );
        await expect(banner).toHaveCount(0);
        const { data: acks } = await createServiceRoleClient()
          .from("ceiling_alert_acks")
          .select("threshold")
          .eq("year", year);
        expect(acks).toEqual([]);
      } finally {
        await clearCeilingYears([year]);
      }
    },
  );

  test_(
    "CEIL-6: a year without a ceiling shows 'תקרה לא הוגדרה' (never another year's value); the admin is prompted and sets it",
    async ({ page, signIn, token, seedClient, seedIncome }, testInfo) => {
      const year = testYear(testInfo, 4);
      const previousYear = year - 1;
      await clearCeilingYears([year, previousYear]);
      try {
        await setCeiling(previousYear, 5_000_000);
        const clientId = await seedClient({ name: `ללא ${token}` });
        await seedIncome({ client_id: clientId, received_date: `${year}-04-04`, amount: 12_345 });

        await signIn({ role: "owner" });
        await page.goto(monthUrl(`${year}-04`));
        const ceiling = ceilingRegion(page, year);
        await expect(ceiling).toContainText("תקרה לא הוגדרה");
        await expect(ceiling).toContainText(money(12_345));
        await expect(ceiling).not.toContainText(money(5_000_000));
        await expect(ceiling.getByRole("progressbar")).toHaveCount(0);
        await expect(ceiling.getByRole("link")).toHaveCount(0);
        await expect(page.getByRole("region", { name: /^התראה:/ })).toHaveCount(0);

        await signIn({ role: "admin" });
        await page.reload();
        await ceiling.getByRole("link", { name: `הגדרת התקרה לשנת ${year}` }).click();
        await expect(page.getByRole("heading", { level: 1 })).toHaveText("תקרה שנתית חדשה");
        await expect(page.getByRole("textbox", { name: /^שנת מס/ })).toHaveValue(String(year));
        await page.getByRole("textbox", { name: /^תקרת המחזור/ }).fill("1,234.50");
        await page.getByRole("button", { name: "שמירת התקרה" }).click();
        await expect(page).toHaveURL(/\/settings/);
        await expect(page.getByRole("status").filter({ hasText: "התקרה נשמרה." })).toBeVisible();

        await page.goto(monthUrl(`${year}-04`));
        await expect(ceiling).not.toContainText("תקרה לא הוגדרה");
        await expect(ceiling).toContainText(money(123_450));
        await expect(ceiling).toContainText("10.0%");
      } finally {
        await clearCeilingYears([year, previousYear]);
      }
    },
  );
});

test_.describe("CEIL-1: yearly ceilings in הגדרות (admin only)", () => {
  test_(
    "CEIL-1: the admin lists, adds and updates yearly ceilings, with validation",
    async ({ page, signIn }, testInfo) => {
      const year = testYear(testInfo, 5);
      await clearCeilingYears([year]);
      try {
        await signIn({ role: "admin" });
        await page.goto("/settings");
        const section = page.getByRole("region", { name: "תקרות שנתיות" });
        const list = section.getByRole("list", { name: "תקרות לפי שנה" });
        await expect(list.getByRole("listitem").filter({ hasText: "2026" })).toContainText(
          money(12_283_300),
        );

        await section.getByRole("link", { name: "הוספת תקרה" }).click();
        const yearInput = page.getByRole("textbox", { name: /^שנת מס/ });
        const amountInput = page.getByRole("textbox", { name: /^תקרת המחזור/ });
        await yearInput.fill("26");
        await amountInput.fill("0");
        await page.getByRole("button", { name: "שמירת התקרה" }).click();
        await expect(page.getByText("יש להזין שנה בת 4 ספרות, בין 1900 ל-2100.")).toBeVisible();
        await expect(page.getByText("התקרה חייבת להיות גדולה מ-0.")).toBeVisible();
        await expect(yearInput).toBeFocused();

        // A year that already has a ceiling is refused by the database.
        await yearInput.fill("2026");
        await amountInput.fill("1");
        await page.getByRole("button", { name: "שמירת התקרה" }).click();
        await expect(
          page.getByText("כבר הוגדרה תקרה לשנה הזו. אפשר לעדכן אותה מרשימת התקרות."),
        ).toBeVisible();

        await yearInput.fill(String(year));
        await amountInput.fill("100,000");
        await amountInput.press("Enter");
        await expect(page.getByRole("status").filter({ hasText: "התקרה נשמרה." })).toBeVisible();
        const row = list.getByRole("listitem").filter({ hasText: String(year) });
        await expect(row).toContainText(money(10_000_000));

        await row.getByRole("link", { name: `עדכון התקרה של ${year}` }).click();
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(
          `עדכון התקרה לשנת ${year}`,
        );
        await expect(page.getByRole("textbox", { name: /^תקרת המחזור/ })).toHaveValue("100000");
        await page.getByRole("textbox", { name: /^תקרת המחזור/ }).fill("120000.10");
        await page.getByRole("button", { name: "שמירת התקרה" }).click();
        await expect(page.getByRole("status").filter({ hasText: "התקרה עודכנה." })).toBeVisible();
        await expect(row).toContainText(money(12_000_010));
      } finally {
        await clearCeilingYears([year]);
      }
    },
  );

  test_(
    "CEIL-1 / AUTH-5: the owner is blocked by requireAdmin(): no ceilings section, and its screens answer 404",
    async ({ page, signIn }) => {
      await signIn({ role: "owner" });
      await page.goto("/settings");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("הגדרות");
      await expect(page.getByRole("heading", { name: "קטגוריות הוצאה" })).toBeVisible();
      await expect(page.getByRole("region", { name: "תקרות שנתיות" })).toHaveCount(0);

      for (const path of ["/settings/ceilings/new", "/settings/ceilings/2026/edit"]) {
        const response = await page.goto(path);
        expect(response?.status(), path).toBe(404);
        await expect(page.getByRole("heading", { level: 1 })).toHaveText("הדף לא נמצא");
      }
    },
  );
});
