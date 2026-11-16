import { notFound } from "next/navigation";

import { getClient, type Client } from "@/lib/clients/queries";
import { clientIdSchema } from "@/lib/clients/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** The client named by the route, or the 404 screen. Call after requireAllowedUser(). */
export async function loadClientOrNotFound(params: Promise<{ id: string }>): Promise<Client> {
  const parsed = clientIdSchema.safeParse((await params).id);
  if (!parsed.success) {
    notFound();
  }
  const client = await getClient(await createSupabaseServerClient(), parsed.data);
  if (!client) {
    notFound();
  }
  return client;
}
