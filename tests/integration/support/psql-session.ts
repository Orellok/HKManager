import { execFile } from "node:child_process";

/** Docker container of the local database: `supabase_db_<project_id from config.toml>`. */
const DB_CONTAINER = "supabase_db_hkmanager";
const PSQL_TIMEOUT_MS = 30_000;

export type PsqlSessionResult = { ok: true } | { ok: false; sqlState: string; message: string };

/**
 * Runs a SQL script in its own database session (as the local superuser) and commits what it
 * does, stopping at the first error. Two of these started at once are two concurrent
 * transactions, so a test can hold a row lock in one (e.g. with pg_sleep before COMMIT)
 * while the other writes, and check how the database serializes them. Triggers and
 * constraints apply as for any writer; RLS does not (superuser).
 */
export function runPsqlSession(script: string): Promise<PsqlSessionResult> {
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
        "-v",
        "ON_ERROR_STOP=1",
        "-v",
        "VERBOSITY=verbose",
      ],
      { timeout: PSQL_TIMEOUT_MS },
      (error, _stdout, stderr) => {
        const sqlError = stderr.match(/ERROR:\s+([0-9A-Z]{5}):\s+(.*)/);
        if (sqlError) {
          resolve({ ok: false, sqlState: sqlError[1], message: sqlError[2] });
          return;
        }
        if (error) {
          reject(new Error(`psql failed: ${stderr}`, { cause: error }));
          return;
        }
        resolve({ ok: true });
      },
    );
    child.stdin?.end(`\\set VERBOSITY verbose\n${script}`);
  });
}
