import { execFile } from "node:child_process";

/** Docker container of the local database: `supabase_db_<project_id from config.toml>`. */
const DB_CONTAINER = "supabase_db_hkmanager";
const PSQL_TIMEOUT_MS = 30_000;

export type DatabaseRole = "anon" | "authenticated" | "service_role" | "supabase_auth_admin";

export type SqlAsRoleResult<Row> =
  { ok: true; rows: Row[] } | { ok: false; sqlState: string; message: string };

type SqlAsRoleOptions = {
  role: DatabaseRole;
  /** JWT claims as PostgREST would set them for the request (`request.jwt.claims`). */
  claims?: Record<string, unknown>;
  /** One SELECT (or a data-modifying statement with RETURNING). */
  sql: string;
};

function dollarQuote(value: string): string {
  const tag = "$hk_literal$";
  if (value.includes(tag)) {
    throw new Error("Value contains the dollar-quote tag");
  }
  return `${tag}${value}${tag}`;
}

/**
 * Runs one statement against the local database as `role`, inside a transaction that is
 * always rolled back. psql in the database container connects as the local superuser and
 * switches to `role` with SET ROLE, so privileges and RLS apply exactly as for that role.
 * Used for checks that need a role the Supabase API cannot act as (supabase_auth_admin) or
 * hand-crafted JWT claims.
 */
export function runSqlAsRole<Row>({
  role,
  claims,
  sql,
}: SqlAsRoleOptions): Promise<SqlAsRoleResult<Row>> {
  const script = [
    "\\set ON_ERROR_STOP on",
    "\\set VERBOSITY verbose",
    "begin;",
    `set local role ${role};`,
    claims
      ? `select set_config('request.jwt.claims', ${dollarQuote(JSON.stringify(claims))}, true) \\g /dev/null`
      : "",
    `with result as (${sql}) select coalesce(json_agg(result), '[]'::json) from result;`,
    "rollback;",
  ].join("\n");

  return new Promise((resolve, reject) => {
    const child = execFile(
      "docker",
      [
        "exec",
        "-i",
        DB_CONTAINER,
        "psql",
        "-U",
        "supabase_admin",
        "-d",
        "postgres",
        "-X",
        "-q",
        "-A",
        "-t",
      ],
      { timeout: PSQL_TIMEOUT_MS },
      (error, stdout, stderr) => {
        const sqlError = stderr.match(/ERROR:\s+([0-9A-Z]{5}):\s+(.*)/);
        if (sqlError) {
          resolve({ ok: false, sqlState: sqlError[1], message: sqlError[2] });
          return;
        }
        if (error) {
          reject(new Error(`psql failed: ${stderr}`, { cause: error }));
          return;
        }
        resolve({ ok: true, rows: JSON.parse(stdout.trim()) as Row[] });
      },
    );
    child.stdin?.end(script);
  });
}
