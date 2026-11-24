import { describe, expect, it } from "vitest";

import { BackupError, describeUnexpected, safeCode } from "./backup-error.mts";

describe("M7.3-6: log-safe errors", () => {
  it("M7.3-6: only plain identifiers are kept as codes", () => {
    expect(safeCode("invalid_grant")).toBe("invalid_grant");
    expect(safeCode("File x@y.com not found")).toBeNull();
    expect(safeCode(42)).toBeNull();
  });

  it("M7.3-6: unexpected errors show their name and system code, never the message", () => {
    const error = Object.assign(new Error("ENOENT: /tmp/storage/receipts/client-name.pdf"), {
      code: "ENOENT",
    });
    expect(describeUnexpected(error)).toBe("unexpected Error (ENOENT); details hidden");
    expect(describeUnexpected(new BackupError("Drive upload failed: HTTP 500"))).toBe(
      "Drive upload failed: HTTP 500",
    );
  });
});
