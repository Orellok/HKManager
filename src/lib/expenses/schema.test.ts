import { describe, expect, it } from "vitest";

import { AMOUNT_MESSAGES, DATE_MESSAGES } from "@/lib/field-rules";

import {
  EMPTY_EXPENSE_FORM_VALUES,
  EXPENSE_FIELD_MESSAGES,
  EXPENSE_FILE_PATH_FIELD,
  readExpenseFormValues,
  validateExpenseInput,
  type ExpenseFormValues,
} from "./schema";

const CATEGORY = "3f2b8c1e-0a4d-4e8f-9b6a-1c2d3e4f5a6b";
const TODAY = "2026-11-23";

function values(fields: Partial<ExpenseFormValues> = {}): ExpenseFormValues {
  return {
    ...EMPTY_EXPENSE_FORM_VALUES,
    expense_date: TODAY,
    amount: "1,250.90",
    vendor: 'דפוס "הכרמל", בע״מ',
    category_id: CATEGORY,
    payment_method: "credit_card",
    ...fields,
  };
}

describe("validateExpenseInput", () => {
  it("EXP-1: a complete expense is valid; the amount becomes integer agorot", () => {
    expect(validateExpenseInput(values({ notes: "  לפרויקט  " }), TODAY)).toEqual({
      success: true,
      data: {
        expense_date: TODAY,
        amount: 125_090,
        vendor: 'דפוס "הכרמל", בע״מ',
        category_id: CATEGORY,
        payment_method: "credit_card",
        notes: "לפרויקט",
      },
    });
  });

  it("EXP-1 / EXP-5: the form has no project field; empty notes are stored as null", () => {
    const result = validateExpenseInput(values(), TODAY);
    expect(result).toMatchObject({ success: true, data: { notes: null } });
    expect(result.success && "project_id" in result.data).toBe(false);
  });

  it("EXP-1: date, amount, vendor, category and payment method are required", () => {
    expect(
      validateExpenseInput(
        values({ expense_date: "", amount: "", vendor: " ", category_id: "", payment_method: "" }),
        TODAY,
      ),
    ).toEqual({
      success: false,
      fieldErrors: {
        expense_date: EXPENSE_FIELD_MESSAGES.dateRequired,
        amount: EXPENSE_FIELD_MESSAGES.amountRequired,
        vendor: EXPENSE_FIELD_MESSAGES.vendorRequired,
        category_id: EXPENSE_FIELD_MESSAGES.categoryRequired,
        payment_method: EXPENSE_FIELD_MESSAGES.paymentMethodRequired,
      },
    });
  });

  it("EXP-1 / owner decision: the amount is more than 0; SPEC 10 edge cases are refused", () => {
    expect(validateExpenseInput(values({ amount: "0" }), TODAY)).toMatchObject({
      fieldErrors: { amount: EXPENSE_FIELD_MESSAGES.amountNotPositive },
    });
    expect(validateExpenseInput(values({ amount: "0.00" }), TODAY)).toMatchObject({
      fieldErrors: { amount: EXPENSE_FIELD_MESSAGES.amountNotPositive },
    });
    expect(validateExpenseInput(values({ amount: "-5" }), TODAY)).toMatchObject({
      fieldErrors: { amount: AMOUNT_MESSAGES.negative },
    });
    expect(validateExpenseInput(values({ amount: "1.234" }), TODAY)).toMatchObject({
      fieldErrors: { amount: AMOUNT_MESSAGES.too_many_decimals },
    });
    expect(validateExpenseInput(values({ amount: "100000000" }), TODAY)).toMatchObject({
      fieldErrors: { amount: AMOUNT_MESSAGES.too_large },
    });
    expect(validateExpenseInput(values({ amount: "0.01" }), TODAY)).toMatchObject({
      success: true,
      data: { amount: 1 },
    });
    expect(validateExpenseInput(values({ amount: "99,999,999.99" }), TODAY)).toMatchObject({
      success: true,
      data: { amount: 9_999_999_999 },
    });
  });

  it("EXP-1 / owner decision: the date cannot be in the future; today is accepted", () => {
    expect(validateExpenseInput(values({ expense_date: "2026-11-24" }), TODAY)).toMatchObject({
      fieldErrors: { expense_date: EXPENSE_FIELD_MESSAGES.dateInFuture },
    });
    expect(validateExpenseInput(values({ expense_date: TODAY }), TODAY).success).toBe(true);
  });

  it("SPEC 10: a year change (31/12 → 1/1) is judged by the given today", () => {
    expect(validateExpenseInput(values({ expense_date: "2026-12-31" }), "2027-01-01").success).toBe(
      true,
    );
    expect(
      validateExpenseInput(values({ expense_date: "2027-01-01" }), "2026-12-31"),
    ).toMatchObject({ fieldErrors: { expense_date: EXPENSE_FIELD_MESSAGES.dateInFuture } });
  });

  it("EXP-1: an impossible or out-of-range date gets the shared date messages", () => {
    expect(validateExpenseInput(values({ expense_date: "2026-02-30" }), TODAY)).toMatchObject({
      fieldErrors: { expense_date: DATE_MESSAGES.invalid },
    });
    expect(validateExpenseInput(values({ expense_date: "1899-12-31" }), TODAY)).toMatchObject({
      fieldErrors: { expense_date: DATE_MESSAGES.outOfRange },
    });
  });

  it("EXP-1: the vendor is trimmed and at most 120 characters", () => {
    expect(validateExpenseInput(values({ vendor: "  אופיס דיפו  " }), TODAY)).toMatchObject({
      data: { vendor: "אופיס דיפו" },
    });
    expect(validateExpenseInput(values({ vendor: "א".repeat(120) }), TODAY).success).toBe(true);
    expect(validateExpenseInput(values({ vendor: "א".repeat(121) }), TODAY)).toMatchObject({
      fieldErrors: { vendor: EXPENSE_FIELD_MESSAGES.vendorTooLong },
    });
  });

  it("EXP-1: the category must be an id, and the payment method one of the incomes' list", () => {
    expect(validateExpenseInput(values({ category_id: "הדפסות" }), TODAY)).toMatchObject({
      fieldErrors: { category_id: EXPENSE_FIELD_MESSAGES.categoryRequired },
    });
    expect(validateExpenseInput(values({ payment_method: "paypal" }), TODAY)).toMatchObject({
      fieldErrors: { payment_method: EXPENSE_FIELD_MESSAGES.paymentMethodRequired },
    });
    for (const method of ["bank_transfer", "bit_paybox", "cash", "check", "credit_card", "other"]) {
      expect(validateExpenseInput(values({ payment_method: method }), TODAY).success).toBe(true);
    }
  });

  it("EXP-1: notes are counted with \\n line breaks and limited to 2000 characters", () => {
    expect(validateExpenseInput(values({ notes: "א\r\nב" }), TODAY)).toMatchObject({
      data: { notes: "א\nב" },
    });
    expect(validateExpenseInput(values({ notes: "א".repeat(2001) }), TODAY)).toMatchObject({
      fieldErrors: { notes: EXPENSE_FIELD_MESSAGES.notesTooLong },
    });
  });
});

describe("readExpenseFormValues", () => {
  it("EXP-2: the file never travels in the form data; the uploaded path is a separate field", () => {
    const formData = new FormData();
    formData.set("vendor", "ספק");
    formData.set("file", new Blob(["x"]), "receipt.jpg");
    formData.set(EXPENSE_FILE_PATH_FIELD, "x.jpg");
    expect(readExpenseFormValues(formData)).toEqual({
      ...EMPTY_EXPENSE_FORM_VALUES,
      vendor: "ספק",
    });
  });
});
