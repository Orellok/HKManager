/** Backup names and the retention rule (SPEC 8, M7.3-2, 4). */
import { BackupError } from "./backup-error.mts";
import type { DriveFile } from "./google-drive.mts";

export const KEEP_BACKUPS = 12;
export const BACKUP_ENVIRONMENTS = ["production", "staging"] as const;
export type BackupEnvironment = (typeof BACKUP_ENVIRONMENTS)[number] | "local";

export function isBackupEnvironment(value: unknown): value is BackupEnvironment {
  return value === "production" || value === "staging" || value === "local";
}

/** hkmanager-production-2026-11-28T024107Z.tar.gz (UTC; sorts by time as text). */
export function backupFileName(environment: BackupEnvironment, at: Date): string {
  const stamp = at
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/:/g, "");
  return `hkmanager-${environment}-${stamp}.tar.gz`;
}

export function backupNamePattern(environment: BackupEnvironment): RegExp {
  return new RegExp(`^hkmanager-${environment}-\\d{4}-\\d{2}-\\d{2}T\\d{6}Z\\.tar\\.gz$`);
}

/**
 * The backups to delete once `uploadedId` is verified: the environment's backups beyond the
 * newest `keep`. Throws (deleting nothing) when the new backup is not among the kept ones.
 */
export function selectBackupsToDelete(
  files: DriveFile[],
  environment: BackupEnvironment,
  uploadedId: string,
  keep: number = KEEP_BACKUPS,
): DriveFile[] {
  const pattern = backupNamePattern(environment);
  const backups = files
    .filter((file) => pattern.test(file.name))
    .sort((a, b) => (a.name === b.name ? a.id.localeCompare(b.id) : a.name < b.name ? 1 : -1));
  const kept = backups.slice(0, keep);
  if (!kept.some((file) => file.id === uploadedId)) {
    throw new BackupError(
      "Retention stopped: the new backup is not among the newest in Drive; nothing deleted",
    );
  }
  return backups.slice(keep);
}
