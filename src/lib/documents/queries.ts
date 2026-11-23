import type { SupabaseClient } from "@supabase/supabase-js";

import { countFromDb } from "@/lib/db-numbers";
import { toIncomeListItem, type IncomeListPage } from "@/lib/incomes/queries";
import { PAYMENT_METHOD_LABELS, isPaymentMethod } from "@/lib/incomes/payment-methods";
import { agorotFromDb } from "@/lib/money";

import type { ReceiptTransaction } from "./provider";
import type { ReceiptInput } from "./schema";

/**
 * Data access for receipts (DOC-1..5, INC-3, INC-4). Every call runs with the caller's
 * session, so RLS applies; the callers check access with requireAllowedUser() first.
 */

const TABLE = "documents";
const DOCUMENT_COLUMNS = "id, doc_number, issued_date, provider, file_path, url";

/** Rows per page of the pending receipts list. */
export const PENDING_RECEIPTS_PAGE_SIZE = 50;

/** Postgres unique_violation and foreign_key_violation. */
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
/** Raised by documents_check_references(). */
const DATE_IN_FUTURE = "HKD01";
const INCOME_DELETED = "HKD02";
const FILE_MISSING = "HKD03";
/** Raised by incomes_locked_by_document() (INC-4). */
export const INCOME_HAS_RECEIPT = "HKI05";
const DOC_NUMBER_CONSTRAINT = "documents_doc_number_key";
const INCOME_CONSTRAINT = "documents_income_id_key";

export type IncomeReceiptDocument = {
  id: string;
  doc_number: string;
  /** ISO date. */
  issued_date: string;
  provider: string;
  file_path: string | null;
  url: string | null;
};

/** An income with what DOC-1 shows and its receipt, if one was recorded (INC-3). */
export type IncomeWithReceipt = {
  id: string;
  project_id: string | null;
  transaction: ReceiptTransaction;
  document: IncomeReceiptDocument | null;
};

type IncomeReceiptRow = {
  id: string;
  received_date: string;
  amount: unknown;
  payment_method: unknown;
  notes: string | null;
  project_id: string | null;
  client: { name: string } | null;
  project: { name: string } | null;
  milestone: { description: string } | null;
  document: IncomeReceiptDocument | IncomeReceiptDocument[] | null;
};

/** DOC-1: the milestone and project, the project, or the income's notes. */
export function transactionDescription(row: {
  projectName: string | null;
  milestoneDescription: string | null;
  notes: string | null;
}): string | null {
  if (row.projectName !== null && row.milestoneDescription !== null) {
    return `${row.projectName} – ${row.milestoneDescription}`;
  }
  return row.projectName ?? row.notes;
}

/** A one-to-one embed comes back as an object; an array is accepted too, to be safe. */
function single<Row>(value: Row | Row[] | null): Row | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/** One income that is not deleted, with its transaction details and receipt, or null. */
export async function getIncomeWithReceipt(
  supabase: SupabaseClient,
  incomeId: string,
): Promise<IncomeWithReceipt | null> {
  const { data, error } = await supabase
    .from("incomes")
    .select(
      `id, received_date, amount, payment_method, notes, project_id,
       client:clients(name), project:projects(name), milestone:milestones(description),
       document:documents(${DOCUMENT_COLUMNS})`,
    )
    .eq("id", incomeId)
    .is("deleted_at", null)
    .maybeSingle<IncomeReceiptRow>();
  if (error) {
    throw new Error("Could not read the income and its receipt", { cause: error });
  }
  if (!data) {
    return null;
  }
  if (!isPaymentMethod(data.payment_method) || data.client === null) {
    throw new RangeError("The database returned an incomplete income");
  }
  return {
    id: data.id,
    project_id: data.project_id,
    transaction: {
      clientName: data.client.name,
      amount: agorotFromDb(data.amount) ?? 0,
      description: transactionDescription({
        projectName: data.project?.name ?? null,
        milestoneDescription: data.milestone?.description ?? null,
        notes: data.notes,
      }),
      receivedDate: data.received_date,
      paymentMethod: PAYMENT_METHOD_LABELS[data.payment_method],
    },
    document: single(data.document),
  };
}

