import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const execFileAsync = promisify(execFile);

const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost"]);
const CLI_TIMEOUT_MS = 60_000;
const CLI_MAX_BUFFER_BYTES = 10 * 1024 * 1024;

export type LocalSupabaseEnv = {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
};

function runSupabaseCli(args: string[]): Promise<{ stdout: string }> {
  return execFileAsync("pnpm", ["exec", "supabase", ...args], {
    timeout: CLI_TIMEOUT_MS,
    maxBuffer: CLI_MAX_BUFFER_BYTES,
  });
}

function parseDotenv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
    if (match) {
      values[match[1]] = match[2];
    }
  }
  return values;
}

function assertLocalUrl(url: string): void {
  const { hostname } = new URL(url);
  if (!LOCAL_HOSTNAMES.has(hostname)) {
    throw new Error(
      `Integration tests run against local Supabase only; refusing to use ${hostname}`,
    );
  }
}

let cachedEnv: Promise<LocalSupabaseEnv> | undefined;

async function resolveEnv(): Promise<LocalSupabaseEnv> {
  const fromProcess = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };

  let env: LocalSupabaseEnv;
  if (fromProcess.url && fromProcess.anonKey && fromProcess.serviceRoleKey) {
    env = {
      url: fromProcess.url,
      anonKey: fromProcess.anonKey,
      serviceRoleKey: fromProcess.serviceRoleKey,
    };
  } else {
    let stdout: string;
    try {
      ({ stdout } = await runSupabaseCli(["status", "-o", "env"]));
    } catch (error) {
      throw new Error("Local Supabase is not running. Start it with `pnpm db:start`.", {
        cause: error,
      });
    }
    const status = parseDotenv(stdout);
    if (!status.API_URL || !status.ANON_KEY || !status.SERVICE_ROLE_KEY) {
      throw new Error(
        "`supabase status -o env` did not print API_URL, ANON_KEY and SERVICE_ROLE_KEY",
      );
    }
    env = {
      url: status.API_URL,
      anonKey: status.ANON_KEY,
      serviceRoleKey: status.SERVICE_ROLE_KEY,
    };
  }

  assertLocalUrl(env.url);
  return env;
}

/** Connection details of the local stack, from env vars or `supabase status`. */
export function getLocalSupabaseEnv(): Promise<LocalSupabaseEnv> {
  cachedEnv ??= resolveEnv();
  return cachedEnv;
}

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
