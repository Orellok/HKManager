import { describe, expect, it } from "vitest";

import { parseDashboardData } from "./queries";

function json(overrides: Record<string, unknown> = {}) {
  return {
    period: { income: 123_457, expense: 23_456, previous_income: 100_000, previous_expense: 0 },
    series: Array.from({ length: 12 }, (_, index) => ({
      month: `2026-${String(index + 1).padStart(2, "0")}`,
      income: index,
      expense: "5",
    })),
    categories: [{ id: "c1", name: "הדפסות", total: 23_456, count: 2 }],
    cards: {
      open_debts_count: 1,
      open_debts_total: 5_000,
      pending_receipts: 3,
      receipts_issued_this_month: 4,
      missing_documents: 0,
    },
    ceiling: {
      year: 2026,
      ceiling: 12_283_300,
      turnover: 700,
      basis: "received_date",
      acked: [70],
      is_admin: false,
    },
    ...overrides,
  };
}

describe("DASH-1..5 / CEIL-2..6: the dashboard data", () => {
  it("DASH-2: reads the function's JSON with exact integer amounts", () => {
    const data = parseDashboardData(json());
    expect(data.period).toEqual({
      income: 123_457,
      expense: 23_456,
      previousIncome: 100_000,
      previousExpense: 0,
    });
    expect(data.series[0]).toEqual({ month: "2026-01", income: 0, expense: 5 });
    expect(data.cards.openDebtsTotal).toBe(5_000);
    expect(data.ceiling).toEqual({
      year: 2026,
      ceiling: 12_283_300,
      turnover: 700,
      acked: [70],
      basis: "received_date",
    });
    expect(data.isAdmin).toBe(false);
  });

  it("CEIL-6: a year without a ceiling reads as null", () => {
    const data = parseDashboardData(
      json({
        ceiling: {
          year: 2027,
          ceiling: null,
          turnover: 0,
          basis: "receipt_date",
          acked: [],
          is_admin: true,
        },
      }),
    );
    expect(data.ceiling.ceiling).toBeNull();
    expect(data.ceiling.basis).toBe("receipt_date");
    expect(data.isAdmin).toBe(true);
  });

  it.each([
    [
      "an unsafe total",
      { period: { income: 2 ** 53 + 2, expense: 0, previous_income: 0, previous_expense: 0 } },
    ],
    [
      "a negative total",
      { period: { income: -1, expense: 0, previous_income: 0, previous_expense: 0 } },
    ],
    [
      "a fractional total",
      { period: { income: 1.5, expense: 0, previous_income: 0, previous_expense: 0 } },
    ],
    ["11 months", { series: [] }],
    [
      "an unknown basis",
      { ceiling: { year: 2026, ceiling: 1, turnover: 0, basis: "x", acked: [], is_admin: false } },
    ],
  ])("rejects %s rather than showing it wrong", (_label, overrides) => {
    expect(() => parseDashboardData(json(overrides))).toThrow();
  });
});
