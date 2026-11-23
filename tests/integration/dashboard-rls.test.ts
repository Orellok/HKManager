import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  acknowledgeCeilingAlert,
  createTaxYearCeiling,
  updateTaxYearCeiling,
} from "@/lib/ceiling/queries";
import { getDashboardData } from "@/lib/dashboard/queries";

import {
  createAnonClient,
  createServiceRoleClient,
  createSignedInUser,
  deleteUser,
  testEmail,
  type TestUser,
} from "./support/local-supabase";

/**
 * M4.1: RLS of tax_year_settings and ceiling_alert_acks, and the exactness of the dashboard
 * aggregations (soft-deleted rows, month and year boundaries, the turnover basis switch).
 * Uses the years 1908–1909 and 2098, which no other test data uses.
 */

const MARKER = `it-dashboard-${randomUUID()}`;
const YEAR = 1908;
const NEXT_YEAR = 1909;
/** A year only these tests give a ceiling (and remove again). */
const CEILING_YEAR = 2098;
const INSUFFICIENT_PRIVILEGE = "42501";
const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const TODAY = "2026-11-23";

let service: SupabaseClient;
let anon: SupabaseClient;
let outsider: TestUser;
let owner: TestUser;
let admin: TestUser;
const createdUserIds: string[] = [];
let clientId: string;
let categoryA: string;
let categoryB: string;

async function insert(table: string, row: object): Promise<string> {
  const { data, error } = await service
    .from(table)
    .insert(row)
    .select("id")
    .single<{ id: string }>();
  if (error) {
    throw new Error(`Could not insert into ${table}`, { cause: error });
  }
  return data.id;
}

function income(received_date: string, amount: number) {
  return insert("incomes", { client_id: clientId, received_date, amount, payment_method: "cash" });
}

function expense(expense_date: string, amount: number, category_id: string) {
  return insert("expenses", {
    expense_date,
    amount,
    vendor: `ספק ${MARKER}`,
    category_id,
    payment_method: "cash",
  });
}

async function setBasis(basis: unknown) {
  const { error } = await service
    .from("app_settings")
    .update({ value: basis })
    .eq("key", "turnover_basis");
  if (error) {
    throw new Error("Could not set the turnover basis", { cause: error });
  }
}

async function clearCeilingYear() {
  await service.from("ceiling_alert_acks").delete().in("year", [CEILING_YEAR, YEAR]);
  await service.from("tax_year_settings").delete().in("year", [CEILING_YEAR, YEAR]);
}

beforeAll(async () => {
  service = await createServiceRoleClient();
  anon = await createAnonClient();
  outsider = await createSignedInUser(service, testEmail("dashboard-outsider"));
  createdUserIds.push(outsider.id);
  owner = await createSignedInUser(service, testEmail("dashboard-owner"));
  createdUserIds.push(owner.id);
  admin = await createSignedInUser(service, testEmail("dashboard-admin"));
  createdUserIds.push(admin.id);
  const { error } = await service.from("allowed_users").insert([
    { email: owner.email, role: "owner" },
    { email: admin.email, role: "admin" },
  ]);
  if (error) {
    throw new Error("Could not allowlist the test users", { cause: error });
  }
  await clearCeilingYear();
  clientId = await insert("clients", { name: `לקוח ${MARKER}` });
  categoryA = await insert("expense_categories", { name: `א ${MARKER.slice(-12)}` });
  categoryB = await insert("expense_categories", { name: `ב ${MARKER.slice(-12)}` });

  // 1908: 31/12 is in 1908, 1/1 in 1909 (calendar tax years, DASH-6).
  await income(`${YEAR}-01-01`, 100);
  await income(`${YEAR}-03-15`, 9_999_999_999);
  await income(`${YEAR}-03-31`, 1);
  await income(`${YEAR}-12-31`, 50_000);
  await income(`${NEXT_YEAR}-01-01`, 70_000);
  const deletedIncome = await income(`${YEAR}-03-20`, 123_456);
  await service
    .from("incomes")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", deletedIncome);

  await expense(`${YEAR}-03-01`, 30_000, categoryA);
  await expense(`${YEAR}-03-31`, 10_000, categoryB);
  await expense(`${YEAR}-12-31`, 5_000, categoryB);
  await expense(`${NEXT_YEAR}-01-01`, 7_000, categoryA);
  const deletedExpense = await expense(`${YEAR}-03-02`, 99_999, categoryA);
  await service
    .from("expenses")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", deletedExpense);
});

