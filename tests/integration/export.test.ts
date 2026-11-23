import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EXPORT_PAGE_SIZE, exportPages } from "@/lib/export/queries";
import type { ExportKind, ExportRange } from "@/lib/export/range";

import {
  createAnonClient,
  createServiceRoleClient,
  createSignedInUser,
  deleteUser,
  testEmail,
  type TestUser,
} from "./support/local-supabase";

/**
 * M4.2: the export queries (EXPORT-1 / EXPORT-3): exactness for a date range (inclusive
 * bounds, soft-deleted rows left out, receipts joined, oldest first), keyset paging over more
 * than one page, and RLS. Uses the years 1912–1914, which no other test data uses.
 */

const MARKER = `it-export-${randomUUID()}`;
const YEAR = 1912;
const PAGING_YEAR = 1914;
const INSUFFICIENT_PRIVILEGE = "42501";
const EXPENSE_FILES_BUCKET = "expense-files";
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
/** More than one page, so paging is exercised; all inserted in one statement. */
const PAGING_ROWS = EXPORT_PAGE_SIZE + 7;

let service: SupabaseClient;
let anon: SupabaseClient;
let outsider: TestUser;
let owner: TestUser;
const createdUserIds: string[] = [];
let clientId: string;
let projectId: string;
let milestoneId: string;
let categoryId: string;
let filePath: string;

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

/** Ids per delete request: a long `in` list makes the request URI too long. */
const DELETE_CHUNK = 100;

/** Every expense of the test's category, read in pages (PostgREST returns 1000 at most). */
async function expenseIdsOfCategory(): Promise<string[]> {
  const ids: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await service
      .from("expenses")
      .select("id")
      .eq("category_id", categoryId)
      .order("id")
      .range(offset, offset + 999);
    if (error) {
      throw new Error("Could not list the test expenses", { cause: error });
    }
    ids.push(...data.map((row) => row.id as string));
    if (data.length < 1000) {
      return ids;
    }
  }
}

async function softDelete(table: string, id: string) {
  const { error } = await service
    .from(table)
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    throw new Error(`Could not soft-delete from ${table}`, { cause: error });
  }
}

async function collect(client: SupabaseClient, kind: ExportKind, range: ExportRange) {
  const pages: unknown[][] = [];
  for await (const page of exportPages(client, kind, range)) {
    pages.push(page);
  }
  return pages;
}

const range = { from: `${YEAR}-01-01`, to: `${YEAR}-12-31` };

