import { describe, expect, it } from "vitest";

import { RECEIPT_STATUS_LABELS, receiptStatus } from "./status";

describe("receiptStatus", () => {
  it("INC-3: an income with a receipt is receipt_issued", () => {
    expect(receiptStatus(true)).toBe("receipt_issued");
  });

  it("INC-3: an income without a receipt is receipt_pending", () => {
    expect(receiptStatus(false)).toBe("receipt_pending");
  });

  it("INC-3: each status has a Hebrew label", () => {
    expect(RECEIPT_STATUS_LABELS).toEqual({
      receipt_pending: "ממתינה לקבלה",
      receipt_issued: "הופקה קבלה",
    });
  });
});
