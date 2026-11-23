import { describe, expect, it } from "vitest";

import { isExpenseObjectPath, newExpenseObjectPath } from "./storage";

describe("expense object paths", () => {
  it("EXP-2 / SPEC 8: a new path is a random name with the type's extension, nothing personal", () => {
    const first = newExpenseObjectPath("image/jpeg");
    const second = newExpenseObjectPath("image/jpeg");

    expect(first).toMatch(/^[0-9a-f-]{36}\.jpg$/);
    expect(first).not.toBe(second);
    expect(newExpenseObjectPath("image/png")).toMatch(/\.png$/);
    expect(newExpenseObjectPath("application/pdf")).toMatch(/\.pdf$/);
    expect(isExpenseObjectPath(first)).toBe(true);
  });

  it("EXP-2: a path of another shape is not an expense file path", () => {
    const id = "0b6f1a52-3c3e-4f3a-9a52-1f1c2d3e4f50";
    expect(isExpenseObjectPath(`${id}.gif`)).toBe(false);
    expect(isExpenseObjectPath(`${id}/${id}.jpg`)).toBe(false);
    expect(isExpenseObjectPath(`../${id}.jpg`)).toBe(false);
    expect(isExpenseObjectPath(`קבלה-דנה.jpg`)).toBe(false);
    expect(isExpenseObjectPath(`${id}.jpg.exe`)).toBe(false);
    expect(isExpenseObjectPath(`${id.toUpperCase()}.jpg`)).toBe(false);
  });
});
