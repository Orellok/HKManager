import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  getLocalSupabaseEnv as readLocalSupabaseEnv,
  type LocalSupabaseEnv,
} from "../../support/local-supabase-env";

const execFileAsync = promisify(execFile);

const CLI_TIMEOUT_MS = 60_000;
const CLI_MAX_BUFFER_BYTES = 10 * 1024 * 1024;

function runSupabaseCli(args: string[]): Promise<{ stdout: string }> {
  return execFileAsync("pnpm", ["exec", "supabase", ...args], {
    timeout: CLI_TIMEOUT_MS,
    maxBuffer: CLI_MAX_BUFFER_BYTES,
  });
}

/** Connection details of the local stack, from env vars or `supabase status`. */
export async function getLocalSupabaseEnv(): Promise<LocalSupabaseEnv> {
  return readLocalSupabaseEnv();
}

export type { LocalSupabaseEnv };

const NON_PERSISTENT_AUTH = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
} as const;

export async function createServiceRoleClient(): Promise<SupabaseClient> {
  const { url, serviceRoleKey } = await getLocalSupabaseEnv();
  return createClient(url, serviceRoleKey, NON_PERSISTENT_AUTH);
}

export async function createAnonClient(): Promise<SupabaseClient> {
  const { url, anonKey } = await getLocalSupabaseEnv();
  return createClient(url, anonKey, NON_PERSISTENT_AUTH);
}

export type TestUser = {
  id: string;
  email: string;
  client: SupabaseClient;
};

/** Creates a confirmed email/password user through the local admin API and signs it in. */
export async function createSignedInUser(admin: SupabaseClient, email: string): Promise<TestUser> {
  const password = randomUUID();
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError) {
    throw new Error(`Could not create test user ${email}`, { cause: createError });
  }

  const client = await createAnonClient();
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) {
    throw new Error(`Could not sign in test user ${email}`, { cause: signInError });
  }

  return { id: created.user.id, email, client };
}

export async function deleteUser(admin: SupabaseClient, userId: string): Promise<void> {
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    throw new Error(`Could not delete test user ${userId}`, { cause: error });
  }
}

/** Runs a read-only SQL query against the local database as `postgres`. */
export async function queryLocalDatabase<Row>(sql: string): Promise<Row[]> {
  const { stdout } = await runSupabaseCli([
    "db",
    "query",
    "--agent",
    "no",
    "--read-only",
    "-o",
    "json",
    sql,
  ]);
  const parsed: unknown = JSON.parse(stdout);
  if (!Array.isArray(parsed)) {
    throw new Error(`Unexpected \`supabase db query\` output: ${stdout}`);
  }
  return parsed as Row[];
}

/** A unique, fictitious address on a reserved test domain. */
export function testEmail(label: string): string {
  return `${label}-${randomUUID()}@hkmanager.test`;
}
