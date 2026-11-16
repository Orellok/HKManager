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
  it("MS-5: round-trips the balance (also negative) and the amount", () => {
    for (const confirmation of [
      { balance: 50_000, amount: 60_000 },
      { balance: 0, amount: 1 },
      { balance: -25_050, amount: 9_999_999_999 },
    ]) {
      expect(parseOverpaymentToken(overpaymentToken(confirmation))).toEqual(confirmation);
    }
  });

  it.each([null, undefined, "", "abc", "1", "1:", ":1", "1:-1", "1.5:2", "1:2:3", 12])(
    "MS-5: a malformed token %j is no confirmation",
    (value) => {
      expect(parseOverpaymentToken(value)).toBeNull();
    },
  );

  it("MS-5: a confirmation counts only for the amount it was given for", () => {
    const token = { balance: 50_000, amount: 60_000 };
    expect(confirmedBalanceFor(token, 60_000)).toBe(50_000);
    expect(confirmedBalanceFor(token, 70_000)).toBeNull();
    expect(confirmedBalanceFor(null, 60_000)).toBeNull();
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
