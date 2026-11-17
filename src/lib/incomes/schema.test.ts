import { describe, expect, it } from "vitest";

import { todayInJerusalem } from "@/lib/dates";

import {
  EMPTY_INCOME_FORM_VALUES,
  INCOME_FIELD_MESSAGES,
  readIncomeFormValues,
  validateIncomeInput,
  type IncomeFormValues,
} from "./schema";

const CLIENT = "3f2b8c1e-0a4d-4e8f-9b6a-1c2d3e4f5a6b";
const PROJECT = "4a3c9d2f-1b5e-4f90-8c7b-2d3e4f5a6b7c";
const MILESTONE = "5b4d0e3a-2c6f-4a01-9d8c-3e4f5a6b7c8d";
const TODAY = "2026-11-16";

function values(fields: Partial<IncomeFormValues> = {}): IncomeFormValues {
  return {
    ...EMPTY_INCOME_FORM_VALUES,
    client_id: CLIENT,
    received_date: TODAY,
    amount: "1,250.50",
    payment_method: "bank_transfer",
    ...fields,
  };
}

describe("validateIncomeInput", () => {
  it("INC-2: an income with only a client (no project) is valid; amount in agorot", () => {
    expect(validateIncomeInput(values(), TODAY)).toEqual({
      success: true,
      data: {
        client_id: CLIENT,
        project_id: null,
        milestone_id: null,
        received_date: TODAY,
        amount: 125_050,
        payment_method: "bank_transfer",
        notes: null,
      },
    });
  });

  it("INC-1 / MS-4: client, project and milestone are kept", () => {
    const result = validateIncomeInput(
      values({ project_id: PROJECT, milestone_id: MILESTONE, notes: " שורה\r\nשנייה " }),
      TODAY,
    );
    expect(result).toMatchObject({
      success: true,
      data: { project_id: PROJECT, milestone_id: MILESTONE, notes: "שורה\nשנייה" },
    });
  });

  it("INC-1: client, date, amount and payment method are required", () => {
    expect(
      validateIncomeInput(
        values({ client_id: "", received_date: "", amount: "", payment_method: "" }),
        TODAY,
      ),
    ).toEqual({
      success: false,
      fieldErrors: {
        client_id: INCOME_FIELD_MESSAGES.clientRequired,
        received_date: INCOME_FIELD_MESSAGES.receivedDateRequired,
        amount: INCOME_FIELD_MESSAGES.amountRequired,
        payment_method: INCOME_FIELD_MESSAGES.paymentMethodRequired,
      },
    });
  });

  it("INC-1: a milestone without its project is refused", () => {
    expect(validateIncomeInput(values({ milestone_id: MILESTONE }), TODAY)).toEqual({
      success: false,
      fieldErrors: { project_id: INCOME_FIELD_MESSAGES.milestoneNeedsProject },
    });
  });

  it.each(["abc", "1", "' or 1=1"])(
    "INC-1: a malformed project or milestone id %j is refused",
    (id) => {
      const result = validateIncomeInput(values({ project_id: id, milestone_id: id }), TODAY);
      expect(result).toEqual({
        success: false,
        fieldErrors: {
          project_id: INCOME_FIELD_MESSAGES.choiceInvalid,
          milestone_id: INCOME_FIELD_MESSAGES.choiceInvalid,
        },
      });
    },
  );

  it.each(["0", "0.00", "0,000"])("owner decision: an amount of %s is refused", (amount) => {
    const result = validateIncomeInput(values({ amount }), TODAY);
    expect(result.success).toBe(false);
    expect(!result.success && result.fieldErrors.amount).toBe(
      INCOME_FIELD_MESSAGES.amountNotPositive,
    );
  });

  it("owner decision: the smallest amount, 0.01, and the largest are accepted", () => {
    expect(validateIncomeInput(values({ amount: "0.01" }), TODAY)).toMatchObject({
      success: true,
      data: { amount: 1 },
    });
    expect(validateIncomeInput(values({ amount: "99,999,999.99" }), TODAY)).toMatchObject({
      success: true,
      data: { amount: 9_999_999_999 },
    });
  });

  it("owner decision: an amount above the maximum or negative is refused", () => {
    expect(validateIncomeInput(values({ amount: "100,000,000" }), TODAY).success).toBe(false);
    expect(validateIncomeInput(values({ amount: "-5" }), TODAY).success).toBe(false);
  });

  it("owner decision: a received date after today is refused; today is accepted", () => {
    expect(validateIncomeInput(values({ received_date: "2026-11-17" }), TODAY)).toEqual({
      success: false,
      fieldErrors: { received_date: INCOME_FIELD_MESSAGES.receivedDateInFuture },
    });
    expect(validateIncomeInput(values({ received_date: TODAY }), TODAY).success).toBe(true);
    expect(validateIncomeInput(values({ received_date: "1900-01-01" }), TODAY).success).toBe(true);
  });

  it.each([
    // Winter time: Asia/Jerusalem is UTC+2, so 17/11 starts at 22:00 UTC on 16/11.
    ["2026-11-16T21:59:59.999Z", false],
    ["2026-11-16T22:00:00.000Z", true],
    // Summer time: UTC+3, so 17/06 starts at 21:00 UTC on 16/06.
    ["2026-06-16T20:59:59.999Z", false],
    ["2026-06-16T21:00:00.000Z", true],
  ] as const)(
    "owner decision: at %s (around Asia/Jerusalem midnight) the next day accepted = %s",
    (instant, accepted) => {
      const nextDay = instant.startsWith("2026-11") ? "2026-11-17" : "2026-06-17";
      const today = todayInJerusalem(new Date(instant));
      expect(validateIncomeInput(values({ received_date: nextDay }), today).success).toBe(accepted);
    },
  );

  it("INC-1: a received date outside 1900–2100 gets the range message", () => {
    const result = validateIncomeInput(values({ received_date: "1899-12-31" }), TODAY);
    expect(result.success).toBe(false);
    expect(!result.success && result.fieldErrors.received_date).toMatch(/01\/01\/1900/);
  });

  it("INC-5: only the listed payment methods are accepted", () => {
    for (const method of ["bank_transfer", "bit_paybox", "cash", "check", "credit_card", "other"]) {
      expect(validateIncomeInput(values({ payment_method: method }), TODAY).success).toBe(true);
    }
    expect(validateIncomeInput(values({ payment_method: "paypal" }), TODAY)).toEqual({
      success: false,
      fieldErrors: { payment_method: INCOME_FIELD_MESSAGES.paymentMethodRequired },
    });
  });

  it("INC-1: notes are limited to 2000 characters", () => {
    expect(validateIncomeInput(values({ notes: "א".repeat(2000) }), TODAY).success).toBe(true);
    expect(validateIncomeInput(values({ notes: "א".repeat(2001) }), TODAY)).toEqual({
      success: false,
      fieldErrors: { notes: INCOME_FIELD_MESSAGES.notesTooLong },
    });
  });
});

describe("readIncomeFormValues", () => {
  it("INC-1: reads every field; a missing or non-text field is empty", () => {
    const formData = new FormData();
    formData.set("client_id", CLIENT);
    formData.set("amount", "10");
    formData.set("notes", new Blob(["x"]));
    expect(readIncomeFormValues(formData)).toEqual({
      ...EMPTY_INCOME_FORM_VALUES,
      client_id: CLIENT,
      amount: "10",
    });
  });
});
