import { logDbFailure } from "@/lib/log";
import {
  getClientOption,
  listActiveClientOptions,
  type ClientOption,
} from "@/lib/projects/queries";
import { projectIdSchema } from "@/lib/projects/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * The clients the project form offers: the active ones, by name, plus `selectedId` when it
 * is not among them (an archived client of an edited project). Also returns the selected
 * client itself, or null when the id is missing, malformed or unknown, and whether more
 * active clients exist than the list holds. Call after
 * requireAllowedUser().
 */
export async function loadFormClients(selectedId: unknown): Promise<{
  options: ClientOption[];
  /** More active clients exist than the form lists. */
  hasMore: boolean;
  selected: ClientOption | null;
}> {
  const parsed = projectIdSchema.safeParse(selectedId);
  try {
    const supabase = await createSupabaseServerClient();
    const [{ options, hasMore }, selected] = await Promise.all([
      listActiveClientOptions(supabase),
      parsed.success ? getClientOption(supabase, parsed.data) : null,
    ]);
    if (selected && !options.some((option) => option.id === selected.id)) {
      options.push(selected);
    }
    return { options, hasMore, selected };
  } catch (error) {
    // Logged by code only; the error boundary gets no database details (SPEC 8).
    logDbFailure("projects", "read form clients", error);
    throw new Error("Could not load the clients for the project form");
  }
}
