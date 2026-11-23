import { listIncomeChoices, type IncomeChoices } from "@/lib/incomes/queries";
import { logDbFailure } from "@/lib/log";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { loadRecordOrNotFound } from "../load-or-not-found";

/**
 * The projects and milestones the income form offers for `clientId` (null: none yet), with
 * the given project and milestone kept in the lists. Call after requireAllowedUser().
 */
export async function loadIncomeChoices(
  clientId: string | null,
  selected: { projectId: string | null; milestoneId: string | null },
): Promise<IncomeChoices | null> {
  if (clientId === null) {
    return null;
  }
  try {
    return await listIncomeChoices(await createSupabaseServerClient(), clientId, selected);
  } catch (error) {
    // Logged by code only; the error boundary gets no database details (SPEC 8).
    logDbFailure("incomes", "read form choices", error);
    throw new Error("Could not load the projects for the income form");
  }
}

/** Reads one record for a form page; a failure goes to the error boundary, none is a 404. */
export async function loadOrNotFound<Row>(
  operation: string,
  read: () => Promise<Row | null>,
): Promise<Row> {
  return loadRecordOrNotFound("incomes", operation, read);
}
