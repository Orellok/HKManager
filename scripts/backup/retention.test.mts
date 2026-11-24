import { describe, expect, it } from "vitest";

import { backupFileName, KEEP_BACKUPS, selectBackupsToDelete } from "./retention.mts";

const week = (n: number) => new Date(Date.UTC(2026, 0, 3 + 7 * n, 2, 41, 7));
const file = (environment: string, n: number) => ({
  id: `${environment}-${n}`,
  name: backupFileName(environment as "production", week(n)),
});

describe("M7.3-4: retention", () => {
  it("M7.3-2: names carry the environment and the UTC time and sort by time", () => {
    expect(backupFileName("production", new Date("2026-11-28T02:41:07.123Z"))).toBe(
      "hkmanager-production-2026-11-28T024107Z.tar.gz",
    );
  });

  it("M7.3-4: keeps the 12 newest of the environment and deletes the older ones", () => {
    const files = Array.from({ length: 15 }, (_, n) => file("production", n));
    const deleted = selectBackupsToDelete(files, "production", "production-14");
    expect(KEEP_BACKUPS).toBe(12);
    expect(deleted.map((f) => f.id)).toEqual(["production-2", "production-1", "production-0"]);
  });

  it("M7.3-4: 12 or fewer backups → nothing deleted", () => {
    const files = Array.from({ length: 12 }, (_, n) => file("production", n));
    expect(selectBackupsToDelete(files, "production", "production-11")).toEqual([]);
  });

  it("M7.3-4: other environments and foreign names are never candidates", () => {
    const files = [
      ...Array.from({ length: 13 }, (_, n) => file("production", n)),
      ...Array.from({ length: 20 }, (_, n) => file("staging", n)),
      { id: "other", name: "hkmanager-production-old.tar.gz" },
      { id: "notes", name: "notes.txt" },
    ];
    expect(selectBackupsToDelete(files, "production", "production-12").map((f) => f.id)).toEqual([
      "production-0",
    ]);
  });

  it("M7.3-4: if the new backup is missing or not among the newest, nothing is deleted", () => {
    const files = Array.from({ length: 14 }, (_, n) => file("production", n + 1));
    expect(() => selectBackupsToDelete(files, "production", "absent")).toThrow(/nothing deleted/);
    const older = [...files, file("production", 0)];
    expect(() => selectBackupsToDelete(older, "production", "production-0")).toThrow(
      /nothing deleted/,
    );
  });
});
