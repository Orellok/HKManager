import { notFound } from "next/navigation";

import { logClientFailure } from "@/lib/clients/log";
import { getClient, type Client } from "@/lib/clients/queries";
import { clientIdSchema } from "@/lib/clients/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** The client named by the route, or the 404 screen. Call after requireAllowedUser(). */
export async function loadClientOrNotFound(params: Promise<{ id: string }>): Promise<Client> {
  const parsed = clientIdSchema.safeParse((await params).id);
  if (!parsed.success) {
    notFound();
  }
  let client: Client | null;
  try {
    client = await getClient(await createSupabaseServerClient(), parsed.data);
  } catch (error) {
    // Logged by code only; the error boundary gets no database details (SPEC 8).
    logClientFailure("read", error);
    throw new Error("Could not load the client");
  }
  if (!client) {
    notFound();
  }
  return client;
}
