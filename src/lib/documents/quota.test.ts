import { describe, expect, it } from "vitest";

import { quotaCounterText, quotaLevel, quotaWarning } from "./quota";

describe("quotaLevel", () => {
  it.each([
    [0, 10, "ok"],
    [7, 10, "ok"],
    [8, 10, "near"],
    [9, 10, "near"],
    [10, 10, "reached"],
    [11, 10, "over"],
    [25, 10, "over"],
  ] as const)("DOC-4: %i of %i is %s", (issued, quota, level) => {
    expect(quotaLevel(issued, quota)).toBe(level);
  });

  it("DOC-4: 80% is computed exactly, without rounding (4 of 5 is near, 3 of 4 is not)", () => {
    expect(quotaLevel(4, 5)).toBe("near");
    expect(quotaLevel(3, 4)).toBe("ok");
    expect(quotaLevel(799, 1000)).toBe("ok");
    expect(quotaLevel(800, 1000)).toBe("near");
  });

  it("DOC-4: a quota of 1 is reached by the first receipt", () => {
    expect(quotaLevel(0, 1)).toBe("ok");
    expect(quotaLevel(1, 1)).toBe("reached");
  });

  it("DOC-4: refuses a negative or fractional count and a quota below 1", () => {
    expect(() => quotaLevel(-1, 10)).toThrow(RangeError);
    expect(() => quotaLevel(1.5, 10)).toThrow(RangeError);
    expect(() => quotaLevel(1, 0)).toThrow(RangeError);
  });
});

describe("quotaWarning", () => {
  it("DOC-4: no warning below 80%", () => {
    expect(quotaWarning(7, 10)).toBeNull();
  });

  it("DOC-4: from 80% the warning names the share used", () => {
    expect(quotaWarning(8, 10)).toBe("נוצלו 80% מהמכסה החודשית של ספק הקבלות.");
    expect(quotaWarning(9, 10)).toBe("נוצלו 90% מהמכסה החודשית של ספק הקבלות.");
  });

  it("DOC-4: at and over the quota the warning says so and that recording continues", () => {
    expect(quotaWarning(10, 10)).toContain("נוצלה במלואה");
    expect(quotaWarning(10, 10)).toContain("אפשר להמשיך לתעד קבלות");
    expect(quotaWarning(12, 10)).toContain("הופקו 2 קבלות מעבר למכסה");
  });

  it("DOC-4: the counter text", () => {
    expect(quotaCounterText(3, 10)).toBe("קבלות שהופקו החודש: 3 מתוך 10");
  });
});
