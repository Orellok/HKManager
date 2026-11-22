import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RECEIPT_SETTINGS_DEFAULTS, getReceiptSettings } from "@/lib/app-settings";
import { todayInJerusalem } from "@/lib/dates";
import {
  getIncomeWithReceipt,
  getReceiptsSummary,
  listPendingReceipts,
  recordReceipt,
  updateReceipt,
} from "@/lib/documents/queries";
import { RECEIPTS_BUCKET } from "@/lib/documents/file";
import {
  checkUploadedReceipt,
  createReceiptUpload,
  createReceiptViewUrl,
} from "@/lib/documents/storage";
import { listIncomes, saveIncome, softDeleteIncome } from "@/lib/incomes/queries";

import {
  createAnonClient,
  createServiceRoleClient,
  createSignedInUser,
  deleteUser,
  testEmail,
  type TestUser,
} from "./support/local-supabase";
import { runPsqlSession } from "./support/psql-session";

const TABLE = "documents";
const INSUFFICIENT_PRIVILEGE = "42501";
const CHECK_VIOLATION = "23514";
const INCOME_HAS_RECEIPT = "HKI05";
const MARKER = `it-documents-${randomUUID()}`;
const PDF_BYTES = new TextEncoder().encode(
  "%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n",
);

type DocumentRow = {
  id: string;
  income_id: string;
  doc_type: string;
  provider: string;
  external_id: string | null;
  doc_number: string;
  issued_date: string;
  file_path: string | null;
  url: string | null;
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

/** A receipt number no other test (or earlier run) uses. */
function uniqueNumber(): string {
  return `T${randomUUID().replaceAll("-", "").slice(0, 20)}`;
}

/** An ISO date `days` from today in Asia/Jerusalem. */
function isoDaysFromToday(days: number): string {
  const [year, month, day] = todayInJerusalem().split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** The last day of the previous month (Asia/Jerusalem). */
function lastDayOfPreviousMonth(): string {
  const [year, month] = todayInJerusalem().split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 0)).toISOString().slice(0, 10);
}

async function insertClient() {
  const { data, error } = await service
    .from("clients")
    .insert({ name: `לקוח ${randomUUID()}`, notes: MARKER })
    .select("id, name")
    .single<{ id: string; name: string }>();
  if (error) {
    throw new Error("Could not insert a test client", { cause: error });
  }
  return data;
}

/** A client with one income (₪100, today) that has no receipt. */
async function insertIncome(fields: Record<string, unknown> = {}) {
  const client = await insertClient();
  const { data, error } = await service
    .from("incomes")
    .insert({
      client_id: client.id,
      received_date: todayInJerusalem(),
      amount: 10_000,
      payment_method: "cash",
      ...fields,
    })
    .select("id, client_id")
    .single<{ id: string; client_id: string }>();
  if (error) {
    throw new Error("Could not insert a test income", { cause: error });
  }
  return data;
}

type ReceiptFields = { doc_number?: string; issued_date?: string; url?: string };

/** A receipt with a link and a unique number, issued today. */
function linkReceipt(fields: ReceiptFields = {}) {
  return {
    doc_number: uniqueNumber(),
    issued_date: todayInJerusalem(),
    url: "https://provider.example/receipts/1",
    ...fields,
    file_path: null,
  };
}

/** A receipt with a stored file and a unique number, issued today. */
function fileReceipt(path: string, fields: Omit<ReceiptFields, "url"> = {}) {
  return { ...linkReceipt(fields), url: null, file_path: path };
}

/** Uploads bytes as `client` through a signed upload URL for a new path of the income. */
async function upload(client: SupabaseClient, incomeId: string, bytes: Uint8Array = PDF_BYTES) {
  const { path, token } = await createReceiptUpload(client, incomeId);
  const { error } = await client.storage
    .from(RECEIPTS_BUCKET)
    .uploadToSignedUrl(path, token, new Blob([bytes as BlobPart], { type: "application/pdf" }));
  if (error) {
    throw new Error("Could not upload a test receipt", { cause: error });
  }
  return path;
}

