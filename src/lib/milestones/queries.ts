import type { SupabaseClient } from "@supabase/supabase-js";

import { countFromDb } from "@/lib/db-numbers";
import { agorotFromDb } from "@/lib/money";

import type { MoveDirection } from "./reorder";
import type { MilestoneInput } from "./schema";

/**
 * Data access for milestones. Every call runs with the caller's session, so RLS applies; the
 * callers (pages and Server Actions) check access with requireAllowedUser() first.
 */

const TABLE = "milestones";
/** Milestones with paid and balance (SPEC 6); paid is 0 until incomes (M2). */
const BALANCES_VIEW = "milestone_balances";
const BALANCE_COLUMNS =
  "id, project_id, description, amount, due_date, sort_order, cancelled_at, paid, balance";

/** The database refuses more milestones per project (HKM01), so one read gets them all. */
export const MAX_MILESTONES_PER_PROJECT = 100;

/** Postgres foreign_key_violation. */
const FOREIGN_KEY_VIOLATION = "23503";
/** Raised by milestones_assign_sort_order(): the project has the maximum number. */
const TOO_MANY_MILESTONES = "HKM01";

export type Milestone = {
  id: string;
  project_id: string;
  description: string;
  /** Agorot. */
  amount: number;
  /** ISO date. */
  due_date: string;
  sort_order: number;
  cancelled_at: string | null;
  /** Agorot paid so far (0 until M2). */
  paid: number;
  /** Agorot left to pay. */
  balance: number;
};

type MilestoneRow = Omit<Milestone, "amount" | "paid" | "balance"> & {
  amount: unknown;
  paid: unknown;
  balance: unknown;
};

function toMilestone(row: MilestoneRow): Milestone {
  return {
    ...row,
    amount: agorotFromDb(row.amount) ?? 0,
    paid: agorotFromDb(row.paid) ?? 0,
    balance: agorotFromDb(row.balance) ?? 0,
  };
}

/** MS-1: a project's milestones in their order (all of them; see the per-project bound). */
export async function listProjectMilestones(
  supabase: SupabaseClient,
  projectId: string,
): Promise<Milestone[]> {
  const { data, error } = await supabase
    .from(BALANCES_VIEW)
    .select(BALANCE_COLUMNS)
    .eq("project_id", projectId)
    .order("sort_order")
    .limit(MAX_MILESTONES_PER_PROJECT);
  if (error) {
    throw new Error("Could not list the project's milestones", { cause: error });
  }
  return (data as MilestoneRow[]).map(toMilestone);
}

/** One milestone, or null when it does not exist (or is not visible). */
export async function getMilestone(
  supabase: SupabaseClient,
  id: string,
): Promise<Milestone | null> {
  const { data, error } = await supabase
    .from(BALANCES_VIEW)
    .select(BALANCE_COLUMNS)
    .eq("id", id)
    .maybeSingle<MilestoneRow>();
  if (error) {
    throw new Error("Could not read the milestone", { cause: error });
  }
  return data ? toMilestone(data) : null;
}

export type InsertMilestoneResult = "created" | "project_missing" | "too_many";

/** MS-1: adds a milestone at the end of the project's list (the database sets the place). */
export async function insertMilestone(
  supabase: SupabaseClient,
  projectId: string,
  input: MilestoneInput,
): Promise<InsertMilestoneResult> {
  const { error } = await supabase.from(TABLE).insert({ ...input, project_id: projectId });
  if (error) {
    if (error.code === FOREIGN_KEY_VIOLATION) {
      return "project_missing";
    }
    if (error.code === TOO_MANY_MILESTONES) {
      return "too_many";
    }
    throw new Error("Could not create the milestone", { cause: error });
  }
  return "created";
}

export type UpdateMilestoneResult =
  { status: "updated"; projectId: string } | { status: "not_found" };

/** Saves changes to a milestone's details or its cancellation (MS-1, owner decision). */
export async function updateMilestone(
  supabase: SupabaseClient,
  id: string,
  changes: Partial<MilestoneInput> & { cancelled_at?: string | null },
): Promise<UpdateMilestoneResult> {
  const { data, error } = await supabase
    .from(TABLE)
    .update(changes)
    .eq("id", id)
    .select("project_id");
  if (error) {
    throw new Error("Could not update the milestone", { cause: error });
  }
  const row = (data as { project_id: string }[])[0];
  return row ? { status: "updated", projectId: row.project_id } : { status: "not_found" };
}

export type DeleteMilestoneResult = "deleted" | "not_found" | "referenced";

/**
 * Owner decision (M1.3): permanently deletes a milestone. Incomes (M2) will reference
 * milestones, and the database will then refuse to delete one with payments.
 */
export async function deleteMilestone(
  supabase: SupabaseClient,
  id: string,
): Promise<DeleteMilestoneResult> {
  const { data, error } = await supabase.from(TABLE).delete().eq("id", id).select("id");
  if (error) {
    if (error.code === FOREIGN_KEY_VIOLATION) {
      return "referenced";
    }
    throw new Error("Could not delete the milestone", { cause: error });
  }
  return data.length > 0 ? "deleted" : "not_found";
}

export type MoveMilestoneResult =
  | {
      /** "edge": already first (up) or last (down); nothing changed. */
      status: "moved" | "edge";
      /** The milestone's place in its project's list after the call, 1-based. */
      place: number;
      /** The number of milestones in the project. */
      total: number;
    }
  | { status: "not_found" };

type MoveRow = { result: unknown; place: unknown; total: unknown };

/**
 * MS-1: swaps a milestone with its neighbour, atomically and under a per-project lock. The
 * place and total come from the database, read under that lock.
 */
export async function moveMilestone(
  supabase: SupabaseClient,
  id: string,
  direction: MoveDirection,
): Promise<MoveMilestoneResult> {
  const { data, error } = await supabase
    .rpc("move_milestone", { p_milestone_id: id, p_direction: direction })
    .single<MoveRow>();
  if (error) {
    throw new Error("Could not move the milestone", { cause: error });
  }
  if (data.result === "not_found") {
    return { status: "not_found" };
  }
  if (data.result !== "moved" && data.result !== "edge") {
    throw new Error("move_milestone returned an unexpected result");
  }
  const place = countFromDb(data.place);
  const total = countFromDb(data.total);
  if (place < 1 || place > total) {
    throw new Error("move_milestone returned a place outside the list");
  }
  return { status: data.result, place, total };
}
