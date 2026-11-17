import type { SupabaseClient } from "@supabase/supabase-js";

import { countFromDb } from "@/lib/db-numbers";
import { MAX_MILESTONES_PER_PROJECT } from "@/lib/milestones/queries";
import { agorotFromDb, agorotTotalFromDb, balanceAgorotFromDb } from "@/lib/money";
import type { ListPage } from "@/lib/paged-list";
import type { ClientOption } from "@/lib/projects/queries";

import { monthStart } from "./month";
import { isPaymentMethod, type PaymentMethod } from "./payment-methods";
import type { IncomeInput } from "./schema";

/**
 * Data access for incomes (INC-1, MS-4, MS-5, PRJ-3, CLI-4). Every call runs with the
 * caller's session, so RLS applies; the callers (pages and Server Actions) check access with
 * requireAllowedUser() first. Sums are computed in the database.
 */

const TABLE = "incomes";
const INCOME_COLUMNS =
  "id, client_id, project_id, milestone_id, received_date, amount, payment_method, notes";

/** Rows per page of the incomes list. */
export const INCOMES_PAGE_SIZE = 50;
/** Incomes shown on a project card; a project with more says so. */
export const PROJECT_INCOMES_LIMIT = 500;
/** Projects of a client offered in the income form, by name. */
export const PROJECT_CHOICES_LIMIT = 100;
/**
 * PostgREST returns at most this many rows per request (max_rows in supabase/config.toml)
 * and drops the rest without an error.
 */
const MAX_ROWS_PER_REQUEST = 1000;
/**
 * Projects whose milestones are read in one request: a project holds at most
 * MAX_MILESTONES_PER_PROJECT milestones (the database refuses more, HKM01), so one request
 * can never reach MAX_ROWS_PER_REQUEST and be cut short.
 */
const PROJECTS_PER_MILESTONE_REQUEST = Math.floor(
  MAX_ROWS_PER_REQUEST / MAX_MILESTONES_PER_PROJECT,
);

/** Postgres foreign_key_violation: the client, project or milestone no longer exists. */
const FOREIGN_KEY_VIOLATION = "23503";
/** Raised by incomes_check_references(). */
const REFERENCES_MISMATCH = "HKI01";
const MILESTONE_CANCELLED = "HKI02";
const DATE_IN_FUTURE = "HKI03";

export type Income = {
  id: string;
  client_id: string;
  project_id: string | null;
  milestone_id: string | null;
  /** ISO date. */
  received_date: string;
  /** Agorot, more than 0. */
  amount: number;
  payment_method: PaymentMethod;
  notes: string | null;
};

type IncomeRow = Omit<Income, "amount" | "payment_method"> & {
  amount: unknown;
  payment_method: unknown;
};

function paymentMethodFromDb(value: unknown): PaymentMethod {
  if (!isPaymentMethod(value)) {
    throw new RangeError("The database returned an unknown payment method");
  }
  return value;
}

function toIncome(row: IncomeRow): Income {
  return {
    ...row,
    amount: agorotFromDb(row.amount) ?? 0,
    payment_method: paymentMethodFromDb(row.payment_method),
  };
}

/** One income that is not deleted, or null when it does not exist (or is not visible). */
export async function getIncome(supabase: SupabaseClient, id: string): Promise<Income | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select(INCOME_COLUMNS)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle<IncomeRow>();
  if (error) {
    throw new Error("Could not read the income", { cause: error });
  }
  return data ? toIncome(data) : null;
}

/** Why the database refused to save an income. */
export type IncomeRefusal =
  "references_mismatch" | "milestone_cancelled" | "date_in_future" | "reference_missing";

const REFUSALS: Record<string, IncomeRefusal> = {
  [REFERENCES_MISMATCH]: "references_mismatch",
  [MILESTONE_CANCELLED]: "milestone_cancelled",
  [DATE_IN_FUTURE]: "date_in_future",
  [FOREIGN_KEY_VIOLATION]: "reference_missing",
};

export type SaveIncomeResult =
  | { status: "saved"; id: string }
  /** MS-5: above the milestone's current balance (agorot) and not confirmed for it. */
  | { status: "needs_confirmation"; balance: number }
  | { status: "not_found" }
  | { status: "refused"; refusal: IncomeRefusal };

