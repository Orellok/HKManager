"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "@/lib/zod";

import { requireAllowedUser } from "@/lib/auth/guards";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { isSameClientName } from "./duplicate-name";
import { logClientFailure } from "./log";
import { saveNotice } from "./notices";
import { CLIENTS_PATH, clientPath, withNotice, type ClientNotice } from "./paths";
import {
  deleteClient,
  findClientsWithSameName,
  getClient,
  insertClient,
  listClients,
  updateClient,
  type ClientListPage,
  type DuplicateClient,
} from "./queries";
import {
  CLIENT_FIELD_MAX_LENGTH,
  CLIENT_SEARCH_QUERY_MAX_LENGTH,
  clientIdSchema,
  readClientFormValues,
  validateClientInput,
  type ClientFieldErrors,
  type ClientFormValues,
} from "./schema";

/**
 * Server Actions for clients (CLI-1..3). Each one checks the session with
 * requireAllowedUser() before anything else and validates its input on the server, including
 * ids bound in the browser, which a caller can change.
 */

export type ClientFormState = {
  values: ClientFormValues;
  fieldErrors: ClientFieldErrors;
  formError: string | null;
};

export type ClientStatusState = { message: string | null; error: string | null };

export type SearchClientsResult = { ok: true; page: ClientListPage } | { ok: false };

export type DuplicateClientsResult = { ok: true; clients: DuplicateClient[] } | { ok: false };

const MESSAGES = {
  saveFailed: "השמירה נכשלה. הפרטים לא נשמרו, אפשר לנסות שוב.",
  notFound: "הלקוח לא נמצא. ייתכן שנמחק.",
  archived: "הלקוח הועבר לארכיון.",
  restored: "הלקוח הוחזר מהארכיון.",
  statusFailed: "הפעולה נכשלה. אפשר לנסות שוב.",
  deleteFailed: "המחיקה נכשלה. אפשר לנסות שוב.",
  deleteReferenced: "אי אפשר למחוק לקוח שיש לו פרויקטים או הכנסות. אפשר להעביר אותו לארכיון.",
} as const;

/**
 * The notice for the card after a save: warns when other clients have the same name (owner
 * decision: warn, never block). The save already succeeded, so a failed lookup only drops
 * the warning.
 */
async function noticeAfterSave(
  supabase: SupabaseClient,
  saved: "created" | "updated",
  name: string,
  id: string,
): Promise<ClientNotice> {
  try {
    return saveNotice(saved, await findClientsWithSameName(supabase, name, id));
  } catch (error) {
    logClientFailure("duplicate lookup after save", error);
    return saved;
  }
}

function revalidateClient(id: string) {
  revalidatePath(CLIENTS_PATH, "layout");
  revalidatePath(clientPath(id));
}

/** CLI-1: creates a client and opens its card. */
export async function createClientAction(
  _previous: ClientFormState,
  formData: FormData,
): Promise<ClientFormState> {
  await requireAllowedUser();
  const values = readClientFormValues(formData);
  const validation = validateClientInput(values);
  if (!validation.success) {
    return { values, fieldErrors: validation.fieldErrors, formError: null };
  }

  const supabase = await createSupabaseServerClient();
  let id: string;
  try {
    ({ id } = await insertClient(supabase, validation.data));
  } catch (error) {
    logClientFailure("create", error);
    return { values, fieldErrors: {}, formError: MESSAGES.saveFailed };
  }
  const notice = await noticeAfterSave(supabase, "created", validation.data.name, id);
  revalidateClient(id);
  redirect(withNotice(clientPath(id), notice));
}

/** CLI-1: saves changes to a client and returns to its card. */
export async function updateClientAction(
  id: string,
  _previous: ClientFormState,
  formData: FormData,
): Promise<ClientFormState> {
  await requireAllowedUser();
  const values = readClientFormValues(formData);
  const clientId = clientIdSchema.safeParse(id);
  if (!clientId.success) {
    return { values, fieldErrors: {}, formError: MESSAGES.notFound };
  }
  const validation = validateClientInput(values);
  if (!validation.success) {
    return { values, fieldErrors: validation.fieldErrors, formError: null };
  }

  const supabase = await createSupabaseServerClient();
  let previousName: string;
  try {
    // The name before the change: the duplicate warning is only for a changed name.
    const previous = await getClient(supabase, clientId.data);
    if (!previous || !(await updateClient(supabase, clientId.data, validation.data))) {
      return { values, fieldErrors: {}, formError: MESSAGES.notFound };
    }
    previousName = previous.name;
  } catch (error) {
    logClientFailure("update", error);
    return { values, fieldErrors: {}, formError: MESSAGES.saveFailed };
  }
  const notice = isSameClientName(previousName, validation.data.name)
    ? "updated"
    : await noticeAfterSave(supabase, "updated", validation.data.name, clientId.data);
  revalidateClient(clientId.data);
  redirect(withNotice(clientPath(clientId.data), notice));
}

