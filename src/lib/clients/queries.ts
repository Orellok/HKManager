import type { SupabaseClient } from "@supabase/supabase-js";

import type { ListView } from "@/lib/list-view";

import { duplicateNameKey } from "./duplicate-name";
import { phoneSearchDigits } from "./phone";
import type { ClientInput } from "./schema";

/**
 * Data access for clients. Every call runs with the caller's session, so RLS applies; the
 * callers (pages and Server Actions) check access with requireAllowedUser() first.
 */

const TABLE = "clients";
const DETAIL_COLUMNS = "id, name, phone, email, address, notes, archived_at";

/** Rows per list page. The list is never read without a limit. */
export const CLIENTS_PAGE_SIZE = 25;

/** Postgres foreign_key_violation: a row elsewhere (a project, an income) references it. */
export const FOREIGN_KEY_VIOLATION = "23503";

export type ClientListView = ListView;

export type Client = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  archived_at: string | null;
};

export type ClientListItem = Pick<Client, "id" | "name" | "phone">;

export type ClientListPage = { items: ClientListItem[]; hasMore: boolean };

export type DuplicateClient = Pick<Client, "id" | "name" | "archived_at">;

type ListOptions = { view: ClientListView; query: string; offset: number };

/** CLI-3: one page of the active or archived list, filtered by name or phone digits. */
export async function listClients(
  supabase: SupabaseClient,
  { view, query, offset }: ListOptions,
): Promise<ClientListPage> {
  const trimmedQuery = query.trim();
  const { data, error } = await supabase.rpc("search_clients", {
    p_archived: view === "archived",
    p_name_query: trimmedQuery,
    p_phone_digits: phoneSearchDigits(trimmedQuery),
    // One extra row tells whether another page exists.
    p_limit: CLIENTS_PAGE_SIZE + 1,
    p_offset: offset,
  });
  if (error) {
    throw new Error("Could not list clients", { cause: error });
  }
  const rows = (data ?? []) as Client[];
  return {
    items: rows.slice(0, CLIENTS_PAGE_SIZE).map(({ id, name, phone }) => ({ id, name, phone })),
    hasMore: rows.length > CLIENTS_PAGE_SIZE,
  };
}

/** CLI-4: one client, or null when it does not exist (or is not visible). */
export async function getClient(supabase: SupabaseClient, id: string): Promise<Client | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select(DETAIL_COLUMNS)
    .eq("id", id)
    .maybeSingle<Client>();
  if (error) {
    throw new Error("Could not read the client", { cause: error });
  }
  return data;
}

/** Clients with the same name, ignoring case and surrounding spaces (at most five). */
export async function findClientsWithSameName(
  supabase: SupabaseClient,
  name: string,
  excludeId: string | null,
): Promise<DuplicateClient[]> {
  const key = duplicateNameKey(name);
  if (key === "") {
    return [];
  }
  const { data, error } = await supabase.rpc("find_clients_by_name_key", {
    p_name_key: key,
    p_exclude_id: excludeId,
  });
  if (error) {
    throw new Error("Could not look up clients with the same name", { cause: error });
  }
  return ((data ?? []) as Client[]).map(({ id, name: clientName, archived_at }) => ({
    id,
    name: clientName,
    archived_at,
  }));
}

export async function insertClient(supabase: SupabaseClient, input: ClientInput) {
  const { data, error } = await supabase.from(TABLE).insert(input).select("id").single<{
    id: string;
  }>();
  if (error) {
    throw new Error("Could not create the client", { cause: error });
  }
  return data;
}

/** Returns false when no visible client has this id. */
export async function updateClient(
  supabase: SupabaseClient,
  id: string,
  changes: Partial<ClientInput> & { archived_at?: string | null },
): Promise<boolean> {
  const { data, error } = await supabase.from(TABLE).update(changes).eq("id", id).select("id");
  if (error) {
    throw new Error("Could not update the client", { cause: error });
  }
  return data.length > 0;
}

export type DeleteClientResult = "deleted" | "not_found" | "referenced";

/** Permanently deletes a client. A client that other records reference is kept (CLI-2). */
export async function deleteClient(
  supabase: SupabaseClient,
  id: string,
): Promise<DeleteClientResult> {
  const { data, error } = await supabase.from(TABLE).delete().eq("id", id).select("id");
  if (error) {
    if (error.code === FOREIGN_KEY_VIOLATION) {
      return "referenced";
    }
    throw new Error("Could not delete the client", { cause: error });
  }
  return data.length > 0 ? "deleted" : "not_found";
}
