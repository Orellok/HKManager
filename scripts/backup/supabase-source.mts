/**
 * Where a backup reads from: a hosted project (by ref, with SUPABASE_ACCESS_TOKEN and
 * SUPABASE_DB_PASSWORD in the environment) or the local stack. CLI output is captured and
 * never printed: it can contain connection details (M7.3-6).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { BackupError, httpFailure, safeCode } from "./backup-error.mts";
import type { Fetch } from "./google-drive.mts";
import { DATA_FILE, SCHEMA_FILE } from "./manifest.mts";

const execFileAsync = promisify(execFile);
const CLI_TIMEOUT_MS = 20 * 60_000;
const CLI_MAX_BUFFER = 16 * 1024 * 1024;
const PROJECT_REF = /^[a-z]{20}$/;
const MANAGEMENT_API = "https://api.supabase.com/v1/projects";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

/** Data of `public` and `auth` only: the rest is created by the migrations (restore.md). */
export const DUMPED_SCHEMAS = "public,auth";

export type RemoteSource = { kind: "remote"; projectRef: string };
export type BackupSource = RemoteSource | { kind: "local" };

export function remoteSource(projectRef: string | undefined): RemoteSource {
  if (!projectRef || !PROJECT_REF.test(projectRef)) {
    throw new BackupError("SUPABASE_PROJECT_REF is missing or not a project ref");
  }
  return { kind: "remote", projectRef };
}

async function supabaseCli(step: string, args: string[], cwd?: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("pnpm", ["exec", "supabase", ...args], {
      timeout: CLI_TIMEOUT_MS,
      maxBuffer: CLI_MAX_BUFFER,
      cwd,
    });
    return stdout;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    throw new BackupError(
      `${step} failed (exit ${typeof code === "number" ? code : "unknown"}; output hidden – ` +
        "run the same supabase command locally to see why)",
    );
  }
}

/** `supabase db dump` (pg_dump of the server's version, in Docker): data and schema files. */
export async function dumpDatabase(source: BackupSource, contentDir: string): Promise<void> {
  const target = source.kind === "remote" ? [`--remote=${source.projectRef}`] : [];
  await supabaseCli("Database data dump", [
    "db",
    "dump",
    ...target,
    "--data-only",
    "--use-copy",
    "--schema",
    DUMPED_SCHEMAS,
    "--file",
    `${contentDir}/${DATA_FILE}`,
  ]);
  await supabaseCli("Database schema dump", [
    "db",
    "dump",
    ...target,
    "--file",
    `${contentDir}/${SCHEMA_FILE}`,
  ]);
}

/**
 * The project's service key from the Management API (no extra GitHub secret): the legacy
 * `service_role` key, or else a secret API key.
 */
export async function fetchServiceKey(
  projectRef: string,
  accessToken: string,
  fetchFn: Fetch = fetch,
): Promise<string> {
  const step = "Service key lookup";
  let response: Response;
  try {
    response = await fetchFn(`${MANAGEMENT_API}/${projectRef}/api-keys?reveal=true`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new BackupError(`${step} failed: network error`);
  }
  if (!response.ok) {
    let code: string | null = null;
    try {
      code = safeCode(((await response.json()) as { error?: unknown }).error);
    } catch {
      // No code to report.
    }
    throw httpFailure(step, response.status, code);
  }
  const keys = (await response.json()) as { name?: unknown; type?: unknown; api_key?: unknown }[];
  const usable = (key: (typeof keys)[number]) =>
    typeof key.api_key === "string" && key.api_key !== "";
  const chosen =
    keys.find((key) => key.name === "service_role" && usable(key)) ??
    keys.find((key) => key.type === "secret" && usable(key));
  if (!chosen) {
    throw new BackupError(`${step} failed: the project has no service key`);
  }
  return chosen.api_key as string;
}

export type LocalStack = { apiUrl: string; serviceKey: string; dbUrl: string };

/** API URL, service key and database URL of the local stack (`supabase status`). */
export async function readLocalStack(): Promise<LocalStack> {
  const stdout = await supabaseCli("Local stack status", ["status", "-o", "env"]);
  const values: Record<string, string> = {};
  for (const line of stdout.split("\n")) {
    const match = /^([A-Z0-9_]+)="?(.*?)"?$/.exec(line);
    if (match) {
      values[match[1]] = match[2];
    }
  }
  const { API_URL: apiUrl, SERVICE_ROLE_KEY: serviceKey, DB_URL: dbUrl } = values;
  if (!apiUrl || !serviceKey || !dbUrl) {
    throw new BackupError("The local stack is not running (pnpm db:start)");
  }
  for (const url of [apiUrl, dbUrl]) {
    if (!LOCAL_HOSTS.has(new URL(url).hostname)) {
      throw new BackupError("Refusing a non-local stack");
    }
  }
  return { apiUrl, serviceKey, dbUrl };
}

/** Recreates the local database from the migrations, without the seed: a fresh project. */
export async function resetLocalDatabase(): Promise<void> {
  await supabaseCli("Local database reset", ["db", "reset", "--no-seed"]);
}