afterAll(async () => {
  if (!service) {
    return;
  }
  const errors: unknown[] = [];
  await setBasis("received_date");
  await clearCeilingYear();
  const { data: incomes } = await service.from("incomes").select("id").eq("client_id", clientId);
  const incomeIds = (incomes ?? []).map((row) => row.id as string);
  const { data: documents } = await service
    .from("documents")
    .select("id")
    .in("income_id", incomeIds);
  const documentIds = (documents ?? []).map((row) => row.id as string);
  const { data: expenses } = await service
    .from("expenses")
    .select("id")
    .like("vendor", `%${MARKER}%`);
  const expenseIds = (expenses ?? []).map((row) => row.id as string);
  const results = [
    await service.from("documents").delete().in("income_id", incomeIds),
    await service
      .from("audit_log")
      .delete()
      .in("entity_id", [...incomeIds, ...documentIds, ...expenseIds]),
    await service.from("incomes").delete().in("id", incomeIds),
    await service.from("expenses").delete().in("id", expenseIds),
    await service.from("expense_categories").delete().in("id", [categoryA, categoryB]),
    await service.from("clients").delete().eq("id", clientId),
    await service.from("allowed_users").delete().in("email", [owner?.email, admin?.email]),
  ];
  errors.push(...results.map((result) => result.error).filter(Boolean));
  for (const id of createdUserIds) {
    await deleteUser(service, id);
  }
  expect(errors).toEqual([]);
});

