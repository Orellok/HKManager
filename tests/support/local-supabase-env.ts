import { execFileSync } from "node:child_process";

/** Shared by the integration tests and the E2E tests: both run against local Supabase only. */

const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost"]);
const CLI_TIMEOUT_MS = 60_000;

export type LocalSupabaseEnv = {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
};

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
    throw new Error(`Tests run against local Supabase only; refusing to use ${hostname}`);
  }
}

function readFromCli(): LocalSupabaseEnv {
  let stdout: string;
  try {
    stdout = execFileSync("pnpm", ["exec", "supabase", "status", "-o", "env"], {
      encoding: "utf8",
      timeout: CLI_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"],
    });
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
  return { url: status.API_URL, anonKey: status.ANON_KEY, serviceRoleKey: status.SERVICE_ROLE_KEY };
}

let cached: LocalSupabaseEnv | undefined;

/**
 * Connection details of the local stack: from NEXT_PUBLIC_SUPABASE_URL,
 * NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY when all three are set,
 * otherwise from `supabase status`. Throws for anything other than localhost.
 */
export function getLocalSupabaseEnv(): LocalSupabaseEnv {
  if (!cached) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const env = url && anonKey && serviceRoleKey ? { url, anonKey, serviceRoleKey } : readFromCli();
    assertLocalUrl(env.url);
    cached = env;
  }
  return cached;
}
