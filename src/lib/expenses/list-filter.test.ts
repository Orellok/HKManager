import { describe, expect, it } from "vitest";

import {
  expenseSearchInput,
  expenseTotalLabel,
  isNarrowedFilter,
  type ExpenseBrowserFilter,
} from "./list-filter";

const CATEGORY = "3f2b8c1e-0a4d-4e8f-9b6a-1c2d3e4f5a6b";
const MONTH_ONLY: ExpenseBrowserFilter = {
  month: "2026-11",
  categoryId: "",
  vendor: "",
  missingDocument: "",
};

describe("expenseTotalLabel", () => {
  it("EXP-4: the total of a month says which month", () => {
    expect(expenseTotalLabel(MONTH_ONLY)).toBe("סה״כ הוצאות ב-11/2026");
  });

  it("EXP-4 / EXP-6: the total names every filter that narrows it", () => {
    expect(
      expenseTotalLabel(
        { month: "2027-01", categoryId: CATEGORY, vendor: "דפוס", missingDocument: "1" },
        "הדפסות",
      ),
    ).toBe("סה״כ הוצאות ב-01/2027, קטגוריה: הדפסות, ספק: דפוס, חסר מסמך בלבד");
  });

  it("EXP-4: a category id without a known name is left out of the label", () => {
    expect(expenseTotalLabel({ ...MONTH_ONLY, categoryId: CATEGORY })).toBe(
      "סה״כ הוצאות ב-11/2026",
    );
  });
});

describe("isNarrowedFilter", () => {
  it("EXP-4: only category, vendor or חסר מסמך narrow a month's list", () => {
    expect(isNarrowedFilter(MONTH_ONLY)).toBe(false);
    expect(isNarrowedFilter({ ...MONTH_ONLY, month: "2020-01" })).toBe(false);
    expect(isNarrowedFilter({ ...MONTH_ONLY, categoryId: CATEGORY })).toBe(true);
    expect(isNarrowedFilter({ ...MONTH_ONLY, vendor: "א" })).toBe(true);
    expect(isNarrowedFilter({ ...MONTH_ONLY, missingDocument: "1" })).toBe(true);
  });
});

describe("expenseSearchInput", () => {
  it("EXP-4 / EXP-6: the Server Action gets the filter, a boolean for חסר מסמך, and the offset", () => {
    expect(expenseSearchInput({ ...MONTH_ONLY, missingDocument: "1", vendor: "x" }, 50)).toEqual({
      month: "2026-11",
      categoryId: "",
      vendor: "x",
      missingDocument: true,
      offset: 50,
    });
    expect(expenseSearchInput(MONTH_ONLY, 0).missingDocument).toBe(false);
  });
});