async function readDocument(incomeId: string): Promise<DocumentRow | null> {
  const { data, error } = await service
    .from(TABLE)
    .select()
    .eq("income_id", incomeId)
    .maybeSingle<DocumentRow>();
  if (error) {
    throw new Error("Could not read the document", { cause: error });
  }
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

async function objectExists(path: string): Promise<boolean> {
  const { data } = await service.storage.from(RECEIPTS_BUCKET).exists(path);
  return data;
}

beforeAll(async () => {
  service = await createServiceRoleClient();
  anon = await createAnonClient();
  outsider = await createSignedInUser(service, testEmail("documents-outsider"));
  createdUserIds.push(outsider.id);
  owner = await createSignedInUser(service, testEmail("documents-owner"));
  createdUserIds.push(owner.id);
  admin = await createSignedInUser(service, testEmail("documents-admin"));
  createdUserIds.push(admin.id);
  const { error } = await service.from("allowed_users").insert([
    { email: owner.email, role: "owner" },
    { email: admin.email, role: "admin" },
  ]);
  if (error) {
    throw new Error("Could not allowlist the test users", { cause: error });
  }
});

afterAll(async () => {
  if (!service) {
    return;
  }
  const cleanupErrors: unknown[] = [];
  const { data: clients } = await service.from("clients").select("id").eq("notes", MARKER);
  const clientIds = (clients ?? []).map((row) => row.id as string);
  if (clientIds.length > 0) {
    const { data: incomes } = await service.from("incomes").select("id").in("client_id", clientIds);
    const incomeIds = (incomes ?? []).map((row) => row.id as string);
    if (incomeIds.length > 0) {
      const { data: documents } = await service.from(TABLE).select("id").in("income_id", incomeIds);
      const documentIds = (documents ?? []).map((row) => row.id as string);
      const objects = await Promise.all(
        incomeIds.map((id) => service.storage.from(RECEIPTS_BUCKET).list(id)),
      );
      const paths = objects.flatMap(({ data }, index) =>
        (data ?? []).map((object) => `${incomeIds[index]}/${object.name}`),
      );
      if (paths.length > 0) {
        const removed = await service.storage.from(RECEIPTS_BUCKET).remove(paths);
        cleanupErrors.push(...[removed.error].filter(Boolean));
      }
      const audit = await service
        .from("audit_log")
        .delete()
        .in("entity_id", [...incomeIds, ...documentIds]);
      const recorded =
        documentIds.length > 0
          ? await service.from("recorded_receipt_files").delete().in("document_id", documentIds)
          : { error: null };
      cleanupErrors.push(...[recorded.error].filter(Boolean));
      const removedDocuments = await service.from(TABLE).delete().in("income_id", incomeIds);
      const removedIncomes = await service.from("incomes").delete().in("id", incomeIds);
      cleanupErrors.push(
        ...[audit.error, removedDocuments.error, removedIncomes.error].filter(Boolean),
      );
    }
    const removedClients = await service.from("clients").delete().in("id", clientIds);
    cleanupErrors.push(...[removedClients.error].filter(Boolean));
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

describe("documents RLS: anon and users outside the allowlist", () => {
  it("DOC-2: anon cannot read or write documents or settings, call the functions or reach the bucket", async () => {
    const income = await insertIncome();
    const path = await upload(owner.client, income.id);
    const select = await anon.from(TABLE).select();
    const insert = await anon.from(TABLE).insert({ income_id: income.id, ...linkReceipt() });
    const settings = await anon.from("app_settings").select();
    const rpcs = await Promise.all([
      anon.rpc("receipts_summary"),
      anon.rpc("list_pending_receipts"),
      anon.rpc("receipt_provider_name"),
    ]);
    const download = await anon.storage.from(RECEIPTS_BUCKET).download(path);
    const sign = await anon.storage
      .from(RECEIPTS_BUCKET)
      .createSignedUploadUrl(`${income.id}/${randomUUID()}.pdf`);

    expect(select.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(insert.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(settings.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(rpcs.map((result) => result.error?.code)).toEqual(Array(3).fill(INSUFFICIENT_PRIVILEGE));
    expect(download.data).toBeNull();
    expect(sign.data).toBeNull();
  });

  it("DOC-2: a signed-in user outside the allowlist sees nothing and cannot record, upload or read files", async () => {
    const income = await insertIncome();
    const path = await upload(owner.client, income.id);
    await recordReceipt(owner.client, income.id, fileReceipt(path));
    const other = await insertIncome();

    const select = await outsider.client.from(TABLE).select().eq("income_id", income.id);
    const insert = await outsider.client
      .from(TABLE)
      .insert({ income_id: other.id, ...linkReceipt() });
    const update = await outsider.client
      .from(TABLE)
      .update({ doc_number: uniqueNumber() })
      .eq("income_id", income.id)
      .select();
    const settings = await outsider.client.from("app_settings").select();
    const audit = await outsider.client.from("audit_log").select().eq("entity", "documents");
    const download = await outsider.client.storage.from(RECEIPTS_BUCKET).download(path);
    const list = await outsider.client.storage.from(RECEIPTS_BUCKET).list(income.id);
    const sign = await outsider.client.storage.from(RECEIPTS_BUCKET).createSignedUrl(path, 60);
    const signUpload = await outsider.client.storage
      .from(RECEIPTS_BUCKET)
      .createSignedUploadUrl(`${other.id}/${randomUUID()}.pdf`);
    const remove = await outsider.client.storage.from(RECEIPTS_BUCKET).remove([path]);

    expect(select.data).toEqual([]);
    expect(insert.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(update.data).toEqual([]);
    expect(settings.data).toEqual([]);
    expect(audit.data).toEqual([]);
    expect(download.data).toBeNull();
    expect(list.data ?? []).toEqual([]);
    expect(sign.data).toBeNull();
    expect(signUpload.data).toBeNull();
    expect(remove.data ?? []).toEqual([]);
    expect(await objectExists(path)).toBe(true);
    expect(await readDocument(other.id)).toBeNull();
  });
});

for (const role of ["owner", "admin"] as const) {
  const user = () => (role === "owner" ? owner : admin);

  describe(`documents RLS: ${role}`, () => {
    it(`DOC-2 / INC-3: ${role} records a receipt with a link; the provider comes from the settings`, async () => {
      const income = await insertIncome();
      const receipt = linkReceipt();

      expect(await recordReceipt(user().client, income.id, receipt)).toEqual({ status: "saved" });

      expect(await readDocument(income.id)).toMatchObject({
        doc_type: "receipt",
        provider: "SUMIT",
        external_id: null,
        doc_number: receipt.doc_number,
        url: receipt.url,
        file_path: null,
        created_by: user().id,
      });
      const withReceipt = await getIncomeWithReceipt(user().client, income.id);
      expect(withReceipt?.document?.doc_number).toBe(receipt.doc_number);
    });

    it(`DOC-2: ${role} uploads a PDF to the private bucket, records it and gets a short-lived signed URL`, async () => {
      const income = await insertIncome();
      const path = await upload(user().client, income.id);

      expect(path).toMatch(new RegExp(`^${income.id}/[0-9a-f-]{36}\\.pdf$`));
      expect(await checkUploadedReceipt(user().client, path)).toEqual({ status: "ok" });
      expect(await recordReceipt(user().client, income.id, fileReceipt(path))).toEqual({
        status: "saved",
      });
      const signedUrl = await createReceiptViewUrl(user().client, path);
      expect(new URL(signedUrl).searchParams.get("token")).toBeTruthy();
      const response = await fetch(signedUrl);
      expect(response.status).toBe(200);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(PDF_BYTES);
    });

    it(`SPEC 6: ${role} has no DELETE privilege on documents, and the file of a recorded receipt cannot be removed`, async () => {
      const income = await insertIncome();
      const path = await upload(user().client, income.id);
      await recordReceipt(user().client, income.id, fileReceipt(path));

      const removed = await user().client.from(TABLE).delete().eq("income_id", income.id);
      const removedFile = await user().client.storage.from(RECEIPTS_BUCKET).remove([path]);

      expect(removed.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
      expect(removedFile.data ?? []).toEqual([]);
      expect(await readDocument(income.id)).not.toBeNull();
      expect(await objectExists(path)).toBe(true);
    });

    it(`SPEC 6: ${role} cannot remove a receipt file that was replaced by another file or a link`, async () => {
      const income = await insertIncome();
      const first = await upload(user().client, income.id);
      await recordReceipt(user().client, income.id, fileReceipt(first));
      const second = await upload(user().client, income.id);
      const receipt = fileReceipt(second);
      expect(await updateReceipt(user().client, income.id, receipt)).toEqual({ status: "saved" });
      expect(
        await updateReceipt(user().client, income.id, {
          ...receipt,
          file_path: null,
          url: "https://provider.example/receipts/2",
        }),
      ).toEqual({ status: "saved" });

      const removed = await user().client.storage.from(RECEIPTS_BUCKET).remove([first, second]);

      expect(removed.data ?? []).toEqual([]);
      expect(await objectExists(first)).toBe(true);
      expect(await objectExists(second)).toBe(true);
    });

    it(`SPEC 6: ${role} cannot read or write the list of recorded receipt files`, async () => {
      const select = await user().client.from("recorded_receipt_files").select();
      const insert = await user()
        .client.from("recorded_receipt_files")
        .insert({ path: `${randomUUID()}/${randomUUID()}.pdf`, document_id: randomUUID() });

      expect(select.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
      expect(insert.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    });

    it(`DOC-2: ${role} can remove an upload that was never recorded`, async () => {
      const income = await insertIncome();
      const path = await upload(user().client, income.id);

      const removed = await user().client.storage.from(RECEIPTS_BUCKET).remove([path]);

      expect(removed.error).toBeNull();
      expect(await objectExists(path)).toBe(false);
    });

    it(`owner decision: ${role} edits the receipt details; the income, type and provider cannot change`, async () => {
      const income = await insertIncome();
      const other = await insertIncome();
      await recordReceipt(user().client, income.id, linkReceipt());
      const changed = linkReceipt({ issued_date: isoDaysFromToday(-1) });

      expect(await updateReceipt(user().client, income.id, changed)).toEqual({ status: "saved" });
      const fixed = await Promise.all(
        [
          { income_id: other.id },
          { doc_type: "invoice" },
          { provider: "אחר" },
          { external_id: "x" },
        ].map((fields) => user().client.from(TABLE).update(fields).eq("income_id", income.id)),
      );

      expect(await readDocument(income.id)).toMatchObject({
        doc_number: changed.doc_number,
        issued_date: changed.issued_date,
        provider: "SUMIT",
      });
      expect(fixed.map((result) => result.error?.code)).toEqual(
        Array(4).fill(INSUFFICIENT_PRIVILEGE),
      );
    });
  });
}

describe("DOC-3: receipt numbers are unique per provider and type", () => {
  it("DOC-3: a receipt number already recorded is refused, on record and on edit", async () => {
    const first = await insertIncome();
    const second = await insertIncome();
    const third = await insertIncome();
    const taken = linkReceipt();
    await recordReceipt(owner.client, first.id, taken);
    await recordReceipt(owner.client, third.id, linkReceipt());

    expect(
      await recordReceipt(owner.client, second.id, linkReceipt({ doc_number: taken.doc_number })),
    ).toEqual({ status: "refused", refusal: "doc_number_taken" });
    expect(
      await updateReceipt(owner.client, third.id, linkReceipt({ doc_number: taken.doc_number })),
    ).toEqual({ status: "refused", refusal: "doc_number_taken" });
    expect(await readDocument(second.id)).toBeNull();
  });

  it("INC-6: a second receipt for the same income is refused", async () => {
    const income = await insertIncome();
    await recordReceipt(owner.client, income.id, linkReceipt());

    expect(await recordReceipt(owner.client, income.id, linkReceipt())).toEqual({
      status: "refused",
      refusal: "already_recorded",
    });
  });
});

describe("DOC-2: receipt checks in the database", () => {
  it("DOC-2: a future issue date is refused; today and a past date are accepted", async () => {
    const future = await insertIncome();
    const today = await insertIncome();
    const past = await insertIncome();

    expect(
      await recordReceipt(
        owner.client,
        future.id,
        linkReceipt({ issued_date: isoDaysFromToday(1) }),
      ),
    ).toEqual({ status: "refused", refusal: "date_in_future" });
    expect(await recordReceipt(owner.client, today.id, linkReceipt())).toEqual({ status: "saved" });
    expect(
      await recordReceipt(owner.client, past.id, linkReceipt({ issued_date: "2020-01-31" })),
    ).toEqual({ status: "saved" });
  });

  it("owner decision: a link must be https; a file and a link together, or neither, are refused", async () => {
    const income = await insertIncome();
    const path = await upload(owner.client, income.id);
    const attempts = await Promise.all(
      [
        { url: "http://provider.example/1" },
        { url: "javascript:alert(1)" },
        { url: "https://" },
        { url: "https://provider.example/a b" },
        { url: "https://provider.example/1", file_path: path },
        { url: null, file_path: null },
      ].map((fields) =>
        owner.client.from(TABLE).insert({ income_id: income.id, ...linkReceipt(), ...fields }),
      ),
    );

    expect(attempts.map((result) => result.error?.code)).toEqual(Array(6).fill(CHECK_VIOLATION));
    expect(await readDocument(income.id)).toBeNull();
  });

  it("DOC-2: a file path of another income, or of a file that was never uploaded, is refused", async () => {
    const income = await insertIncome();
    const other = await insertIncome();
    const otherPath = await upload(owner.client, other.id);

    const foreign = await owner.client
      .from(TABLE)
      .insert({ income_id: income.id, ...linkReceipt(), url: null, file_path: otherPath });
    const missing = await recordReceipt(
      owner.client,
      income.id,
      fileReceipt(`${income.id}/${randomUUID()}.pdf`),
    );

    expect(foreign.error?.code).toBe(CHECK_VIOLATION);
    expect(missing).toEqual({ status: "refused", refusal: "file_missing" });
  });

  it("DOC-2: no receipt for a deleted income; uploads only under an existing income that is not deleted", async () => {
    const income = await insertIncome();
    await softDeleteIncome(owner.client, income.id);

    const recorded = await recordReceipt(owner.client, income.id, linkReceipt());
    const signDeleted = await owner.client.storage
      .from(RECEIPTS_BUCKET)
      .createSignedUploadUrl(`${income.id}/${randomUUID()}.pdf`);
    const signUnknown = await owner.client.storage
      .from(RECEIPTS_BUCKET)
      .createSignedUploadUrl(`${randomUUID()}/${randomUUID()}.pdf`);
    const live = await insertIncome();
    const signBadName = await owner.client.storage
      .from(RECEIPTS_BUCKET)
      .createSignedUploadUrl(`${live.id}/client-name.pdf`);

    expect(recorded).toEqual({ status: "refused", refusal: "income_missing" });
    expect(signDeleted.data).toBeNull();
    expect(signUnknown.data).toBeNull();
    expect(signBadName.data).toBeNull();
  });

  it("DOC-2: the bucket refuses other file types; a non-PDF uploaded as PDF fails the content check", async () => {
    const income = await insertIncome();
    const { path, token } = await createReceiptUpload(owner.client, income.id);
    const wrongType = await owner.client.storage
      .from(RECEIPTS_BUCKET)
      .uploadToSignedUrl(path, token, new Blob(["hello"], { type: "text/plain" }));
    const fake = await upload(owner.client, income.id, new TextEncoder().encode("<html></html>"));

    expect(wrongType.error).not.toBeNull();
    expect(await checkUploadedReceipt(owner.client, fake)).toEqual({
      status: "invalid",
      error: "not_pdf",
    });
    expect(await checkUploadedReceipt(owner.client, `${income.id}/${randomUUID()}.pdf`)).toEqual({
      status: "missing",
    });
  });
});

describe("INC-4: an income with a receipt is locked", () => {
  it("INC-4: editing or soft-deleting an income with a receipt is refused, also for the service role", async () => {
    const income = await insertIncome({ notes: "לפני" });
    await recordReceipt(owner.client, income.id, linkReceipt());

    const edit = await saveIncome(
      owner.client,
      income.id,
      {
        client_id: income.client_id,
        project_id: null,
        milestone_id: null,
        received_date: todayInJerusalem(),
        amount: 1,
        payment_method: "cash",
        notes: null,
      },
      null,
    );
    const remove = await softDeleteIncome(owner.client, income.id);
    const byService = await service.from("incomes").update({ notes: "אחרי" }).eq("id", income.id);

    expect(edit).toEqual({ status: "refused", refusal: "has_receipt" });
    expect(remove).toEqual({ status: "has_receipt" });
    expect(byService.error?.code).toBe(INCOME_HAS_RECEIPT);
    const { data } = await service
      .from("incomes")
      .select("amount, notes, deleted_at")
      .eq("id", income.id)
      .single();
    expect(data).toEqual({ amount: 10_000, notes: "לפני", deleted_at: null });
  });

  it("INC-4: an income without a receipt stays editable", async () => {
    const income = await insertIncome();

    const update = await owner.client
      .from("incomes")
      .update({ amount: 20_000 })
      .eq("id", income.id)
      .select("amount");

    expect(update.data).toEqual([{ amount: 20_000 }]);
  });

  it("INC-4: a receipt recorded during an income edit waits for it; the edit is kept and the income is locked after", async () => {
    const income = await insertIncome();
    const number = uniqueNumber();

    const edit = runPsqlSession(`
      begin;
      update public.incomes set amount = 30000 where id = '${income.id}';
      select pg_sleep(1.5);
      commit;
    `);
    await sleep(500);
    const record = runPsqlSession(`
      insert into public.documents (income_id, doc_number, issued_date, url)
      values ('${income.id}', '${number}', '${todayInJerusalem()}', 'https://provider.example/1');
    `);

    expect(await edit).toEqual({ ok: true });
    expect(await record).toEqual({ ok: true });
    const after = await runPsqlSession(
      `update public.incomes set amount = 1 where id = '${income.id}';`,
    );
    expect(after).toMatchObject({ ok: false, sqlState: INCOME_HAS_RECEIPT });
  });

  it("INC-4: an income edit during a receipt recording waits for it and is then refused", async () => {
    const income = await insertIncome();
    const number = uniqueNumber();

    const record = runPsqlSession(`
      begin;
      insert into public.documents (income_id, doc_number, issued_date, url)
      values ('${income.id}', '${number}', '${todayInJerusalem()}', 'https://provider.example/1');
      select pg_sleep(1.5);
      commit;
    `);
    await sleep(500);
    const edit = runPsqlSession(
      `update public.incomes set amount = 30000 where id = '${income.id}';`,
    );

    expect(await record).toEqual({ ok: true });
    expect(await edit).toMatchObject({ ok: false, sqlState: INCOME_HAS_RECEIPT });
  });

  it("INC-4: a receipt recorded during a soft delete waits for it and is then refused", async () => {
    const income = await insertIncome();

    const remove = runPsqlSession(`
      begin;
      update public.incomes set deleted_at = now() where id = '${income.id}';
      select pg_sleep(1.5);
      commit;
    `);
    await sleep(500);
    const record = runPsqlSession(`
      insert into public.documents (income_id, doc_number, issued_date, url)
      values ('${income.id}', '${uniqueNumber()}', '${todayInJerusalem()}', 'https://provider.example/1');
    `);

    expect(await remove).toEqual({ ok: true });
    expect(await record).toMatchObject({ ok: false, sqlState: "HKD02" });
  });
});

describe("SPEC 6: recording a receipt and removing its file cannot race", () => {
  it("SPEC 6: a removal during an uncommitted recording waits for it and is then refused; the file stays", async () => {
    const income = await insertIncome();
    const path = await upload(owner.client, income.id);

    const record = runPsqlSession(`
      begin;
      insert into public.documents (income_id, doc_number, issued_date, file_path)
      values ('${income.id}', '${uniqueNumber()}', '${todayInJerusalem()}', '${path}');
      select pg_sleep(1.5);
      commit;
    `);
    await sleep(500);
    const started = Date.now();
    const removed = await owner.client.storage.from(RECEIPTS_BUCKET).remove([path]);

    expect(await record).toEqual({ ok: true });
    expect(Date.now() - started).toBeGreaterThanOrEqual(500);
    expect(removed.data ?? []).toEqual([]);
    expect(await objectExists(path)).toBe(true);
    expect((await readDocument(income.id))?.file_path).toBe(path);
  });

  it("DOC-2: a removal during a recording that rolls back goes ahead after it", async () => {
    const income = await insertIncome();
    const path = await upload(owner.client, income.id);

    const record = runPsqlSession(`
      begin;
      insert into public.documents (income_id, doc_number, issued_date, file_path)
      values ('${income.id}', '${uniqueNumber()}', '${todayInJerusalem()}', '${path}');
      select pg_sleep(1.5);
      rollback;
    `);
    await sleep(500);
    const removed = await owner.client.storage.from(RECEIPTS_BUCKET).remove([path]);

    expect(await record).toEqual({ ok: true });
    expect(removed.error).toBeNull();
    expect(await objectExists(path)).toBe(false);
  });

  it("SPEC 6: only allowlisted users learn whether a file was recorded", async () => {
    const income = await insertIncome();
    const path = await upload(owner.client, income.id);
    await recordReceipt(owner.client, income.id, fileReceipt(path));

    const asOwner = await owner.client.rpc("receipt_file_was_recorded", { p_path: path });
    const asOutsider = await outsider.client.rpc("receipt_file_was_recorded", { p_path: path });

    expect(asOwner.data).toBe(true);
    expect(asOutsider.data).toBe(false);
  });

  it("SPEC 6: a document with recorded files cannot lose them by a delete, even by the service role", async () => {
    const income = await insertIncome();
    const path = await upload(owner.client, income.id);
    await recordReceipt(owner.client, income.id, fileReceipt(path));

    const removed = await service.from(TABLE).delete().eq("income_id", income.id);

    expect(removed.error?.code).toBe("23503");
  });
});

describe("audit_log for documents (owner decision)", () => {
  it("audit_log: recording and each edit of a receipt are recorded with the actor and the changed fields; a link only as changed", async () => {
    const income = await insertIncome();
    const first = linkReceipt();
    await recordReceipt(owner.client, income.id, first);
    const document = await readDocument(income.id);
    const second = linkReceipt({
      issued_date: isoDaysFromToday(-2),
      url: "https://provider.example/2",
    });
    await updateReceipt(admin.client, income.id, second);
    // Saving the same details again changes nothing and records nothing.
    await updateReceipt(admin.client, income.id, second);
    const path = await upload(admin.client, income.id);
    await updateReceipt(admin.client, income.id, {
      doc_number: second.doc_number,
      issued_date: second.issued_date,
      url: null,
      file_path: path,
    });

    const audit = await auditOf(document!.id);
    expect(audit).toEqual([
      {
        actor: owner.id,
        entity: "documents",
        action: "insert",
        diff: {
          income_id: { new: income.id },
          doc_type: { new: "receipt" },
          provider: { new: "SUMIT" },
          doc_number: { new: first.doc_number },
          issued_date: { new: first.issued_date },
          url: { changed: true },
        },
      },
      {
        actor: admin.id,
        entity: "documents",
        action: "update",
        diff: {
          doc_number: { old: first.doc_number, new: second.doc_number },
          issued_date: { old: first.issued_date, new: second.issued_date },
          url: { changed: true },
        },
      },
      {
        actor: admin.id,
        entity: "documents",
        action: "update",
        diff: { file_path: { old: null, new: path }, url: { changed: true } },
      },
    ]);
    expect(JSON.stringify(audit)).not.toContain("provider.example");
  });
});

describe("app_settings (DOC-4, owner decision: seed values, admin-only writes)", () => {
  it("SET: allowlisted users read the seeded provider name, link and quota", async () => {
    expect(await getReceiptSettings(owner.client)).toEqual(RECEIPT_SETTINGS_DEFAULTS);
    const { data } = await owner.client
      .from("app_settings")
      .select("key, value")
      .in("key", ["receipt_provider_name", "receipt_provider_url", "receipt_monthly_quota"])
      .order("key");
    expect(data).toEqual([
      { key: "receipt_monthly_quota", value: 10 },
      { key: "receipt_provider_name", value: "SUMIT" },
      { key: "receipt_provider_url", value: "https://app.sumit.co.il/" },
    ]);
  });

  it("AUTH-5: the owner cannot change, add or remove settings", async () => {
    const update = await owner.client
      .from("app_settings")
      .update({ value: 99 })
      .eq("key", "receipt_monthly_quota")
      .select();
    const insert = await owner.client.from("app_settings").insert({ key: "x_test", value: 1 });
    const remove = await owner.client
      .from("app_settings")
      .delete()
      .eq("key", "receipt_monthly_quota")
      .select();

    expect(update.data).toEqual([]);
    expect(insert.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(remove.data).toEqual([]);
    expect((await getReceiptSettings(owner.client)).monthlyQuota).toBe(10);
  });

  it("DOC-4: a receipt recorded while the provider setting is missing gets the default SUMIT", async () => {
    const income = await insertIncome();
    const { data: saved } = await service
      .from("app_settings")
      .delete()
      .eq("key", "receipt_provider_name")
      .select("key, value")
      .single();
    try {
      await recordReceipt(owner.client, income.id, linkReceipt());
    } finally {
      await service.from("app_settings").insert(saved!);
    }

    expect((await readDocument(income.id))?.provider).toBe("SUMIT");
  });

  it("AUTH-5: an admin can change a setting (restored afterwards)", async () => {
    const changed = await admin.client
      .from("app_settings")
      .update({ value: 12 })
      .eq("key", "receipt_monthly_quota")
      .select("value");
    const restored = await admin.client
      .from("app_settings")
      .update({ value: 10 })
      .eq("key", "receipt_monthly_quota")
      .select("value");

    expect(changed.data).toEqual([{ value: 12 }]);
    expect(restored.data).toEqual([{ value: 10 }]);
  });
});

describe("INC-3 / DOC-4 / DOC-5: statuses, the pending list and the counters", () => {
  it("INC-3: the incomes list says whether each income has a receipt", async () => {
    const pending = await insertIncome({ received_date: "1907-02-10" });
    const issued = await insertIncome({ received_date: "1907-02-11" });
    await recordReceipt(owner.client, issued.id, linkReceipt());

    const page = await listIncomes(owner.client, { month: "1907-02", clientId: null }, 0);
    const statuses = Object.fromEntries(page.items.map((item) => [item.id, item.receipt_issued]));

    expect(statuses[pending.id]).toBe(false);
    expect(statuses[issued.id]).toBe(true);
  });

  it("DOC-5: pending receipts list every month's incomes without a receipt, oldest first, and leave once recorded", async () => {
    const older = await insertIncome({ received_date: "1900-01-01" });
    const newer = await insertIncome({ received_date: "1900-01-02" });
    const deleted = await insertIncome({ received_date: "1900-01-01" });
    await softDeleteIncome(owner.client, deleted.id);

    const before = (await listPendingReceipts(owner.client, 0)).items.map((item) => item.id);
    await recordReceipt(owner.client, older.id, linkReceipt());
    const after = (await listPendingReceipts(owner.client, 0)).items.map((item) => item.id);

    expect(before.indexOf(older.id)).toBeGreaterThanOrEqual(0);
    expect(before.indexOf(older.id)).toBeLessThan(before.indexOf(newer.id));
    expect(before).not.toContain(deleted.id);
    expect(after).not.toContain(older.id);
    expect(after).toContain(newer.id);
  });

  it("DOC-4 / DOC-5: the summary counts pending incomes and this month's receipts by issue date", async () => {
    const thisMonth = await insertIncome();
    const lastMonth = await insertIncome();
    const before = await getReceiptsSummary(owner.client);

    await recordReceipt(owner.client, thisMonth.id, linkReceipt());
    await recordReceipt(
      owner.client,
      lastMonth.id,
      linkReceipt({ issued_date: lastDayOfPreviousMonth() }),
    );
    const after = await getReceiptsSummary(owner.client);

    // Other test files run one at a time, so only this test changes the counts here.
    expect(after.issuedThisMonth - before.issuedThisMonth).toBe(1);
    expect(before.pendingCount - after.pendingCount).toBe(2);
  });
});
