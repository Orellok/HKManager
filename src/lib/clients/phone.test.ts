import { describe, expect, it } from "vitest";

import { phoneDigits, phoneSearchDigits } from "./phone";

describe("phone normalization", () => {
  it.each([
    ["050-123-4567", "0501234567"],
    ["+972 50 123 4567", "972501234567"],
    ["0501234567", "0501234567"],
    ["", ""],
  ])("CLI-3: the digits of %j are %j", (phone, digits) => {
    expect(phoneDigits(phone)).toBe(digits);
  });

  it("CLI-3: 0501234567 and 050-123-4567 normalize to the same digits", () => {
    expect(phoneSearchDigits("0501234567")).toBe(phoneDigits("050-123-4567"));
  });

  it.each([
    ["050-123-4567", "0501234567"],
    [" 050 123 ", "050123"],
    ["(03) 123-4567", "031234567"],
    ["+972", "972"],
    ["4567", "4567"],
  ])("CLI-3: the phone query %j searches the digits %j", (query, digits) => {
    expect(phoneSearchDigits(query)).toBe(digits);
  });

  it.each(["דנה", "דנה 050", "a1", "", "   ", "---", "050.123"])(
    "CLI-3: the query %j is not phone-like and matches names only",
    (query) => {
      expect(phoneSearchDigits(query)).toBeNull();
    },
  );
});