beforeAll(async () => {
  service = await createServiceRoleClient();
  anon = await createAnonClient();
  outsider = await createSignedInUser(service, testEmail("export-outsider"));
  createdUserIds.push(outsider.id);
  owner = await createSignedInUser(service, testEmail("export-owner"));
  createdUserIds.push(owner.id);
  const { error } = await service
    .from("allowed_users")
    .insert({ email: owner.email, role: "owner" });
  if (error) {
    throw new Error("Could not allowlist the test user", { cause: error });
  }

  clientId = await insert("clients", { name: `כהן, "משה" ${MARKER}` });
  projectId = await insert("projects", { client_id: clientId, name: `=שיפוץ ${MARKER}` });
  milestoneId = await insert("milestones", {
    project_id: projectId,
    description: "מקדמה\nשורה שנייה",
    amount: 100_000,
    due_date: `${YEAR}-01-01`,
  });
  categoryId = await insert("expense_categories", { name: `ק ${MARKER.slice(-12)}` });
  filePath = `${randomUUID()}.jpg`;
  const upload = await service.storage
    .from(EXPENSE_FILES_BUCKET)
    .upload(filePath, JPEG_BYTES, { contentType: "image/jpeg" });
  if (upload.error) {
    throw new Error("Could not upload the test file", { cause: upload.error });
  }

  const income = (received_date: string, amount: number, extra: object = {}) =>
    insert("incomes", {
      client_id: clientId,
      received_date,
      amount,
      payment_method: "cash",
      ...extra,
    });
  // Inserted out of date order; same-day rows keep the order they were recorded in.
  await income(`${YEAR}-12-31`, 9_999_999_999, { payment_method: "credit_card" });
  const withReceipt = await income(`${YEAR}-01-01`, 1, {
    project_id: projectId,
    milestone_id: milestoneId,
    payment_method: "bank_transfer",
  });
  await income(`${YEAR}-06-15`, 50_000);
  await income(`${YEAR}-06-15`, 60_000, { project_id: projectId });
  await income(`${YEAR - 1}-12-31`, 111);
  await income(`${YEAR + 1}-01-01`, 222);
  await softDelete("incomes", await income(`${YEAR}-03-03`, 333));
  await insert("documents", {
    income_id: withReceipt,
    doc_number: "R-17/2",
    issued_date: `${YEAR}-01-02`,
    url: "https://provider.example/receipt",
  });

  const expense = (expense_date: string, amount: number, extra: object = {}) =>
    insert("expenses", {
      expense_date,
      amount,
      vendor: `ספק ${MARKER}`,
      category_id: categoryId,
      payment_method: "cash",
      ...extra,
    });
  await expense(`${YEAR}-12-31`, 9_999_999_999, { vendor: `-הנחה ${MARKER}` });
  await expense(`${YEAR}-01-01`, 1, { file_path: filePath, payment_method: "check" });
  await expense(`${YEAR - 1}-12-31`, 444);
  await expense(`${YEAR + 1}-01-01`, 555);
  await softDelete("expenses", await expense(`${YEAR}-05-05`, 666));

  // One statement: every row has the same created_at, so the id breaks the ties.
  const { error: pagingError } = await service.from("expenses").insert(
    Array.from({ length: PAGING_ROWS }, (_, index) => ({
      expense_date: `${PAGING_YEAR}-${index % 2 === 0 ? "03-01" : "02-01"}`,
      amount: index + 1,
      vendor: `דף ${MARKER}`,
      category_id: categoryId,
      payment_method: "cash",
    })),
  );
  if (pagingError) {
    throw new Error("Could not insert the paging rows", { cause: pagingError });
  }
});

afterAll(async () => {
  if (!service) {
    return;
  }
  const errors: unknown[] = [];
  const { data: incomes } = await service.from("incomes").select("id").eq("client_id", clientId);
  const incomeIds = (incomes ?? []).map((row) => row.id as string);
  const { data: documents } = await service
    .from("documents")
    .select("id")
    .in("income_id", incomeIds);
  const documentIds = (documents ?? []).map((row) => row.id as string);
  const expenseIds = await expenseIdsOfCategory();
  const results = [
    await service.from("documents").delete().in("income_id", incomeIds),
    await service
      .from("audit_log")
      .delete()
      .in("entity_id", [...incomeIds, ...documentIds]),
  ];
  for (let start = 0; start < expenseIds.length; start += DELETE_CHUNK) {
    const chunk = expenseIds.slice(start, start + DELETE_CHUNK);
    results.push(
      await service.from("recorded_expense_files").delete().in("expense_id", chunk),
      await service.from("audit_log").delete().in("entity_id", chunk),
      await service.from("expenses").delete().in("id", chunk),
    );
  }
  results.push(
    await service.from("incomes").delete().in("id", incomeIds),
    await service.from("expense_categories").delete().eq("id", categoryId),
    await service.from("milestones").delete().eq("project_id", projectId),
    await service.from("projects").delete().eq("id", projectId),
    await service.from("clients").delete().eq("id", clientId),
    await service.from("allowed_users").delete().eq("email", owner?.email),
  );
  errors.push(...results.map((result) => result.error).filter(Boolean));
  const removed = await service.storage.from(EXPENSE_FILES_BUCKET).remove([filePath]);
  if (removed.error) {
    errors.push(removed.error);
  }
  for (const id of createdUserIds) {
    await deleteUser(service, id);
  }
  expect(errors).toEqual([]);
});

