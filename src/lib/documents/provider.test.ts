import { describe, expect, it } from "vitest";

import { RECEIPT_SETTINGS_DEFAULTS } from "@/lib/app-settings";

import {
  ManualProvider,
  documentProviderFor,
  type DocumentProvider,
  type ReceiptTransaction,
} from "./provider";

const TRANSACTION: ReceiptTransaction = {
  clientName: "דנה כהן",
  amount: 1_250_050,
  description: "שיפוץ – מקדמה",
  receivedDate: "2026-11-17",
  paymentMethod: "העברה בנקאית",
};

describe("DocumentProvider", () => {
  it("DOC-1 / SPEC 9.1: V1 uses the manual provider, named and linked by the settings", () => {
    const provider: DocumentProvider = documentProviderFor({
      providerName: "ספק אחר",
      providerUrl: "https://provider.example/",
      monthlyQuota: 5,
    });

    expect(provider).toBeInstanceOf(ManualProvider);
    expect(provider.mode).toBe("manual");
    expect(provider.providerName).toBe("ספק אחר");
  });

  it("DOC-1: issuing in manual mode returns the provider link and the details to copy", () => {
    const provider = documentProviderFor(RECEIPT_SETTINGS_DEFAULTS);

    expect(provider.issue(TRANSACTION)).toEqual({
      providerName: "SUMIT",
      providerUrl: "https://app.sumit.co.il/",
      transaction: TRANSACTION,
    });
  });
});
