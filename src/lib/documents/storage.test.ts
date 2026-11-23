import { describe, expect, it } from "vitest";

import { isReceiptObjectPathOf, newReceiptObjectPath } from "./storage";

const INCOME = "0b6f1a52-3c3e-4f3a-9a52-1f1c2d3e4f50";
const OTHER = "9d2b7c11-aaaa-4bbb-8ccc-123456789abc";

describe("receipt object paths", () => {
  it("DOC-2 / SPEC 8: a new path is the income id and a random file name, nothing personal", () => {
    const first = newReceiptObjectPath(INCOME);
    const second = newReceiptObjectPath(INCOME);

    expect(first).toMatch(new RegExp(`^${INCOME}/[0-9a-f-]{36}\\.pdf$`));
    expect(first).not.toBe(second);
    expect(isReceiptObjectPathOf(INCOME, first)).toBe(true);
  });

  it("DOC-2: a path of another income or of another shape is not the income's", () => {
    expect(isReceiptObjectPathOf(INCOME, newReceiptObjectPath(OTHER))).toBe(false);
    expect(isReceiptObjectPathOf(INCOME, `${INCOME}/דנה-כהן.pdf`)).toBe(false);
    expect(isReceiptObjectPathOf(INCOME, `${INCOME}/../${OTHER}/x.pdf`)).toBe(false);
    expect(isReceiptObjectPathOf(INCOME, `${INCOME}/${OTHER}.pdf.exe`)).toBe(false);
  });
});
