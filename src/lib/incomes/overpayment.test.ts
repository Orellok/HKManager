import { describe, expect, it } from "vitest";

import { formatAgorot } from "@/lib/money";

import {
  confirmedBalanceFor,
  isOverpayment,
  overpaymentMessage,
  overpaymentToken,
  parseOverpaymentToken,
} from "./overpayment";

describe("isOverpayment", () => {
  it.each([
    [100_000, 100_000, false],
    [99_999, 100_000, false],
    [100_001, 100_000, true],
    [1, 0, true],
    [1, -500, true],
  ])("MS-5: paying %i agorot on a balance of %i is an overpayment: %s", (amount, balance, over) => {
    expect(isOverpayment(amount, balance)).toBe(over);
  });
});

describe("overpayment confirmation token", () => {
  const MILESTONE = "5b4d0e3a-2c6f-4a01-9d8c-3e4f5a6b7c8d";
  const OTHER = "6c5e1f4b-3d70-4b12-8e9d-4f5a6b7c8d9e";

  it("MS-5: round-trips the milestone, the balance (also negative) and the amount", () => {
    for (const confirmation of [
      { milestoneId: MILESTONE, balance: 50_000, amount: 60_000 },
      { milestoneId: MILESTONE, balance: 0, amount: 1 },
      { milestoneId: OTHER, balance: -25_050, amount: 9_999_999_999 },
    ]) {
      expect(parseOverpaymentToken(overpaymentToken(confirmation))).toEqual(confirmation);
    }
  });

  it.each([
    null,
    undefined,
    "",
    "abc",
    "1:2",
    `${MILESTONE}:1`,
    `${MILESTONE}:1:-1`,
    `${MILESTONE}:1.5:2`,
    `not-a-uuid:1:2`,
    `${MILESTONE}:1:2:3`,
    12,
  ])("MS-5: a malformed token %j is no confirmation", (value) => {
    expect(parseOverpaymentToken(value)).toBeNull();
  });

  it("MS-5: a confirmation counts only for the milestone and the amount it was given for", () => {
    const token = { milestoneId: MILESTONE, balance: 50_000, amount: 60_000 };
    expect(confirmedBalanceFor(token, MILESTONE, 60_000)).toBe(50_000);
    expect(confirmedBalanceFor(token, MILESTONE.toUpperCase(), 60_000)).toBe(50_000);
    expect(confirmedBalanceFor(token, MILESTONE, 70_000)).toBeNull();
    // Warned on one milestone, confirmed for another with the same balance: asked again.
    expect(confirmedBalanceFor(token, OTHER, 60_000)).toBeNull();
    expect(confirmedBalanceFor(token, null, 60_000)).toBeNull();
    expect(confirmedBalanceFor(null, MILESTONE, 60_000)).toBeNull();
  });
});

describe("overpaymentMessage", () => {
  it("MS-5: names the amount, the balance and the difference", () => {
    expect(overpaymentMessage({ balance: 50_000, amount: 60_000 })).toBe(
      `הסכום (${formatAgorot(60_000)}) גבוה מהיתרה של אבן הדרך (${formatAgorot(50_000)}) ב-${formatAgorot(10_000)}. לרשום בכל זאת?`,
    );
  });

  it("MS-5: a milestone with nothing left says it is already paid in full", () => {
    expect(overpaymentMessage({ balance: 0, amount: 1_000 })).toBe(
      `אבן הדרך כבר שולמה במלואה. רישום התשלום (${formatAgorot(1_000)}) ייצור תשלום ביתר. לרשום בכל זאת?`,
    );
    expect(overpaymentMessage({ balance: -500, amount: 1_000 })).toMatch(/^אבן הדרך כבר שולמה/);
  });
});
