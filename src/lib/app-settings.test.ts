import { describe, expect, it } from "vitest";

import { RECEIPT_SETTINGS_DEFAULTS, parseReceiptSettings } from "./app-settings";

describe("parseReceiptSettings", () => {
  it("DOC-4: reads the seeded values", () => {
    expect(
      parseReceiptSettings([
        { key: "receipt_provider_name", value: "SUMIT" },
        { key: "receipt_provider_url", value: "https://app.sumit.co.il/" },
        { key: "receipt_monthly_quota", value: 10 },
      ]),
    ).toEqual({ providerName: "SUMIT", providerUrl: "https://app.sumit.co.il/", monthlyQuota: 10 });
  });

  it("SET: other valid values are used as they are (the provider is a setting)", () => {
    expect(
      parseReceiptSettings([
        { key: "receipt_provider_name", value: " ספק " },
        { key: "receipt_provider_url", value: "https://provider.example/issue" },
        { key: "receipt_monthly_quota", value: 25 },
      ]),
    ).toEqual({
      providerName: "ספק",
      providerUrl: "https://provider.example/issue",
      monthlyQuota: 25,
    });
  });

  it("DOC-4: missing values fall back to the defaults", () => {
    expect(parseReceiptSettings([])).toEqual(RECEIPT_SETTINGS_DEFAULTS);
  });

  it("DOC-4: invalid values fall back to the defaults, each on its own", () => {
    expect(
      parseReceiptSettings([
        { key: "receipt_provider_name", value: "" },
        { key: "receipt_provider_url", value: "http://insecure.example/" },
        { key: "receipt_monthly_quota", value: 0 },
      ]),
    ).toEqual(RECEIPT_SETTINGS_DEFAULTS);
    expect(
      parseReceiptSettings([
        { key: "receipt_provider_url", value: "javascript:alert(1)" },
        { key: "receipt_monthly_quota", value: 2.5 },
      ]),
    ).toEqual(RECEIPT_SETTINGS_DEFAULTS);
    expect(parseReceiptSettings([{ key: "receipt_monthly_quota", value: "10" }]).monthlyQuota).toBe(
      10,
    );
  });
});
