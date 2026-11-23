import { notFound } from "next/navigation";

import { logDbFailure } from "@/lib/log";

/**
 * Reads one record for a page; a failure goes to the error boundary (logged by `scope` and
 * code only, SPEC 8), none is a 404. Call after requireAllowedUser().
 */
export async function loadRecordOrNotFound<Row>(
  scope: string,
  operation: string,
  read: () => Promise<Row | null>,
): Promise<Row> {
  let row: Row | null;
  try {
    row = await read();
  } catch (error) {
    logDbFailure(scope, operation, error);
    throw new Error(`Could not load the ${scope} page`);
  }
  if (!row) {
    notFound();
  }
  return row;
}