async function setArchived(
  id: string,
  archived: boolean,
  successMessage: string,
): Promise<ClientStatusState> {
  await requireAllowedUser();
  const clientId = clientIdSchema.safeParse(id);
  if (!clientId.success) {
    return { message: null, error: MESSAGES.notFound };
  }
  let found: boolean;
  try {
    found = await updateClient(await createSupabaseServerClient(), clientId.data, {
      archived_at: archived ? new Date().toISOString() : null,
    });
  } catch (error) {
    logClientFailure(archived ? "archive" : "restore", error);
    return { message: null, error: MESSAGES.statusFailed };
  }
  if (!found) {
    return { message: null, error: MESSAGES.notFound };
  }
  revalidateClient(clientId.data);
  return { message: successMessage, error: null };
}

/** CLI-2: moves a client to the archive. */
export async function archiveClientAction(id: string): Promise<ClientStatusState> {
  return setArchived(id, true, MESSAGES.archived);
}

/** CLI-2: brings a client back from the archive. */
export async function restoreClientAction(id: string): Promise<ClientStatusState> {
  return setArchived(id, false, MESSAGES.restored);
}

/**
 * CLI-2 (owner decision): permanently deletes a client that has no projects or incomes, after
 * the confirmation dialog. The database refuses to delete a referenced client.
 */
export async function deleteClientAction(id: string): Promise<ClientStatusState> {
  await requireAllowedUser();
  const clientId = clientIdSchema.safeParse(id);
  if (!clientId.success) {
    return { message: null, error: MESSAGES.notFound };
  }
  let result: Awaited<ReturnType<typeof deleteClient>>;
  try {
    result = await deleteClient(await createSupabaseServerClient(), clientId.data);
  } catch (error) {
    logClientFailure("delete", error);
    return { message: null, error: MESSAGES.deleteFailed };
  }
  if (result === "referenced") {
    return { message: null, error: MESSAGES.deleteReferenced };
  }
  if (result === "not_found") {
    return { message: null, error: MESSAGES.notFound };
  }
  revalidateClient(clientId.data);
  redirect(withNotice(CLIENTS_PATH, "deleted"));
}

const searchInputSchema = z.object({
  view: z.enum(["active", "archived"]),
  query: z.string().max(CLIENT_SEARCH_QUERY_MAX_LENGTH),
  offset: z.number().int().min(0),
});

/**
 * CLI-3: searches by name or phone. A Server Action (POST) rather than a URL query string,
 * because a client name or phone must not appear in a URL (SPEC 8).
 */
export async function searchClientsAction(input: {
  view: "active" | "archived";
  query: string;
  offset: number;
}): Promise<SearchClientsResult> {
  await requireAllowedUser();
  const parsed = searchInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false };
  }
  try {
    return { ok: true, page: await listClients(await createSupabaseServerClient(), parsed.data) };
  } catch (error) {
    logClientFailure("search", error);
    return { ok: false };
  }
}

const duplicateInputSchema = z.object({
  name: z.string().max(CLIENT_FIELD_MAX_LENGTH.name),
  excludeId: clientIdSchema.nullable(),
});

/** Duplicate-name warning (owner decision): clients with the same name. Never blocks a save. */
export async function findDuplicateClientsAction(input: {
  name: string;
  excludeId: string | null;
}): Promise<DuplicateClientsResult> {
  await requireAllowedUser();
  const parsed = duplicateInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false };
  }
  try {
    const clients = await findClientsWithSameName(
      await createSupabaseServerClient(),
      parsed.data.name,
      parsed.data.excludeId,
    );
    return { ok: true, clients };
  } catch (error) {
    logClientFailure("duplicate lookup", error);
    return { ok: false };
  }
}