type SaveRow = { result: unknown; income_id: unknown; balance: unknown };

/**
 * MS-4 / MS-5 / INC-1: records a new income (id null) or saves changes to one, through
 * save_income(), which checks a milestone payment against the balance under a lock.
 * `confirmedBalance` is the balance the user confirmed paying above, or null.
 */
export async function saveIncome(
  supabase: SupabaseClient,
  id: string | null,
  input: IncomeInput,
  confirmedBalance: number | null,
): Promise<SaveIncomeResult> {
  const { data, error } = await supabase
    .rpc("save_income", {
      p_income_id: id,
      p_client_id: input.client_id,
      p_project_id: input.project_id,
      p_milestone_id: input.milestone_id,
      p_received_date: input.received_date,
      p_amount: input.amount,
      p_payment_method: input.payment_method,
      p_notes: input.notes,
      p_confirmed_balance: confirmedBalance,
    })
    .single<SaveRow>();
  if (error) {
    const refusal = error.code ? REFUSALS[error.code] : undefined;
    if (refusal) {
      return { status: "refused", refusal };
    }
    throw new Error("Could not save the income", { cause: error });
  }
  if (data.result === "saved" && typeof data.income_id === "string") {
    return { status: "saved", id: data.income_id };
  }
  if (data.result === "needs_confirmation") {
    return { status: "needs_confirmation", balance: balanceAgorotFromDb(data.balance) };
  }
  if (data.result === "not_found") {
    return { status: "not_found" };
  }
  throw new Error("save_income returned an unexpected result");
}

export type DeleteIncomeResult =
  { status: "deleted"; projectId: string | null } | { status: "not_found" };

/** SPEC 6: soft-deletes an income (the audit trigger records it). */
export async function softDeleteIncome(
  supabase: SupabaseClient,
  id: string,
): Promise<DeleteIncomeResult> {
  const { data, error } = await supabase
    .from(TABLE)
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null)
    .select("project_id");
  if (error) {
    throw new Error("Could not delete the income", { cause: error });
  }
  const row = (data as { project_id: string | null }[])[0];
  return row ? { status: "deleted", projectId: row.project_id } : { status: "not_found" };
}

export type IncomeListItem = {
  id: string;
  /** ISO date. */
  received_date: string;
  /** Agorot. */
  amount: number;
  payment_method: PaymentMethod;
  client_id: string;
  client_name: string;
  project_id: string | null;
  project_name: string | null;
  milestone_id: string | null;
  milestone_description: string | null;
};

export type IncomeListPage = ListPage<IncomeListItem>;

export type IncomeListFilter = {
  /** "YYYY-MM". */
  month: string;
  /** Only this client's incomes, or null for all clients. */
  clientId: string | null;
};

type IncomeListRow = Omit<IncomeListItem, "amount" | "payment_method"> & {
  amount: unknown;
  payment_method: unknown;
};

/** INC-1: one page of a month's incomes, newest received date first. */
export async function listIncomes(
  supabase: SupabaseClient,
  { month, clientId }: IncomeListFilter,
  offset: number,
): Promise<IncomeListPage> {
  const { data, error } = await supabase.rpc("list_incomes", {
    p_month: monthStart(month),
    p_client_id: clientId,
    // One extra row tells whether another page exists.
    p_limit: INCOMES_PAGE_SIZE + 1,
    p_offset: offset,
  });
  if (error) {
    throw new Error("Could not list incomes", { cause: error });
  }
  const rows = (data ?? []) as IncomeListRow[];
  return {
    items: rows.slice(0, INCOMES_PAGE_SIZE).map((row) => ({
      ...row,
      amount: agorotFromDb(row.amount) ?? 0,
      payment_method: paymentMethodFromDb(row.payment_method),
    })),
    hasMore: rows.length > INCOMES_PAGE_SIZE,
  };
}

export type IncomesMonthSummary = { count: number; total: number };