/** Whether the income has a receipt (INC-3/INC-4); false also when it does not exist. */
export async function incomeHasReceipt(
  supabase: SupabaseClient,
  incomeId: string,
): Promise<boolean> {
  const { count, error } = await supabase
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .eq("income_id", incomeId);
  if (error) {
    throw new Error("Could not check the income's receipt", { cause: error });
  }
  return (count ?? 0) > 0;
}

/** Why the database refused to record or change a receipt. */
export type ReceiptRefusal =
  "doc_number_taken" | "already_recorded" | "date_in_future" | "income_missing" | "file_missing";

type DbError = { code?: string; message?: string };

function refusalOf(error: DbError): ReceiptRefusal | null {
  switch (error.code) {
    case UNIQUE_VIOLATION:
      if (error.message?.includes(DOC_NUMBER_CONSTRAINT)) {
        return "doc_number_taken";
      }
      return error.message?.includes(INCOME_CONSTRAINT) ? "already_recorded" : null;
    case DATE_IN_FUTURE:
      return "date_in_future";
    case INCOME_DELETED:
    case FOREIGN_KEY_VIOLATION:
      return "income_missing";
    case FILE_MISSING:
      return "file_missing";
    default:
      return null;
  }
}

export type SaveReceiptResult =
  { status: "saved" } | { status: "not_found" } | { status: "refused"; refusal: ReceiptRefusal };

/** Where the receipt is: exactly one of a stored file and a link (documents_source_check). */
export type ReceiptLocation = { file_path: string; url: null } | { file_path: null; url: string };

type ReceiptDetails = Pick<ReceiptInput, "doc_number" | "issued_date"> & ReceiptLocation;

/** DOC-2: records the receipt of an income (the provider comes from the settings). */
export async function recordReceipt(
  supabase: SupabaseClient,
  incomeId: string,
  details: ReceiptDetails,
): Promise<SaveReceiptResult> {
  const { error } = await supabase.from(TABLE).insert({ income_id: incomeId, ...details });
  if (error) {
    const refusal = refusalOf(error);
    if (refusal) {
      return { status: "refused", refusal };
    }
    throw new Error("Could not record the receipt", { cause: error });
  }
  return { status: "saved" };
}

/** Owner decision (M2.2): changes the receipt details of an income (audited). */
export async function updateReceipt(
  supabase: SupabaseClient,
  incomeId: string,
  details: ReceiptDetails,
): Promise<SaveReceiptResult> {
  const { data, error } = await supabase
    .from(TABLE)
    .update(details)
    .eq("income_id", incomeId)
    .select("id");
  if (error) {
    const refusal = refusalOf(error);
    if (refusal) {
      return { status: "refused", refusal };
    }
    throw new Error("Could not update the receipt", { cause: error });
  }
  return data.length > 0 ? { status: "saved" } : { status: "not_found" };
}

export type ReceiptsSummary = {
  /** DOC-5: incomes that are not deleted and have no receipt. */
  pendingCount: number;
  /** DOC-4: receipts issued this month (Asia/Jerusalem), by issue date. */
  issuedThisMonth: number;
};

/** DOC-4 / DOC-5: counted in the database. */
export async function getReceiptsSummary(supabase: SupabaseClient): Promise<ReceiptsSummary> {
  const { data, error } = await supabase
    .rpc("receipts_summary")
    .single<{ pending_count: unknown; issued_this_month: unknown }>();
  if (error) {
    throw new Error("Could not summarize receipts", { cause: error });
  }
  return {
    pendingCount: countFromDb(data.pending_count),
    issuedThisMonth: countFromDb(data.issued_this_month),
  };
}

/** DOC-5: one page of the incomes waiting for a receipt, oldest received date first. */
export async function listPendingReceipts(
  supabase: SupabaseClient,
  offset: number,
): Promise<IncomeListPage> {
  const { data, error } = await supabase.rpc("list_pending_receipts", {
    // One extra row tells whether another page exists.
    p_limit: PENDING_RECEIPTS_PAGE_SIZE + 1,
    p_offset: offset,
  });
  if (error) {
    throw new Error("Could not list pending receipts", { cause: error });
  }
  const rows = (data ?? []) as Parameters<typeof toIncomeListItem>[0][];
  return {
    items: rows.slice(0, PENDING_RECEIPTS_PAGE_SIZE).map(toIncomeListItem),
    hasMore: rows.length > PENDING_RECEIPTS_PAGE_SIZE,
  };
}