describe("EXPORT-1 / EXPORT-3: export queries", () => {
  it("EXPORT-1 / EXPORT-3: incomes of the range, inclusive, oldest first, soft-deleted excluded, receipts joined", async () => {
    const pages = await collect(owner.client, "incomes", range);
    expect(pages).toEqual([
      [
        {
          received_date: `${YEAR}-01-01`,
          client_name: `כהן, "משה" ${MARKER}`,
          project_name: `=שיפוץ ${MARKER}`,
          milestone_description: "מקדמה\nשורה שנייה",
          amount: 1,
          payment_method: "bank_transfer",
          receipt_number: "R-17/2",
          receipt_date: `${YEAR}-01-02`,
        },
        {
          received_date: `${YEAR}-06-15`,
          client_name: `כהן, "משה" ${MARKER}`,
          project_name: null,
          milestone_description: null,
          amount: 50_000,
          payment_method: "cash",
          receipt_number: null,
          receipt_date: null,
        },
        {
          received_date: `${YEAR}-06-15`,
          client_name: `כהן, "משה" ${MARKER}`,
          project_name: `=שיפוץ ${MARKER}`,
          milestone_description: null,
          amount: 60_000,
          payment_method: "cash",
          receipt_number: null,
          receipt_date: null,
        },
        {
          received_date: `${YEAR}-12-31`,
          client_name: `כהן, "משה" ${MARKER}`,
          project_name: null,
          milestone_description: null,
          amount: 9_999_999_999,
          payment_method: "credit_card",
          receipt_number: null,
          receipt_date: null,
        },
      ],
    ]);
  });

  it("EXPORT-1 / EXPORT-3: expenses of the range, inclusive, oldest first, soft-deleted excluded, document flag", async () => {
    const pages = await collect(owner.client, "expenses", range);
    expect(pages).toEqual([
      [
        {
          expense_date: `${YEAR}-01-01`,
          vendor: `ספק ${MARKER}`,
          category_name: `ק ${MARKER.slice(-12)}`,
          amount: 1,
          payment_method: "check",
          has_file: true,
        },
        {
          expense_date: `${YEAR}-12-31`,
          vendor: `-הנחה ${MARKER}`,
          category_name: `ק ${MARKER.slice(-12)}`,
          amount: 9_999_999_999,
          payment_method: "cash",
          has_file: false,
        },
      ],
    ]);
  });

  it("EXPORT-1: a one-day range holds exactly that day", async () => {
    const pages = await collect(owner.client, "incomes", {
      from: `${YEAR}-06-15`,
      to: `${YEAR}-06-15`,
    });
    expect(pages.flat()).toHaveLength(2);
  });

  it("EXPORT-1: an empty range yields no pages", async () => {
    expect(
      await collect(owner.client, "incomes", { from: "1913-02-01", to: "1913-02-28" }),
    ).toEqual([]);
  });

  it("criterion 5: more than one page: every row exactly once, in date order, pages bounded", async () => {
    const pages = await collect(owner.client, "expenses", {
      from: `${PAGING_YEAR}-01-01`,
      to: `${PAGING_YEAR}-12-31`,
    });
    expect(pages.length).toBeGreaterThanOrEqual(2);
    for (const page of pages) {
      expect(page.length).toBeLessThanOrEqual(EXPORT_PAGE_SIZE);
    }
    const rows = pages.flat() as { expense_date: string; amount: number }[];
    expect(rows).toHaveLength(PAGING_ROWS);
    expect(new Set(rows.map((row) => row.amount)).size).toBe(PAGING_ROWS);
    const dates = rows.map((row) => row.expense_date);
    expect(dates).toEqual([...dates].sort());
    expect(dates.filter((date) => date === `${PAGING_YEAR}-02-01`)).toHaveLength(
      Math.floor(PAGING_ROWS / 2),
    );
  });

  it("criterion 5: the database caps a page at 1000 rows whatever the caller asks", async () => {
    const { data, error } = await owner.client.rpc("export_expenses", {
      p_from: `${PAGING_YEAR}-01-01`,
      p_to: `${PAGING_YEAR}-12-31`,
      p_limit: 5000,
    });
    expect(error).toBeNull();
    expect(data).toHaveLength(1000);
  });
});

describe("AUTH-4 / criterion 4: export RLS", () => {
  it("AUTH-4: anon cannot call the export functions", async () => {
    for (const fn of ["export_incomes", "export_expenses"]) {
      const { error } = await anon.rpc(fn, { p_from: range.from, p_to: range.to });
      expect(error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    }
  });

  it("AUTH-4: a signed-in account outside the allowlist exports nothing", async () => {
    expect(await collect(outsider.client, "incomes", range)).toEqual([]);
    expect(await collect(outsider.client, "expenses", range)).toEqual([]);
  });
});