/** INC-1: the number and total (agorot) of the incomes the list filter selects. */
export async function getIncomesMonthSummary(
  supabase: SupabaseClient,
  { month, clientId }: IncomeListFilter,
): Promise<IncomesMonthSummary> {
  const { data, error } = await supabase
    .rpc("incomes_month_summary", { p_month: monthStart(month), p_client_id: clientId })
    .single<{ income_count: unknown; total: unknown }>();
  if (error) {
    throw new Error("Could not summarize incomes", { cause: error });
  }
  return { count: countFromDb(data.income_count), total: agorotTotalFromDb(data.total) };
}

export type ProjectIncome = Pick<
  Income,
  "id" | "milestone_id" | "received_date" | "amount" | "payment_method"
>;

/** PRJ-3: a project's incomes that are not deleted, oldest received date first. */
export async function listProjectIncomes(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ListPage<ProjectIncome>> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("id, milestone_id, received_date, amount, payment_method")
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .order("received_date")
    .order("created_at")
    .order("id")
    .limit(PROJECT_INCOMES_LIMIT + 1);
  if (error) {
    throw new Error("Could not list the project's incomes", { cause: error });
  }
  const rows = data as (Omit<ProjectIncome, "amount" | "payment_method"> & {
    amount: unknown;
    payment_method: unknown;
  })[];
  return {
    items: rows.slice(0, PROJECT_INCOMES_LIMIT).map((row) => ({
      ...row,
      amount: agorotFromDb(row.amount) ?? 0,
      payment_method: paymentMethodFromDb(row.payment_method),
    })),
    hasMore: rows.length > PROJECT_INCOMES_LIMIT,
  };
}

/** PRJ-3: the total of the project's incomes that are not deleted (agorot). */
export async function getProjectPaidTotal(
  supabase: SupabaseClient,
  projectId: string,
): Promise<number> {
  const { data, error } = await supabase.rpc("project_paid_total", { p_project_id: projectId });
  if (error) {
    throw new Error("Could not total the project's incomes", { cause: error });
  }
  return agorotTotalFromDb(data);
}

export type ClientPaymentSummary = {
  /** Agorot the client paid (incomes that are not deleted). */
  totalPaid: number;
  /** Agorot still to pay on the milestones of the client's projects that are not archived. */
  openBalance: number;
};

/** CLI-4: what the client paid and its open balance. */
export async function getClientPaymentSummary(
  supabase: SupabaseClient,
  clientId: string,
): Promise<ClientPaymentSummary> {
  const { data, error } = await supabase
    .rpc("client_payment_summary", { p_client_id: clientId })
    .single<{ total_paid: unknown; open_balance: unknown }>();
  if (error) {
    throw new Error("Could not summarize the client's payments", { cause: error });
  }
  return {
    totalPaid: agorotTotalFromDb(data.total_paid),
    openBalance: agorotTotalFromDb(data.open_balance),
  };
}

export type MilestoneChoice = {
  id: string;
  description: string;
  /** Agorot left to pay; negative when overpaid. */
  balance: number;
};

export type ProjectChoice = {
  id: string;
  name: string;
  archived: boolean;
  milestones: MilestoneChoice[];
};

export type IncomeChoices = {
  projects: ProjectChoice[];
  /** The client has more projects than PROJECT_CHOICES_LIMIT. */
  hasMoreProjects: boolean;
};

type Selected = { projectId: string | null; milestoneId: string | null };

/**
 * INC-1: the projects of a client (archived ones too: a late payment is common) with their
 * milestones, for the income form. Cancelled milestones are left out (owner decision: no
 * payment for a cancelled milestone), except the one already selected on an edited income.
 * The selected project is included even beyond the limit.
 */
