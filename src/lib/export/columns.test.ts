import { describe, expect, it } from "vitest";

import { EXPENSE_COLUMNS, INCOME_COLUMNS, expenseFields, incomeFields } from "./columns";
import type { ExpenseExportRow, IncomeExportRow } from "./queries";

const income: IncomeExportRow = {
  received_date: "2026-01-05",
  client_name: "כהן, משה",
  project_name: 'שיפוץ "דירה"',
  milestone_description: "מקדמה",
  amount: 1_250_050,
  payment_method: "bank_transfer",
  receipt_number: "A-17/2",
  receipt_date: "2026-01-06",
};

const expense: ExpenseExportRow = {
  expense_date: "2026-12-31",
  vendor: "=חומרי בניין",
  category_name: "חומרים",
  amount: 0,
  payment_method: "credit_card",
  has_file: true,
};

describe("EXPORT-3: columns", () => {
  it("EXPORT-3: incomes have the SPEC's eight columns in order", () => {
    expect(INCOME_COLUMNS).toEqual([
      "תאריך",
      "לקוח",
      "פרויקט",
      "אבן דרך",
      "סכום",
      "אמצעי תשלום",
      "מספר קבלה",
      "תאריך קבלה",
    ]);
  });

  it("EXPORT-3: expenses have the SPEC's six columns in order", () => {
    expect(EXPENSE_COLUMNS).toEqual([
      "תאריך",
      "ספק",
      "קטגוריה",
      "סכום",
      "אמצעי תשלום",
      "קיים מסמך",
    ]);
  });

  it("EXPORT-2 / EXPORT-3: an income's fields: DD/MM/YYYY, shekels with two decimals, labels", () => {
    expect(incomeFields(income)).toEqual([
      "05/01/2026",
      "כהן, משה",
      'שיפוץ "דירה"',
      "מקדמה",
      "12500.50",
      "העברה בנקאית",
      "A-17/2",
      "06/01/2026",
    ]);
  });

  it("EXPORT-3: an income without project, milestone or receipt has empty fields", () => {
    expect(
      incomeFields({
        ...income,
        project_name: null,
        milestone_description: null,
        receipt_number: null,
        receipt_date: null,
        amount: 9_999_999_999,
        payment_method: "bit_paybox",
      }),
    ).toEqual(["05/01/2026", "כהן, משה", "", "", "99999999.99", "ביט/פייבוקס", "", ""]);
  });

  it("EXPORT-2 / EXPORT-3: an expense's fields; 0 is 0.00; document כן/לא", () => {
    expect(expenseFields(expense)).toEqual([
      "31/12/2026",
      "=חומרי בניין",
      "חומרים",
      "0.00",
      "אשראי",
      "כן",
    ]);
    expect(expenseFields({ ...expense, has_file: false, amount: 1 })[3]).toBe("0.01");
    expect(expenseFields({ ...expense, has_file: false })[5]).toBe("לא");
  });
});
