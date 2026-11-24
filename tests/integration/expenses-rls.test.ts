import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { todayInJerusalem } from "@/lib/dates";
import {
  createExpenseCategory,
  listExpenseCategories,
  moveExpenseCategory,
  renameExpenseCategory,
  setExpenseCategoryArchived,
} from "@/lib/expense-categories/queries";
import { EXPENSE_FILES_BUCKET } from "@/lib/expenses/file";
import {
  getExpense,
  getExpensesSummary,
  insertExpense,
  listExpenses,
  softDeleteExpense,
  updateExpense,
} from "@/lib/expenses/queries";
import type { ExpenseInput } from "@/lib/expenses/schema";
import {
  checkUploadedExpenseFile,
  createExpenseFileViewUrl,
  createExpenseUpload,
} from "@/lib/expenses/storage";

import {
  createAnonClient,
  createServiceRoleClient,
  createSignedInUser,
  deleteUser,
  testEmail,
  type TestUser,
} from "./support/local-supabase";
import { runPsqlSession } from "./support/psql-session";

const TABLE = "expenses";
const CATEGORIES = "expense_categories";
const INSUFFICIENT_PRIVILEGE = "42501";
const CHECK_VIOLATION = "23514";
const FOREIGN_KEY_VIOLATION = "23503";
const MARKER = `it-expenses-${randomUUID()}`;
/** A month no other test data uses, for the list and summary checks. */
const LIST_MONTH = "1901-03";

const SEEDED_CATEGORIES = [
  "תוכנות ורישיונות",
  "רכב ונסיעות",
  "שיווק ופרסום",
  "דוגמאות וחומרים",
  "הדפסות",
  "ציוד משרדי",
  "תקשורת",
  "השתלמויות",
  "ביטוח",
  "שירותים מקצועיים",
  "קבלני משנה (הדמיות)",
  "אחר",
];

const PDF_BYTES = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
const JPEG_BYTES = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

type ExpenseRow = {
  id: string;
  expense_date: string;
  amount: number;
  vendor: string;
  category_id: string;
  payment_method: string;
  notes: string | null;
  file_path: string | null;
  deleted_at: string | null;
  created_by: string | null;
};

type AuditRow = {
  actor: string | null;
  entity: string;
  action: string;
  diff: Record<string, unknown>;
};

let service: SupabaseClient;
let anon: SupabaseClient;
let outsider: TestUser;
let owner: TestUser;
let admin: TestUser;
const createdUserIds: string[] = [];
/** A seeded, active category the expenses of these tests use. */
let categoryId: string;