export async function listIncomeChoices(
  supabase: SupabaseClient,
  clientId: string,
  selected: Selected,
): Promise<IncomeChoices> {
  const { data, error } = await supabase
    .from("projects")
    .select("id, name, archived_at")
    .eq("client_id", clientId)
    .order("name")
    .order("id")
    .limit(PROJECT_CHOICES_LIMIT + 1);
  if (error) {
    throw new Error("Could not list the client's projects for the income form", { cause: error });
  }
  type ProjectRow = { id: string; name: string; archived_at: string | null };
  const rows = data as ProjectRow[];
  const projects = rows.slice(0, PROJECT_CHOICES_LIMIT);
  if (selected.projectId && !projects.some((project) => project.id === selected.projectId)) {
    const extra = await supabase
      .from("projects")
      .select("id, name, archived_at")
      .eq("id", selected.projectId)
      .eq("client_id", clientId)
      .maybeSingle<ProjectRow>();
    if (extra.error) {
      throw new Error("Could not read the selected project", { cause: extra.error });
    }
    if (extra.data) {
      projects.push(extra.data);
    }
  }

  const milestonesByProject = new Map<string, MilestoneChoice[]>();
  for (const row of await listChoiceMilestones(
    supabase,
    projects.map((project) => project.id),
  )) {
    if (row.cancelled_at !== null && row.id !== selected.milestoneId) {
      continue;
    }
    const list = milestonesByProject.get(row.project_id) ?? [];
    list.push({
      id: row.id,
      description: row.description,
      balance: balanceAgorotFromDb(row.balance),
    });
    milestonesByProject.set(row.project_id, list);
  }

  return {
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      archived: project.archived_at !== null,
      milestones: milestonesByProject.get(project.id) ?? [],
    })),
    hasMoreProjects: rows.length > PROJECT_CHOICES_LIMIT,
  };
}

type ChoiceMilestoneRow = {
  id: string;
  project_id: string;
  description: string;
  balance: unknown;
  cancelled_at: string | null;
};

/**
 * The milestones of the given projects, in their order. Read in requests of at most
 * PROJECTS_PER_MILESTONE_REQUEST projects, sent together, so no answer can be truncated by
 * PostgREST's row limit (at most PROJECT_CHOICES_LIMIT + 1 projects: 11 requests).
 */
async function listChoiceMilestones(
  supabase: SupabaseClient,
  projectIds: readonly string[],
): Promise<ChoiceMilestoneRow[]> {
  const chunks: string[][] = [];
  for (let start = 0; start < projectIds.length; start += PROJECTS_PER_MILESTONE_REQUEST) {
    chunks.push(projectIds.slice(start, start + PROJECTS_PER_MILESTONE_REQUEST));
  }
  const answers = await Promise.all(
    chunks.map((chunk) =>
      supabase
        .from("milestone_balances")
        .select("id, project_id, description, balance, cancelled_at")
        .in("project_id", chunk)
        .order("project_id")
        .order("sort_order")
        .limit(chunk.length * MAX_MILESTONES_PER_PROJECT),
    ),
  );
  return answers.flatMap(({ data, error }) => {
    if (error) {
      throw new Error("Could not list milestones for the income form", { cause: error });
    }
    return data as ChoiceMilestoneRow[];
  });
}

/** Archived clients offered in the incomes list's client filter, by name. */
export const ARCHIVED_FILTER_CLIENTS_LIMIT = 500;

export type FilterClients = {
  /** Archived clients that have incomes, by name, marked archived. */
  options: ClientOption[];
  /** More such clients exist than ARCHIVED_FILTER_CLIENTS_LIMIT. */
  hasMore: boolean;
};

/**
 * INC-1: archived clients with at least one income that is not deleted, for the incomes
 * list's client filter (payments of archived clients are allowed, so their incomes must be
 * reachable). Only the existence of an income is read, never the incomes themselves.
 */
export async function listArchivedClientsWithIncomes(
  supabase: SupabaseClient,
): Promise<FilterClients> {
  const { data, error } = await supabase
    .from("clients")
    .select("id, name, incomes!inner(id)")
    .not("archived_at", "is", null)
    .is("incomes.deleted_at", null)
    .order("name")
    .order("id")
    .limit(1, { referencedTable: "incomes" })
    // One extra row tells whether more exist.
    .limit(ARCHIVED_FILTER_CLIENTS_LIMIT + 1);
  if (error) {
    throw new Error("Could not list archived clients with incomes", { cause: error });
  }
  const rows = data as { id: string; name: string }[];
  return {
    options: rows
      .slice(0, ARCHIVED_FILTER_CLIENTS_LIMIT)
      .map(({ id, name }) => ({ id, name, archived: true })),
    hasMore: rows.length > ARCHIVED_FILTER_CLIENTS_LIMIT,
  };
}
