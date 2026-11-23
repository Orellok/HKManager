import type { SupabaseClient } from "@supabase/supabase-js";

import { agorotFromDb } from "@/lib/money";

import type { CeilingThreshold } from "./status";

/**
 * Data access for the yearly ceilings (CEIL-1) and the banner acknowledgements (CEIL-4).
 * Every call runs with the caller's session, so RLS applies: writing a ceiling needs an
 * admin, the callers check with requireAdmin() / requireAllowedUser() first.
 */

const TABLE = "tax_year_settings";

/** Postgres unique_violation: the year already has a ceiling. */
const UNIQUE_VIOLATION = "23505";

/** One row per year in 1900–2100, so a list is bounded far below PostgREST's row limit. */
const MAX_YEARS = 201;

export type TaxYearCeiling = { year: number; ceiling: number };

type CeilingRow = { year: number; exempt_ceiling: unknown };

function toCeiling(row: CeilingRow): TaxYearCeiling {
  return { year: row.year, ceiling: agorotFromDb(row.exempt_ceiling) ?? 0 };
}

/** Every year with a ceiling, newest first. */
export async function listTaxYearCeilings(supabase: SupabaseClient): Promise<TaxYearCeiling[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("year, exempt_ceiling")
    .order("year", { ascending: false })
    .limit(MAX_YEARS);
  if (error) {
    throw new Error("Could not list the yearly ceilings", { cause: error });
  }
  return (data as CeilingRow[]).map(toCeiling);
}

/** The ceiling of a year, or null when the year has none. */
export async function getTaxYearCeiling(
  supabase: SupabaseClient,
  year: number,
): Promise<TaxYearCeiling | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("year, exempt_ceiling")
    .eq("year", year)
    .maybeSingle<CeilingRow>();
  if (error) {
    throw new Error("Could not read the yearly ceiling", { cause: error });
  }
  return data ? toCeiling(data) : null;
}

export type SaveCeilingResult =
  { status: "saved" } | { status: "not_found" } | { status: "year_taken" };

/** CEIL-1: adds the ceiling of a year that has none. */
export async function createTaxYearCeiling(
  supabase: SupabaseClient,
  input: TaxYearCeiling,
): Promise<SaveCeilingResult> {
  const { error } = await supabase
    .from(TABLE)
    .insert({ year: input.year, exempt_ceiling: input.ceiling });
  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return { status: "year_taken" };
    }
    throw new Error("Could not add the yearly ceiling", { cause: error });
  }
  return { status: "saved" };
}

/** CEIL-1: changes the ceiling of a year. */
export async function updateTaxYearCeiling(
  supabase: SupabaseClient,
  input: TaxYearCeiling,
): Promise<SaveCeilingResult> {
  const { data, error } = await supabase
    .from(TABLE)
    .update({ exempt_ceiling: input.ceiling })
    .eq("year", input.year)
    .select("year");
  if (error) {
    throw new Error("Could not update the yearly ceiling", { cause: error });
  }
  return data.length > 0 ? { status: "saved" } : { status: "not_found" };
}

/** Raised by acknowledge_ceiling_alert(): the year's turnover is below the threshold. */
const THRESHOLD_NOT_CROSSED = "HKC01";

/** "not_crossed": the year has no ceiling or its turnover has not reached the threshold. */
export type AckCeilingResult = "acknowledged" | "not_crossed";

/** CEIL-4: acknowledges a threshold of a year (and every lower one), for both users. */
export async function acknowledgeCeilingAlert(
  supabase: SupabaseClient,
  year: number,
  threshold: CeilingThreshold,
): Promise<AckCeilingResult> {
  const { error } = await supabase.rpc("acknowledge_ceiling_alert", {
    p_year: year,
    p_threshold: threshold,
  });
  if (error?.code === THRESHOLD_NOT_CROSSED) {
    return "not_crossed";
  }
  if (error) {
    throw new Error("Could not acknowledge the ceiling alert", { cause: error });
  }
  return "acknowledged";
}