/** An ISO date `days` from today in Asia/Jerusalem. */
function isoDaysFromToday(days: number): string {
  const [year, month, day] = todayInJerusalem().split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function expenseInput(fields: Partial<ExpenseInput> = {}): ExpenseInput {
  return {
    expense_date: todayInJerusalem(),
    amount: 35_090,
    vendor: `ספק ${MARKER}`,
    category_id: categoryId,
    payment_method: "credit_card",
    notes: null,
    ...fields,
  };
}

/** Inserts an expense as the service role and returns its id. */
async function insertAsService(fields: Partial<ExpenseInput & { file_path: string }> = {}) {
  const { data, error } = await service
    .from(TABLE)
    .insert(expenseInput(fields))
    .select("id")
    .single<{ id: string }>();
  if (error) {
    throw new Error("Could not insert a test expense", { cause: error });
  }
  return data.id;
}

/** Inserts an expense as `client` (through the app's query) and returns its id. */
async function insertAs(client: SupabaseClient, fields: Partial<ExpenseInput> = {}, file?: string) {
  const vendor = fields.vendor ?? `ספק ${MARKER} ${randomUUID()}`;
  const result = await insertExpense(client, expenseInput({ ...fields, vendor }), file ?? null);
  if (result.status !== "saved") {
    throw new Error(`Could not insert a test expense: ${JSON.stringify(result)}`);
  }
  const { data } = await service.from(TABLE).select("id").eq("vendor", vendor).single();
  return (data as { id: string }).id;
}

async function readExpense(id: string): Promise<ExpenseRow> {
  const { data, error } = await service.from(TABLE).select().eq("id", id).single<ExpenseRow>();
  if (error) {
    throw new Error("Could not read the expense", { cause: error });
  }
  return data;
}

async function newCategory(label = "קטגוריה"): Promise<string> {
  const { data, error } = await service
    .from(CATEGORIES)
    .insert({ name: `${label} ${MARKER.slice(-12)} ${randomUUID().slice(0, 8)}` })
    .select("id")
    .single<{ id: string }>();
  if (error) {
    throw new Error("Could not insert a test category", { cause: error });
  }
  return data.id;
}

/** Uploads bytes as `client` through a signed upload URL for a new path of that type. */
async function upload(
  client: SupabaseClient,
  type: "image/jpeg" | "image/png" | "application/pdf" = "image/jpeg",
  bytes: Uint8Array = type === "application/pdf"
    ? PDF_BYTES
    : type === "image/png"
      ? PNG_BYTES
      : JPEG_BYTES,
) {
  const { path, token } = await createExpenseUpload(client, type);
  const { error } = await client.storage
    .from(EXPENSE_FILES_BUCKET)
    .uploadToSignedUrl(path, token, new Blob([bytes as BlobPart], { type }));
  if (error) {
    throw new Error("Could not upload a test file", { cause: error });
  }
  return path;
}

async function objectExists(path: string): Promise<boolean> {
  const { data } = await service.storage.from(EXPENSE_FILES_BUCKET).exists(path);
  return data;
}

async function auditOf(id: string): Promise<AuditRow[]> {
  const { data, error } = await service
    .from("audit_log")
    .select("actor, entity, action, diff")
    .eq("entity_id", id)
    .order("created_at");
  if (error) {
    throw new Error("Could not read the audit log", { cause: error });
  }
  return data as AuditRow[];
}

const uploadedPaths: string[] = [];

beforeAll(async () => {
  service = await createServiceRoleClient();
  anon = await createAnonClient();
  outsider = await createSignedInUser(service, testEmail("expenses-outsider"));
  createdUserIds.push(outsider.id);
  owner = await createSignedInUser(service, testEmail("expenses-owner"));
  createdUserIds.push(owner.id);
  admin = await createSignedInUser(service, testEmail("expenses-admin"));
  createdUserIds.push(admin.id);
  const { error } = await service.from("allowed_users").insert([
    { email: owner.email, role: "owner" },
    { email: admin.email, role: "admin" },
  ]);
  if (error) {
    throw new Error("Could not allowlist the test users", { cause: error });
  }
  const { data } = await service.from(CATEGORIES).select("id").eq("name", "הדפסות").single();
  categoryId = (data as { id: string }).id;
});

afterAll(async () => {
  if (!service) {
    return;
  }
  const cleanupErrors: unknown[] = [];
  const { data: expenses } = await service
    .from(TABLE)
    .select("id, file_path")
    .like("vendor", `%${MARKER}%`);
  const expenseIds = (expenses ?? []).map((row) => row.id as string);
  const { data: categories } = await service
    .from(CATEGORIES)
    .select("id")
    .like("name", `%${MARKER.slice(-12)}%`);
  const categoryIds = (categories ?? []).map((row) => row.id as string);
  // Expenses of the marked categories that another vendor name may hold.
  if (categoryIds.length > 0) {
    const { data: more } = await service.from(TABLE).select("id").in("category_id", categoryIds);
    expenseIds.push(...(more ?? []).map((row) => row.id as string));
  }
  if (expenseIds.length > 0) {
    const recorded = await service
      .from("recorded_expense_files")
      .delete()
      .in("expense_id", expenseIds);
    const audit = await service.from("audit_log").delete().in("entity_id", expenseIds);
    const removed = await service.from(TABLE).delete().in("id", expenseIds);
    cleanupErrors.push(...[recorded.error, audit.error, removed.error].filter(Boolean));
  }
  if (uploadedPaths.length > 0) {
    const removedFiles = await service.storage.from(EXPENSE_FILES_BUCKET).remove(uploadedPaths);
    cleanupErrors.push(...[removedFiles.error].filter(Boolean));
  }
  if (categoryIds.length > 0) {
    const removedCategories = await service.from(CATEGORIES).delete().in("id", categoryIds);
    cleanupErrors.push(...[removedCategories.error].filter(Boolean));
  }
  const allowlist = await service
    .from("allowed_users")
    .delete()
    .in("email", [owner?.email, admin?.email].filter(Boolean));
  cleanupErrors.push(...[allowlist.error].filter(Boolean));
  for (const userId of createdUserIds) {
    try {
      await deleteUser(service, userId);
    } catch (deleteError) {
      cleanupErrors.push(deleteError);
    }
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, "Could not clean up integration test data");
  }
});

/** Uploads as the owner and remembers the path for cleanup. */
async function uploadTracked(
  type?: "image/jpeg" | "image/png" | "application/pdf",
  bytes?: Uint8Array,
) {
  const path = await upload(owner.client, type, bytes);
  uploadedPaths.push(path);
  return path;
}