describe("CEIL-1: tax_year_settings RLS", () => {
  it("CEIL-1: seeds the 2026 ceiling of ₪122,833 (12,283,300 agorot)", async () => {
    const { data } = await owner.client
      .from("tax_year_settings")
      .select("year, exempt_ceiling")
      .eq("year", 2026);
    expect(data).toEqual([{ year: 2026, exempt_ceiling: 12_283_300 }]);
  });

  it("AUTH-4 / CEIL-1: visitors and accounts outside the allowlist read nothing and write nothing", async () => {
    for (const client of [anon, outsider.client]) {
      const { data } = await client.from("tax_year_settings").select("year");
      expect(data ?? []).toEqual([]);
      const { error } = await client
        .from("tax_year_settings")
        .insert({ year: CEILING_YEAR, exempt_ceiling: 1 });
      expect(error).not.toBeNull();
      const acks = await client.from("ceiling_alert_acks").select("year");
      expect(acks.data ?? []).toEqual([]);
      const ackInsert = await client
        .from("ceiling_alert_acks")
        .insert({ year: CEILING_YEAR, threshold: 70 });
      expect(ackInsert.error).not.toBeNull();
      const rpc = await client.rpc("dashboard_data", {
        p_period: "year",
        p_period_start: `${YEAR}-01-01`,
        p_today: TODAY,
      });
      if (client === anon) {
        expect(rpc.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
      } else {
        // RLS hides every row: all sums are 0.
        expect(rpc.data.period.income).toBe(0);
        expect(rpc.data.ceiling.turnover).toBe(0);
      }
    }
  });

  it("CEIL-1 / AUTH-5: the owner cannot add or change a ceiling; the admin can; nobody deletes", async () => {
    await clearCeilingYear();
    const ownerInsert = await owner.client
      .from("tax_year_settings")
      .insert({ year: CEILING_YEAR, exempt_ceiling: 1 });
    expect(ownerInsert.error?.code).toBe(INSUFFICIENT_PRIVILEGE);

    expect(await createTaxYearCeiling(admin.client, { year: CEILING_YEAR, ceiling: 500 })).toEqual({
      status: "saved",
    });
    expect(await createTaxYearCeiling(admin.client, { year: CEILING_YEAR, ceiling: 600 })).toEqual({
      status: "year_taken",
    });
    expect(await updateTaxYearCeiling(owner.client, { year: CEILING_YEAR, ceiling: 1 })).toEqual({
      status: "not_found",
    });
    expect(await updateTaxYearCeiling(admin.client, { year: CEILING_YEAR, ceiling: 700 })).toEqual({
      status: "saved",
    });
    // The year itself never changes.
    const yearChange = await admin.client
      .from("tax_year_settings")
      .update({ year: CEILING_YEAR - 1 })
      .eq("year", CEILING_YEAR);
    expect(yearChange.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    const removed = await admin.client.from("tax_year_settings").delete().eq("year", CEILING_YEAR);
    expect(removed.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    const { data } = await service
      .from("tax_year_settings")
      .select("exempt_ceiling, created_by")
      .eq("year", CEILING_YEAR)
      .single();
    expect(data).toEqual({ exempt_ceiling: 700, created_by: admin.id });
  });

  it("CEIL-1: the database rejects a year outside 1900–2100 and a ceiling of 0 or above the maximum", async () => {
    for (const row of [
      { year: 1899, exempt_ceiling: 1 },
      { year: 2101, exempt_ceiling: 1 },
      { year: CEILING_YEAR - 2, exempt_ceiling: 0 },
      { year: CEILING_YEAR - 2, exempt_ceiling: 10_000_000_000 },
    ]) {
      const { error } = await service.from("tax_year_settings").insert(row);
      expect(error?.code).toBe(CHECK_VIOLATION);
    }
  });
});

describe("CEIL-4: ceiling_alert_acks", () => {
  it("CEIL-4: an acknowledgement is stored once per year and threshold, by the database's user and time", async () => {
    await clearCeilingYear();
    await acknowledgeCeilingAlert(owner.client, CEILING_YEAR, 85);
    // Again, by the other user: no error, the first acknowledgement stays.
    await acknowledgeCeilingAlert(admin.client, CEILING_YEAR, 85);
    await acknowledgeCeilingAlert(admin.client, CEILING_YEAR, 95);
    const { data } = await service
      .from("ceiling_alert_acks")
      .select("threshold, acked_by")
      .eq("year", CEILING_YEAR)
      .order("threshold");
    expect(data).toEqual([
      { threshold: 70, acked_by: owner.id },
      { threshold: 85, acked_by: owner.id },
      { threshold: 95, acked_by: admin.id },
    ]);
  });

  it("CEIL-4: a duplicate insert is refused; acks cannot be changed, deleted or forged", async () => {
    const duplicate = await owner.client
      .from("ceiling_alert_acks")
      .insert({ year: CEILING_YEAR, threshold: 70 });
    expect(duplicate.error?.code).toBe(UNIQUE_VIOLATION);
    const forged = await owner.client
      .from("ceiling_alert_acks")
      .insert({ year: CEILING_YEAR - 3, threshold: 70, acked_by: admin.id });
    expect(forged.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    const update = await owner.client
      .from("ceiling_alert_acks")
      .update({ threshold: 95 })
      .eq("year", CEILING_YEAR);
    expect(update.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    const removed = await admin.client.from("ceiling_alert_acks").delete().eq("year", CEILING_YEAR);
    expect(removed.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    const hundred = await owner.client
      .from("ceiling_alert_acks")
      .insert({ year: CEILING_YEAR, threshold: 100 });
    expect(hundred.error?.code).toBe(CHECK_VIOLATION);
    const rpc = await owner.client.rpc("acknowledge_ceiling_alert", {
      p_year: CEILING_YEAR,
      p_threshold: 100,
    });
    expect(rpc.error?.code).toBe("22023");
  });
});

describe("DASH-2..4 / CEIL-2: aggregations in the database", () => {
  it("DASH-2: a month's totals are exact, exclude soft-deleted rows and end on its last day", async () => {
    const data = await getDashboardData(
      owner.client,
      { kind: "month", month: `${YEAR}-03` },
      TODAY,
    );
    expect(data.period).toEqual({
      income: 9_999_999_999 + 1,
      expense: 40_000,
      previousIncome: 0,
      previousExpense: 0,
    });
    expect(data.categories).toEqual([
      expect.objectContaining({ id: categoryA, total: 30_000, count: 1 }),
      expect.objectContaining({ id: categoryB, total: 10_000, count: 1 }),
    ]);
  });

  it("DASH-2 / DASH-6: a year's totals stop at 31/12; 1/1 belongs to the next year and compares with it", async () => {
    const year = await getDashboardData(owner.client, { kind: "year", year: YEAR }, TODAY);
    expect(year.period.income).toBe(100 + 9_999_999_999 + 1 + 50_000);
    expect(year.period.expense).toBe(45_000);
    const next = await getDashboardData(owner.client, { kind: "year", year: NEXT_YEAR }, TODAY);
    expect(next.period).toEqual({
      income: 70_000,
      expense: 7_000,
      previousIncome: 100 + 9_999_999_999 + 1 + 50_000,
      previousExpense: 45_000,
    });
    const january = await getDashboardData(
      owner.client,
      { kind: "month", month: `${NEXT_YEAR}-01` },
      TODAY,
    );
    expect(january.period).toEqual({
      income: 70_000,
      expense: 7_000,
      previousIncome: 50_000,
      previousExpense: 5_000,
    });
  });

  it("DASH-3: the 12-month series ends with the month (or spans the year) and matches the totals", async () => {
    const january = await getDashboardData(
      owner.client,
      { kind: "month", month: `${NEXT_YEAR}-01` },
      TODAY,
    );
    expect(january.series.map((month) => month.month)).toEqual([
      "1908-02",
      "1908-03",
      "1908-04",
      "1908-05",
      "1908-06",
      "1908-07",
      "1908-08",
      "1908-09",
      "1908-10",
      "1908-11",
      "1908-12",
      "1909-01",
    ]);
    expect(january.series[1]).toEqual({
      month: "1908-03",
      income: 10_000_000_000,
      expense: 40_000,
    });
    expect(january.series[10]).toEqual({ month: "1908-12", income: 50_000, expense: 5_000 });
    const year = await getDashboardData(owner.client, { kind: "year", year: YEAR }, TODAY);
    expect(year.series[0]).toEqual({ month: "1908-01", income: 100, expense: 0 });
    expect(year.series[11].month).toBe("1908-12");
    expect(year.series.reduce((sum, month) => sum + month.income, 0)).toBe(year.period.income);
  });

  it("CEIL-2: turnover by received date, then by the receipt's issue date after the basis switch", async () => {
    await clearCeilingYear();
    await service.from("tax_year_settings").insert({ year: YEAR, exempt_ceiling: 100_000 });
    // The 31/12/1908 income's receipt was issued on 1/1/1909.
    const { data: lateIncome } = await service
      .from("incomes")
      .select("id")
      .eq("client_id", clientId)
      .eq("received_date", `${YEAR}-12-31`)
      .single();
    await service.from("documents").insert({
      income_id: lateIncome?.id,
      doc_number: `IT${randomUUID().slice(0, 8)}`,
      issued_date: `${NEXT_YEAR}-01-01`,
      url: "https://provider.example/receipt",
    });
    try {
      const byReceived = await getDashboardData(owner.client, { kind: "year", year: YEAR }, TODAY);
      expect(byReceived.ceiling).toEqual({
        year: YEAR,
        ceiling: 100_000,
        turnover: 100 + 9_999_999_999 + 1 + 50_000,
        basis: "received_date",
        acked: [],
      });

      await setBasis("receipt_date");
      const byReceipt = await getDashboardData(owner.client, { kind: "year", year: YEAR }, TODAY);
      expect(byReceipt.ceiling.basis).toBe("receipt_date");
      expect(byReceipt.ceiling.turnover).toBe(0);
      const nextByReceipt = await getDashboardData(
        owner.client,
        { kind: "year", year: NEXT_YEAR },
        TODAY,
      );
      expect(nextByReceipt.ceiling.turnover).toBe(50_000);
      // The period totals never depend on the basis.
      expect(byReceipt.period.income).toBe(100 + 9_999_999_999 + 1 + 50_000);

      // An invalid value counts as the SPEC default.
      await setBasis("bogus");
      const fallback = await getDashboardData(owner.client, { kind: "year", year: YEAR }, TODAY);
      expect(fallback.ceiling.basis).toBe("received_date");
    } finally {
      await setBasis("received_date");
    }
  });

  it("CEIL-6: a year without a ceiling returns null, never another year's ceiling", async () => {
    const data = await getDashboardData(owner.client, { kind: "year", year: NEXT_YEAR }, TODAY);
    expect(data.ceiling.ceiling).toBeNull();
    expect(data.isAdmin).toBe(false);
    const asAdmin = await getDashboardData(admin.client, { kind: "year", year: NEXT_YEAR }, TODAY);
    expect(asAdmin.isAdmin).toBe(true);
  });

  it("DASH-1: the function rejects a period that does not start on its first day", async () => {
    for (const [period, start] of [
      ["month", `${YEAR}-03-02`],
      ["year", `${YEAR}-02-01`],
      ["week", `${YEAR}-03-01`],
      ["month", "1899-12-01"],
    ]) {
      const { error } = await owner.client.rpc("dashboard_data", {
        p_period: period,
        p_period_start: start,
        p_today: TODAY,
      });
      expect(error?.code, `${period} ${start}`).toBe("22023");
    }
  });
});
