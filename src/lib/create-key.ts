import type { SupabaseClient } from "@supabase/supabase-js";

import { z } from "@/lib/zod";

/**
 * M7.1-8: idempotent create. Every create page renders a new key into its form (hidden field
 * `create_key`); the tables keep it in a unique `create_key` column. When the answer to a
 * create is lost and the form is sent again with the same key, the insert hits the unique
 * constraint and the action answers with the row the first request created.
 */

export const CREATE_KEY_FIELD = "create_key";

const UNIQUE_VIOLATION = "23505";

export type CreateKeyTable = "clients" | "projects" | "milestones" | "expenses" | "tasks";

/** A new key for a create form, generated with the page on the server. */
export function newCreateKey(): string {
  return crypto.randomUUID();
}

/**
 * The submitted key, or null when it is missing or not a UUID. Without a key the row is
 * created as before (a page opened before the key existed keeps working).
 */
export function readCreateKey(formData: FormData): string | null {
  const parsed = z.uuid().safeParse(formData.get(CREATE_KEY_FIELD));
  return parsed.success ? parsed.data.toLowerCase() : null;
}

/** Whether an insert failed only because a row with this create key exists. */
export function isCreateKeyConflict(
  error: { code?: string; message?: string; details?: string } | null,
  table: CreateKeyTable,
): boolean {
  if (error?.code !== UNIQUE_VIOLATION) {
    return false;
  }
  const constraint = `${table}_create_key_key`;
  return Boolean(error.message?.includes(constraint) || error.details?.includes(constraint));
}

/** The id of the row an earlier request created with this key (null if there is none). */
export async function findIdByCreateKey(
  supabase: SupabaseClient,
  table: CreateKeyTable,
  createKey: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from(table)
    .select("id")
    .eq(CREATE_KEY_FIELD, createKey)
    .maybeSingle<{ id: string }>();
  if (error) {
    throw new Error(`Could not look up the ${table} row of a create key`, { cause: error });
  }
  return data?.id ?? null;
}

/**
 * After a failed insert: the id of the row an earlier request created with the same key, or
 * null when the error has another cause (the caller handles it as before).
 */
export async function rowIdAfterCreateKeyConflict(
  supabase: SupabaseClient,
  table: CreateKeyTable,
  error: { code?: string; message?: string; details?: string },
  createKey: string | null,
): Promise<string | null> {
  if (createKey === null || !isCreateKeyConflict(error, table)) {
    return null;
  }
  const id = await findIdByCreateKey(supabase, table, createKey);
  if (id === null) {
    throw new Error(`The ${table} row of a conflicting create key is not visible`, {
      cause: error,
    });
  }
  return id;
}