describe("EXP-1: anon and users outside the allowlist", () => {
  it("EXP-1 / AUTH-4: anon cannot read or write expenses or categories, call the functions or reach the bucket", async () => {
    const path = await uploadTracked();
    const id = await insertAsService({ file_path: path });

    const reads = await Promise.all([
      anon.from(TABLE).select(),
      anon.from(CATEGORIES).select(),
      anon.from("recorded_expense_files").select(),
    ]);
    const insert = await anon.from(TABLE).insert(expenseInput());
    const update = await anon.from(TABLE).update({ amount: 1 }).eq("id", id);
    const rpcs = await Promise.all([
      anon.rpc("list_expenses", { p_month: `${LIST_MONTH}-01` }),
      anon.rpc("expenses_summary", { p_month: `${LIST_MONTH}-01` }),
      anon.rpc("move_expense_category", { p_category_id: categoryId, p_direction: "up" }),
      anon.rpc("expense_file_was_recorded", { p_path: path }),
    ]);
    const download = await anon.storage.from(EXPENSE_FILES_BUCKET).download(path);
    const sign = await anon.storage
      .from(EXPENSE_FILES_BUCKET)
      .createSignedUploadUrl(`${randomUUID()}.jpg`);

    expect(reads.map((result) => result.error?.code)).toEqual(
      Array(3).fill(INSUFFICIENT_PRIVILEGE),
    );
    expect(insert.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(update.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(rpcs.map((result) => result.error?.code)).toEqual(Array(4).fill(INSUFFICIENT_PRIVILEGE));
    expect(download.data).toBeNull();
    expect(sign.data).toBeNull();
    expect((await readExpense(id)).amount).toBe(35_090);
  });

  it("EXP-1 / AUTH-4: a signed-in user outside the allowlist sees nothing and cannot write, upload or read files", async () => {
    const path = await uploadTracked();
    const id = await insertAsService({ file_path: path });

    const select = await outsider.client.from(TABLE).select().eq("id", id);
    const categories = await outsider.client.from(CATEGORIES).select();
    const insert = await outsider.client.from(TABLE).insert(expenseInput());
    const update = await outsider.client.from(TABLE).update({ amount: 1 }).eq("id", id).select();
    const addCategory = await outsider.client.from(CATEGORIES).insert({ name: `x ${MARKER}` });
    const archive = await outsider.client
      .from(CATEGORIES)
      .update({ archived_at: new Date().toISOString() })
      .eq("id", categoryId)
      .select();
    const move = await outsider.client.rpc("move_expense_category", {
      p_category_id: categoryId,
      p_direction: "down",
    });
    const list = await outsider.client.rpc("list_expenses", { p_month: todayInJerusalem() });
    const audit = await outsider.client.from("audit_log").select().eq("entity", "expenses");
    const download = await outsider.client.storage.from(EXPENSE_FILES_BUCKET).download(path);
    const signView = await outsider.client.storage
      .from(EXPENSE_FILES_BUCKET)
      .createSignedUrl(path, 60);
    const signUpload = await outsider.client.storage
      .from(EXPENSE_FILES_BUCKET)
      .createSignedUploadUrl(`${randomUUID()}.jpg`);
    const remove = await outsider.client.storage.from(EXPENSE_FILES_BUCKET).remove([path]);
    const recorded = await outsider.client.rpc("expense_file_was_recorded", { p_path: path });

    expect(select.data).toEqual([]);
    expect(categories.data).toEqual([]);
    expect(insert.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(update.data).toEqual([]);
    expect(addCategory.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(archive.data).toEqual([]);
    expect(move.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(list.data).toEqual([]);
    expect(audit.data).toEqual([]);
    expect(download.data).toBeNull();
    expect(signView.data).toBeNull();
    expect(signUpload.data).toBeNull();
    expect(remove.data ?? []).toEqual([]);
    expect(recorded.data).toBe(false);
    expect(await objectExists(path)).toBe(true);
    expect((await readExpense(id)).amount).toBe(35_090);
  });
});

for (const role of ["owner", "admin"] as const) {
  const user = () => (role === "owner" ? owner : admin);

  describe(`EXP-1: ${role}`, () => {
    it(`EXP-1 / EXP-6: ${role} records an expense without a file (missing document) and reads it`, async () => {
      const id = await insertAs(user().client, { notes: "הערה" });

      expect(await readExpense(id)).toMatchObject({
        amount: 35_090,
        category_id: categoryId,
        payment_method: "credit_card",
        notes: "הערה",
        file_path: null,
        deleted_at: null,
        created_by: user().id,
      });
      expect(await getExpense(user().client, id)).toMatchObject({
        category_name: "הדפסות",
        category_archived: false,
        file_path: null,
      });
    });

    it(`EXP-2: ${role} records an expense with an uploaded file and opens it with a short-lived signed URL`, async () => {
      const path = await upload(user().client, "application/pdf");
      uploadedPaths.push(path);
      const id = await insertAs(user().client, {}, path);

      expect((await readExpense(id)).file_path).toBe(path);
      const url = await createExpenseFileViewUrl(user().client, path);
      expect(url).toContain(`/object/sign/${EXPENSE_FILES_BUCKET}/${path}`);
      const response = await fetch(url);
      expect(response.status).toBe(200);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(PDF_BYTES);
    });

    it(`EXP-3: ${role} adds, renames, moves, archives and restores categories`, async () => {
      const name = `חדשה ${MARKER.slice(-12)} ${role}`;
      expect(await createExpenseCategory(user().client, { name })).toEqual({ status: "saved" });
      const all = await listExpenseCategories(user().client);
      const added = all.find((category) => category.name === name);
      expect(added).toBeDefined();
      expect(all.at(-1)?.id).toBe(added!.id);

      const renamed = `${name} שונתה`;
      expect(await renameExpenseCategory(user().client, added!.id, { name: renamed })).toEqual({
        status: "saved",
      });
      const moved = await moveExpenseCategory(user().client, added!.id, "up");
      expect(moved).toMatchObject({ status: "moved" });
      expect(await setExpenseCategoryArchived(user().client, added!.id, true)).toBe("updated");
      expect(await setExpenseCategoryArchived(user().client, added!.id, false)).toBe("updated");
      const { data } = await service
        .from(CATEGORIES)
        .select("name, archived_at")
        .eq("id", added!.id)
        .single();
      expect(data).toEqual({ name: renamed, archived_at: null });
    });
  });
}

describe("SPEC 6: no physical delete, soft delete and audit", () => {
  it("SPEC 6: users have no DELETE on expenses, categories or recorded files", async () => {
    const id = await insertAs(owner.client);

    const expense = await owner.client.from(TABLE).delete().eq("id", id);
    const category = await owner.client.from(CATEGORIES).delete().eq("id", categoryId);
    const recorded = await owner.client
      .from("recorded_expense_files")
      .delete()
      .eq("expense_id", id);

    expect(expense.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(category.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(recorded.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect((await readExpense(id)).deleted_at).toBeNull();
  });

  it("SPEC 6: a soft delete is stamped by the database, leaves the lists and can no longer be changed", async () => {
    const vendor = `נמחק ${MARKER}`;
    const id = await insertAs(owner.client, { vendor, expense_date: `${LIST_MONTH}-05` });

    expect(await softDeleteExpense(owner.client, id)).toBe("deleted");
    const stamp = (await readExpense(id)).deleted_at;
    expect(stamp).not.toBeNull();
    expect(Math.abs(Date.parse(stamp!) - Date.now())).toBeLessThan(60_000);

    const forged = await owner.client
      .from(TABLE)
      .update({ deleted_at: "2000-01-01T00:00:00Z", amount: 1 })
      .eq("id", id)
      .select();
    expect(forged.data).toEqual([]);
    expect(await softDeleteExpense(owner.client, id)).toBe("not_found");
    expect(await getExpense(owner.client, id)).toBeNull();
    expect(await updateExpense(owner.client, id, expenseInput({ vendor }), null)).toEqual({
      status: "not_found",
    });
    const filter = { month: LIST_MONTH, categoryId: null, vendor, missingDocument: false };
    expect((await listExpenses(owner.client, filter, 0)).items).toEqual([]);
    expect(await getExpensesSummary(owner.client, filter)).toEqual({ count: 0, total: 0 });
    expect((await readExpense(id)).amount).toBe(35_090);
  });

  it("SPEC 6: a forged deletion time is replaced with the database's time", async () => {
    const id = await insertAs(owner.client);

    await owner.client.from(TABLE).update({ deleted_at: "2000-01-01T00:00:00Z" }).eq("id", id);

    expect(Date.parse((await readExpense(id)).deleted_at!)).toBeGreaterThan(Date.now() - 60_000);
  });

  it("audit_log: insert, update and soft delete are recorded with the actor and the changed fields; notes only as changed", async () => {
    const path = await uploadTracked();
    const id = await insertAs(owner.client, { notes: "פרטי לקוח פרטיים" });
    const vendor = (await readExpense(id)).vendor;

    await updateExpense(
      admin.client,
      id,
      expenseInput({ vendor, amount: 50_000, notes: "אחר" }),
      path,
    );
    await updateExpense(
      admin.client,
      id,
      expenseInput({ vendor, amount: 50_000, notes: "אחר" }),
      null,
    );
    await softDeleteExpense(owner.client, id);

    const audit = await auditOf(id);
    expect(audit.map(({ actor, entity, action }) => ({ actor, entity, action }))).toEqual([
      { actor: owner.id, entity: "expenses", action: "insert" },
      { actor: admin.id, entity: "expenses", action: "update" },
      { actor: owner.id, entity: "expenses", action: "delete" },
    ]);
    expect(audit[0].diff).toMatchObject({
      amount: { new: 35_090 },
      vendor: { new: vendor },
      category_id: { new: categoryId },
      payment_method: { new: "credit_card" },
      notes: { changed: true },
    });
    expect(audit[0].diff).not.toHaveProperty("file_path");
    expect(JSON.stringify(audit)).not.toContain("פרטי לקוח");
    expect(audit[1].diff).toEqual({
      amount: { old: 35_090, new: 50_000 },
      notes: { changed: true },
      file_path: { old: null, new: path },
    });
    expect(Object.keys(audit[2].diff)).toEqual(["deleted_at"]);
  });
});

describe("EXP-1 / owner decisions: what the database refuses", () => {
  it("owner decision (M3): an amount of 0 or less, or above the maximum, is refused", async () => {
    for (const amount of [0, -100, 10_000_000_000]) {
      const result = await owner.client.from(TABLE).insert(expenseInput({ amount }));
      expect(result.error?.code).toBe(CHECK_VIOLATION);
    }
  });

  it("owner decision (M3): a future date is refused (HKE01); today is accepted; an old date stays editable", async () => {
    expect(
      await insertExpense(owner.client, expenseInput({ expense_date: isoDaysFromToday(1) }), null),
    ).toEqual({
      status: "refused",
      refusal: "date_in_future",
    });
    const id = await insertAs(owner.client, { expense_date: todayInJerusalem() });
    const vendor = (await readExpense(id)).vendor;
    expect(
      await updateExpense(
        owner.client,
        id,
        expenseInput({ vendor, expense_date: isoDaysFromToday(1) }),
        null,
      ),
    ).toEqual({ status: "refused", refusal: "date_in_future" });
  });

  it("EXP-1: vendor, payment method, notes and file path keep their rules", async () => {
    const results = await Promise.all([
      owner.client.from(TABLE).insert(expenseInput({ vendor: " " })),
      owner.client.from(TABLE).insert(expenseInput({ vendor: "א".repeat(121) })),
      owner.client.from(TABLE).insert(expenseInput({ payment_method: "paypal" as "cash" })),
      owner.client.from(TABLE).insert(expenseInput({ notes: " x" })),
      owner.client.from(TABLE).insert({ ...expenseInput(), file_path: "דנה-כהן.jpg" }),
      owner.client.from(TABLE).insert({ ...expenseInput(), file_path: `${randomUUID()}.gif` }),
    ]);
    // The file checks run first (a BEFORE trigger): no such object is in the bucket.
    expect(results.map((result) => result.error?.code)).toEqual([
      ...Array(4).fill(CHECK_VIOLATION),
      "HKE03",
      "HKE03",
    ]);
  });

  it("EXP-5: expenses have no project link", async () => {
    const result = await owner.client
      .from(TABLE)
      .insert({ ...expenseInput(), project_id: randomUUID() });
    expect(result.error).not.toBeNull();
    const { data } = await service.from(TABLE).select().limit(1);
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      expect(row).not.toHaveProperty("project_id");
      expect(row).not.toHaveProperty("client_id");
    }
  });

  it("EXP-1: id, created_by, created_at and updated_at are set by the database", async () => {
    const result = await owner.client
      .from(TABLE)
      .insert({ ...expenseInput(), id: randomUUID(), created_by: admin.id });
    expect(result.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });
});

describe("EXP-3 / owner decision: categories", () => {
  it("EXP-3: the 12 seeded categories exist in the SPEC order", async () => {
    const all = await listExpenseCategories(owner.client);
    const seeded = all.filter((category) => SEEDED_CATEGORIES.includes(category.name));
    expect(seeded.map((category) => category.name)).toEqual(SEEDED_CATEGORIES);
  });

  it("owner decision: an archived category is refused for a new expense (HKE02) and for a change of category", async () => {
    const archived = await newCategory("ארכיון");
    const id = await insertAs(owner.client);
    const vendor = (await readExpense(id)).vendor;
    await setExpenseCategoryArchived(owner.client, archived, true);

    expect(
      await insertExpense(owner.client, expenseInput({ category_id: archived }), null),
    ).toEqual({
      status: "refused",
      refusal: "category_archived",
    });
    expect(
      await updateExpense(owner.client, id, expenseInput({ vendor, category_id: archived }), null),
    ).toEqual({ status: "refused", refusal: "category_archived" });
  });

  it("owner decision: an expense keeps its category after the category is archived, and stays editable", async () => {
    const category = await newCategory("נשארת");
    const id = await insertAs(owner.client, { category_id: category });
    const vendor = (await readExpense(id)).vendor;
    await setExpenseCategoryArchived(owner.client, category, true);

    expect(
      await updateExpense(
        owner.client,
        id,
        expenseInput({ vendor, category_id: category, amount: 777 }),
        null,
      ),
    ).toMatchObject({ status: "saved" });
    expect(await getExpense(owner.client, id)).toMatchObject({
      amount: 777,
      category_id: category,
      category_archived: true,
    });
  });

  it("owner decision: a category with expenses is never deleted, not even by the service role", async () => {
    const category = await newCategory("עם הוצאות");
    await insertAs(owner.client, { category_id: category });

    const removed = await service.from(CATEGORIES).delete().eq("id", category);

    expect(removed.error?.code).toBe(FOREIGN_KEY_VIOLATION);
  });

  it("EXP-3: a category name is unique, trimmed and at most 50 characters", async () => {
    expect(await createExpenseCategory(owner.client, { name: "הדפסות" })).toEqual({
      status: "refused",
      refusal: "name_taken",
    });
    const bad = await Promise.all([
      owner.client.from(CATEGORIES).insert({ name: " רווח" }),
      owner.client.from(CATEGORIES).insert({ name: "א".repeat(51) }),
      owner.client.from(CATEGORIES).insert({ name: "" }),
    ]);
    expect(bad.map((result) => result.error?.code)).toEqual(Array(3).fill(CHECK_VIOLATION));
    const renamed = await renameExpenseCategory(owner.client, await newCategory(), { name: "אחר" });
    expect(renamed).toEqual({ status: "refused", refusal: "name_taken" });
  });

  it("EXP-3: the archive time is set by the database and kept when archived again", async () => {
    const category = await newCategory();
    await owner.client
      .from(CATEGORIES)
      .update({ archived_at: "2000-01-01T00:00:00Z" })
      .eq("id", category);
    const first = await service.from(CATEGORIES).select("archived_at").eq("id", category).single();
    const stamp = (first.data as { archived_at: string }).archived_at;
    expect(Date.parse(stamp)).toBeGreaterThan(Date.now() - 60_000);

    await owner.client
      .from(CATEGORIES)
      .update({ archived_at: new Date().toISOString() })
      .eq("id", category);
    const second = await service.from(CATEGORIES).select("archived_at").eq("id", category).single();
    expect((second.data as { archived_at: string }).archived_at).toBe(stamp);
  });

  it("EXP-3: users cannot set the order directly; moves swap with the active neighbour and report the place", async () => {
    const direct = await owner.client
      .from(CATEGORIES)
      .update({ sort_order: 1 })
      .eq("id", categoryId);
    expect(direct.error?.code).toBe(INSUFFICIENT_PRIVILEGE);

    const first = await newCategory("א");
    const archivedBetween = await newCategory("ב");
    const last = await newCategory("ג");
    await setExpenseCategoryArchived(owner.client, archivedBetween, true);
    const activeCount = (await listExpenseCategories(owner.client)).filter(
      (c) => !c.archived,
    ).length;

    expect(await moveExpenseCategory(owner.client, last, "down")).toEqual({
      status: "edge",
      place: activeCount,
      total: activeCount,
    });
    expect(await moveExpenseCategory(owner.client, last, "up")).toEqual({
      status: "moved",
      place: activeCount - 1,
      total: activeCount,
    });
    const order = (await listExpenseCategories(owner.client))
      .filter((category) => !category.archived)
      .map((category) => category.id);
    expect(order.slice(-2)).toEqual([last, first]);
    expect(await moveExpenseCategory(owner.client, archivedBetween, "up")).toEqual({
      status: "not_found",
    });
    expect(await moveExpenseCategory(owner.client, randomUUID(), "up")).toEqual({
      status: "not_found",
    });
  });

  it("EXP-3: two moves at once are serialized; the order stays a permutation", async () => {
    const a = await newCategory("מקביל-א");
    const b = await newCategory("מקביל-ב");
    const before = await service.from(CATEGORIES).select("sort_order").order("sort_order");

    await Promise.all([
      moveExpenseCategory(owner.client, b, "up"),
      moveExpenseCategory(admin.client, a, "up"),
      moveExpenseCategory(owner.client, b, "up"),
    ]);

    const after = await service.from(CATEGORIES).select("sort_order").order("sort_order");
    expect((after.data ?? []).map((row) => row.sort_order)).toEqual(
      (before.data ?? []).map((row) => row.sort_order),
    );
  });

  it("EXP-3: at most 100 categories (HKC01)", async () => {
    const { count } = await service.from(CATEGORIES).select("id", { count: "exact", head: true });
    const missing = 100 - (count ?? 0);
    const names = Array.from({ length: missing }, (_, index) => ({
      name: `מילוי ${MARKER.slice(-12)} ${index}`,
    }));
    if (names.length > 0) {
      const filled = await service.from(CATEGORIES).insert(names);
      expect(filled.error).toBeNull();
    }

    expect(
      await createExpenseCategory(owner.client, { name: `נוספת ${MARKER.slice(-12)}` }),
    ).toEqual({
      status: "refused",
      refusal: "too_many",
    });

    const { data: fillers } = await service
      .from(CATEGORIES)
      .select("id")
      .like("name", `מילוי ${MARKER.slice(-12)}%`);
    await service
      .from(CATEGORIES)
      .delete()
      .in(
        "id",
        (fillers ?? []).map((row) => row.id as string),
      );
  });
});

describe("EXP-2: the expense-files bucket", () => {
  it("EXP-2: uploads go to a random name of an allowed type; other names and types are refused", async () => {
    const piiName = await owner.client.storage
      .from(EXPENSE_FILES_BUCKET)
      .upload(`דנה-כהן.jpg`, new Blob([JPEG_BYTES], { type: "image/jpeg" }));
    const nested = await owner.client.storage
      .from(EXPENSE_FILES_BUCKET)
      .upload(
        `${randomUUID()}/${randomUUID()}.jpg`,
        new Blob([JPEG_BYTES], { type: "image/jpeg" }),
      );
    const gif = await owner.client.storage
      .from(EXPENSE_FILES_BUCKET)
      .upload(`${randomUUID()}.jpg`, new Blob([JPEG_BYTES], { type: "image/gif" }));

    expect(piiName.error).not.toBeNull();
    expect(nested.error).not.toBeNull();
    expect(gif.error).not.toBeNull();
  });

  it("EXP-2 / SPEC 10: a file over 10MB is refused by the bucket", async () => {
    const { path, token } = await createExpenseUpload(owner.client, "application/pdf");
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    big.set(PDF_BYTES);
    const { error } = await owner.client.storage
      .from(EXPENSE_FILES_BUCKET)
      .uploadToSignedUrl(path, token, new Blob([big], { type: "application/pdf" }));

    expect(error).not.toBeNull();
    expect(await objectExists(path)).toBe(false);
  });

  it("EXP-2: the server check accepts real JPEG, PNG and PDF bytes and refuses a mismatch", async () => {
    for (const type of ["image/jpeg", "image/png", "application/pdf"] as const) {
      expect(await checkUploadedExpenseFile(owner.client, await uploadTracked(type))).toEqual({
        status: "ok",
      });
    }
    const pngAsJpeg = await uploadTracked("image/jpeg", PNG_BYTES);
    expect(await checkUploadedExpenseFile(owner.client, pngAsJpeg)).toEqual({
      status: "invalid",
      error: "not_matching",
    });
    expect(await checkUploadedExpenseFile(owner.client, `${randomUUID()}.jpg`)).toEqual({
      status: "missing",
    });
  });

  it("EXP-2: an expense can only record a file that is in the bucket (HKE03), and one file belongs to one expense", async () => {
    expect(await insertExpense(owner.client, expenseInput(), `${randomUUID()}.jpg`)).toEqual({
      status: "refused",
      refusal: "file_missing",
    });
    const path = await uploadTracked();
    await insertAs(owner.client, {}, path);
    expect(await insertExpense(owner.client, expenseInput(), path)).toEqual({
      status: "refused",
      refusal: "file_missing",
    });
  });

  it("M7.1-9: a file an expense replaced cannot be recorded by another expense (HKE04); its own expense may take it back", async () => {
    const first = await uploadTracked();
    const second = await uploadTracked();
    const id = await insertAs(owner.client, {}, first);
    const vendor = (await readExpense(id)).vendor;
    await updateExpense(owner.client, id, expenseInput({ vendor }), second);

    expect(await insertExpense(owner.client, expenseInput(), first)).toEqual({
      status: "refused",
      refusal: "file_missing",
    });
    const other = await insertAs(owner.client);
    const otherVendor = (await readExpense(other)).vendor;
    expect(
      await updateExpense(owner.client, other, expenseInput({ vendor: otherVendor }), first),
    ).toEqual({ status: "refused", refusal: "file_missing" });
    const direct = await owner.client.from(TABLE).insert({ ...expenseInput(), file_path: first });
    expect(direct.error?.code).toBe("HKE04");

    expect(await updateExpense(owner.client, id, expenseInput({ vendor }), first)).toMatchObject({
      status: "saved",
    });
    expect((await readExpense(id)).file_path).toBe(first);
  });

  it("M7.1-8: an expense sent again with the same create key is not recorded twice", async () => {
    const key = randomUUID();
    const vendor = `ספק ${MARKER} ${randomUUID()}`;
    const path = await uploadTracked();
    expect(await insertExpense(owner.client, expenseInput({ vendor }), path, key)).toEqual({
      status: "saved",
      hasFile: true,
    });
    // The same upload sent again: the expense recorded it.
    expect(await insertExpense(owner.client, expenseInput({ vendor }), path, key)).toEqual({
      status: "saved",
      hasFile: true,
    });
    // A new upload with the same key: not recorded, so the action removes it.
    const again = await uploadTracked();
    expect(await insertExpense(owner.client, expenseInput({ vendor }), again, key)).toEqual({
      status: "saved",
      hasFile: true,
      duplicate: true,
    });
    const { data } = await service.from(TABLE).select("id, file_path").eq("vendor", vendor);
    expect(data).toEqual([{ id: expect.any(String), file_path: path }]);
    // Without a key every insert creates a row, as before.
    await insertExpense(owner.client, expenseInput({ vendor }), null);
    await insertExpense(owner.client, expenseInput({ vendor }), null);
    const { count } = await service
      .from(TABLE)
      .select("id", { count: "exact", head: true })
      .eq("vendor", vendor);
    expect(count).toBe(3);
  });

  it("M7.1-8: the create key cannot be changed by an update (no UPDATE grant)", async () => {
    const id = await insertAs(owner.client);
    const { error } = await owner.client
      .from(TABLE)
      .update({ create_key: randomUUID() })
      .eq("id", id);
    expect(error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it("SPEC 6: an unrecorded upload can be removed; a recorded file never, also after it was replaced or the expense deleted", async () => {
    const unrecorded = await uploadTracked();
    const first = await uploadTracked();
    const second = await uploadTracked();
    const id = await insertAs(owner.client, {}, first);
    const vendor = (await readExpense(id)).vendor;
    await updateExpense(owner.client, id, expenseInput({ vendor }), second);
    await softDeleteExpense(owner.client, id);

    const removedUnrecorded = await owner.client.storage
      .from(EXPENSE_FILES_BUCKET)
      .remove([unrecorded]);
    const removedRecorded = await admin.client.storage
      .from(EXPENSE_FILES_BUCKET)
      .remove([first, second]);

    expect(removedUnrecorded.error).toBeNull();
    expect(await objectExists(unrecorded)).toBe(false);
    expect(removedRecorded.data ?? []).toEqual([]);
    expect(await objectExists(first)).toBe(true);
    expect(await objectExists(second)).toBe(true);
    const asOwner = await owner.client.rpc("expense_file_was_recorded", { p_path: first });
    expect(asOwner.data).toBe(true);
  });

  it("SPEC 6: files are never overwritten (no UPDATE on objects)", async () => {
    const path = await uploadTracked("image/jpeg");
    const { error } = await owner.client.storage
      .from(EXPENSE_FILES_BUCKET)
      .upload(path, new Blob([JPEG_BYTES], { type: "image/jpeg" }), { upsert: true });

    expect(error).not.toBeNull();
  });

  it("SPEC 6: an expense with recorded files cannot lose them by a delete, even by the service role", async () => {
    const path = await uploadTracked();
    const id = await insertAs(owner.client, {}, path);

    const removed = await service.from(TABLE).delete().eq("id", id);

    expect(removed.error?.code).toBe(FOREIGN_KEY_VIOLATION);
  });
});

describe("SPEC 6: recording an expense file and removing it cannot race", () => {
  it("SPEC 6: a removal during an uncommitted recording waits for it and is then refused; the file stays", async () => {
    const path = await uploadTracked();
    const vendor = `מרוץ ${MARKER}`;

    const record = runPsqlSession(`
      begin;
      insert into public.expenses (expense_date, amount, vendor, category_id, payment_method, file_path)
      values ('${todayInJerusalem()}', 100, '${vendor}', '${categoryId}', 'cash', '${path}');
      select pg_sleep(1.5);
      commit;
    `);
    await sleep(500);
    const started = Date.now();
    const removed = await owner.client.storage.from(EXPENSE_FILES_BUCKET).remove([path]);

    expect(await record).toEqual({ ok: true });
    expect(Date.now() - started).toBeGreaterThanOrEqual(500);
    expect(removed.data ?? []).toEqual([]);
    expect(await objectExists(path)).toBe(true);
  });

  it("EXP-2: a removal during a recording that rolls back goes ahead after it", async () => {
    const path = await uploadTracked();

    const record = runPsqlSession(`
      begin;
      insert into public.expenses (expense_date, amount, vendor, category_id, payment_method, file_path)
      values ('${todayInJerusalem()}', 100, 'rollback ${MARKER}', '${categoryId}', 'cash', '${path}');
      select pg_sleep(1.5);
      rollback;
    `);
    await sleep(500);
    const removed = await owner.client.storage.from(EXPENSE_FILES_BUCKET).remove([path]);

    expect(await record).toEqual({ ok: true });
    expect(removed.error).toBeNull();
    expect(await objectExists(path)).toBe(false);
  });

  it("owner decision: archiving a category while an expense is recorded in it waits; the expense keeps it", async () => {
    const category = await newCategory("מרוץ");
    const record = runPsqlSession(`
      begin;
      insert into public.expenses (expense_date, amount, vendor, category_id, payment_method)
      values ('${todayInJerusalem()}', 100, 'archive race ${MARKER}', '${category}', 'cash');
      select pg_sleep(1.5);
      commit;
    `);
    await sleep(500);
    const started = Date.now();
    const archived = await setExpenseCategoryArchived(owner.client, category, true);

    expect(await record).toEqual({ ok: true });
    expect(Date.now() - started).toBeGreaterThanOrEqual(500);
    expect(archived).toBe("updated");
    const { data } = await service.from(TABLE).select("id").eq("category_id", category);
    expect(data).toHaveLength(1);
  });
});

describe("EXP-4 / EXP-6: the list and its total", () => {
  it("EXP-4 / EXP-6: filters by month, category, vendor (any case, part of the name) and missing document; totals match", async () => {
    const other = await newCategory("סינון");
    const tag = randomUUID().slice(0, 8);
    const path = await uploadTracked();
    const rows = [
      { vendor: `Office Depot ${tag} ${MARKER}`, amount: 10_050, expense_date: `${LIST_MONTH}-01` },
      {
        vendor: `office depot ${tag} ${MARKER}`,
        amount: 20_000,
        expense_date: `${LIST_MONTH}-31`,
        category_id: other,
      },
      { vendor: `דפוס ${tag} ${MARKER}`, amount: 5, expense_date: `${LIST_MONTH}-15` },
      // Next month: never in LIST_MONTH.
      { vendor: `Office Depot ${tag} ${MARKER}`, amount: 99_999, expense_date: "1901-04-01" },
    ];
    const ids: string[] = [];
    for (const [index, row] of rows.entries()) {
      ids.push(await insertAsService({ ...row, ...(index === 0 ? { file_path: path } : {}) }));
    }
    const base = { month: LIST_MONTH, categoryId: null, vendor: tag, missingDocument: false };

    const all = await listExpenses(owner.client, base, 0);
    expect(all.items.map((item) => item.id)).toEqual([ids[1], ids[2], ids[0]]);
    expect(all.items.map((item) => item.has_file)).toEqual([false, false, true]);
    expect(all.items[0]).toMatchObject({
      amount: 20_000,
      category_id: other,
      payment_method: "credit_card",
    });
    expect(await getExpensesSummary(owner.client, base)).toEqual({ count: 3, total: 30_055 });

    const byCategory = { ...base, categoryId: other };
    expect((await listExpenses(owner.client, byCategory, 0)).items.map((item) => item.id)).toEqual([
      ids[1],
    ]);
    expect(await getExpensesSummary(owner.client, byCategory)).toEqual({ count: 1, total: 20_000 });

    const byVendor = { ...base, vendor: `DEPOT ${tag}` };
    expect((await listExpenses(owner.client, byVendor, 0)).items.map((item) => item.id)).toEqual([
      ids[1],
      ids[0],
    ]);
    expect(await getExpensesSummary(owner.client, byVendor)).toEqual({ count: 2, total: 30_050 });

    const missing = { ...base, missingDocument: true };
    expect((await listExpenses(owner.client, missing, 0)).items.map((item) => item.id)).toEqual([
      ids[1],
      ids[2],
    ]);
    expect(await getExpensesSummary(owner.client, missing)).toEqual({ count: 2, total: 20_005 });

    // A vendor search with % or _ is text, not a pattern.
    const wildcard = { ...base, vendor: "%" };
    expect((await listExpenses(owner.client, wildcard, 0)).items).toEqual([]);
  });

  it("EXP-4: pages hold at most 50 rows with a next-page flag", async () => {
    const tag = randomUUID().slice(0, 8);
    const many = Array.from({ length: 51 }, (_, index) => ({
      ...expenseInput({
        vendor: `עמוד ${tag} ${MARKER}`,
        amount: index + 1,
        expense_date: `${LIST_MONTH}-10`,
      }),
    }));
    const inserted = await service.from(TABLE).insert(many);
    expect(inserted.error).toBeNull();
    const filter = { month: LIST_MONTH, categoryId: null, vendor: tag, missingDocument: false };

    const first = await listExpenses(owner.client, filter, 0);
    const second = await listExpenses(owner.client, filter, 50);
    const capped = await owner.client.rpc("list_expenses", {
      p_month: `${LIST_MONTH}-01`,
      p_vendor: tag,
      p_limit: 1000,
    });

    expect(first.items).toHaveLength(50);
    expect(first.hasMore).toBe(true);
    expect(second.items).toHaveLength(1);
    expect(second.hasMore).toBe(false);
    expect(capped.data).toHaveLength(51);
    expect(await getExpensesSummary(owner.client, filter)).toEqual({ count: 51, total: 1326 });
  });

  it("SPEC 10: the month boundary of 31/12 → 1/1 is exact", async () => {
    const tag = randomUUID().slice(0, 8);
    const december = await insertAsService({
      vendor: `שנה ${tag} ${MARKER}`,
      expense_date: "1901-12-31",
    });
    const january = await insertAsService({
      vendor: `שנה ${tag} ${MARKER}`,
      expense_date: "1902-01-01",
    });
    const filter = (month: string) => ({
      month,
      categoryId: null,
      vendor: tag,
      missingDocument: false,
    });

    expect((await listExpenses(owner.client, filter("1901-12"), 0)).items.map((i) => i.id)).toEqual(
      [december],
    );
    expect((await listExpenses(owner.client, filter("1902-01"), 0)).items.map((i) => i.id)).toEqual(
      [january],
    );
  });
});
