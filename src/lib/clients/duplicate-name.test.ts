import { describe, expect, it } from "vitest";

import { duplicateNameKey, isSameClientName } from "./duplicate-name";

describe("duplicate-name detection", () => {
  it.each([
    ["דנה לוי", "דנה לוי"],
    ["  דנה לוי ", "דנה לוי"],
    ["Dana Levi", "dana levi"],
    ["DANA levi", " dana LEVI  "],
  ])("CLI-1: %j and %j are the same client name", (first, second) => {
    expect(isSameClientName(first, second)).toBe(true);
  });

  it.each([
    ["דנה לוי", "דנה  לוי"],
    ["דנה לוי", "דנה לוין"],
    ["Dana", "Dana Levi"],
  ])("CLI-1: %j and %j are different client names", (first, second) => {
    expect(isSameClientName(first, second)).toBe(false);
  });

  it("CLI-1: the key is trimmed and lower case, matching lower(name) of a trimmed stored name", () => {
    expect(duplicateNameKey("  Dana LEVI  ")).toBe("dana levi");
  });

  it("CLI-1: a blank name has an empty key", () => {
    expect(duplicateNameKey("   ")).toBe("");
  });
});
