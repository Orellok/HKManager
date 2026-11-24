import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  new URL("../../.github/workflows/backup.yml", import.meta.url),
  "utf8",
);

describe("M7.3-1/6: backup workflow", () => {
  it("M7.3-1: weekly schedule plus manual runs for production or staging", () => {
    expect(workflow).toMatch(/schedule:\n\s+# .*\n\s+- cron: "41 2 \* \* 6"/);
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toMatch(/options:\n\s+- production\n\s+- staging\n\s+default: production/);
    expect(workflow).toMatch(/permissions:\n\s+contents: read\n/);
    expect(workflow).toContain("timeout-minutes:");
  });

  it("M7.3-6: no artifacts or caches with data; work files outside the checkout, always deleted", () => {
    expect(workflow).not.toMatch(/upload-artifact|actions\/cache/);
    expect(workflow).toContain("BACKUP_WORK_DIR: ${{ runner.temp }}/hkmanager-backup");
    expect(workflow).toMatch(/if: always\(\)\n\s+run: rm -rf "\$BACKUP_WORK_DIR"/);
    expect(workflow).toContain("persist-credentials: false");
  });

  it("M7.3-1: every required secret is checked by name", () => {
    for (const name of [
      "SUPABASE_ACCESS_TOKEN",
      "GOOGLE_DRIVE_BACKUP_CLIENT_ID",
      "GOOGLE_DRIVE_BACKUP_CLIENT_SECRET",
      "GOOGLE_DRIVE_BACKUP_REFRESH_TOKEN",
      "SUPABASE_PROD_DB_PASSWORD",
      "SUPABASE_STAGING_DB_PASSWORD",
    ]) {
      expect(workflow).toContain(`secrets.${name}`);
    }
  });
});
