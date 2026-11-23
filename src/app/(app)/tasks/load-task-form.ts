import { logDbFailure } from "@/lib/log";
import { listTaskProjectOptions, type ProjectOption } from "@/lib/tasks/queries";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { loadRecordOrNotFound } from "../load-or-not-found";
import { loadFormClients } from "../projects/load-form-clients";

/**
 * The clients and projects the task form offers (TASK-9), with the given ones kept in the
 * lists even when archived. Call after requireAllowedUser().
 */
export async function loadTaskFormOptions(selected: {
  clientId: string | null;
  projectId: string | null;
}) {
  const [clients, projects] = await Promise.all([
    loadFormClients(selected.clientId),
    loadProjectOptions(selected.projectId),
  ]);
  return { clients, projects };
}

async function loadProjectOptions(
  projectId: string | null,
): Promise<{ options: ProjectOption[]; hasMore: boolean }> {
  try {
    return await listTaskProjectOptions(await createSupabaseServerClient(), projectId);
  } catch (error) {
    // Logged by code only; the error boundary gets no database details (SPEC 8).
    logDbFailure("tasks", "read form projects", error);
    throw new Error("Could not load the projects for the task form");
  }
}

/** Reads one record for a form page; a failure goes to the error boundary, none is a 404. */
export async function loadOrNotFound<Row>(
  operation: string,
  read: () => Promise<Row | null>,
): Promise<Row> {
  return loadRecordOrNotFound("tasks", operation, read);
}
