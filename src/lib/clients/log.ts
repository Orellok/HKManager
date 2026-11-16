import { logDbFailure } from "@/lib/log";

/** Logs a failed clients operation by its Postgres error code only (see logDbFailure). */
export function logClientFailure(operation: string, error: unknown): void {
  logDbFailure("clients", operation, error);
}
