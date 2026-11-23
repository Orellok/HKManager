import { describe, expect, it } from "vitest";

import {
  EXPENSE_NOTICE_MESSAGES,
  KEEP_ORIGINAL_MESSAGE,
  editExpensePath,
  expenseFilePath,
  isPersistentExpenseNotice,
} from "./paths";

describe("expense notices", () => {
  it("EXP-7: saving with a file says to keep the original receipt, persistently", () => {
    expect(KEEP_ORIGINAL_MESSAGE).toBe("יש לשמור את הקבלה המקורית.");
    expect(EXPENSE_NOTICE_MESSAGES.created_with_file).toContain(KEEP_ORIGINAL_MESSAGE);
    expect(EXPENSE_NOTICE_MESSAGES.updated_with_file).toContain(KEEP_ORIGINAL_MESSAGE);
    expect(isPersistentExpenseNotice("created_with_file")).toBe(true);
    expect(isPersistentExpenseNotice("updated_with_file")).toBe(true);
  });

  it("EXP-7: no wording suggests the photo replaces the original", () => {
    for (const message of Object.values(EXPENSE_NOTICE_MESSAGES)) {
      expect(message).not.toMatch(/מחליף|במקום המקור|אין צורך|אפשר לזרוק|סרוק כמקור/);
    }
  });

  it("EXP-6: saving without a file says the expense is marked חסר מסמך; other notices are one-time", () => {
    expect(EXPENSE_NOTICE_MESSAGES.created).toContain("חסר מסמך");
    for (const code of ["created", "updated", "deleted", "other", undefined]) {
      expect(isPersistentExpenseNotice(code)).toBe(false);
    }
  });
});

describe("expense paths", () => {
  it("SPEC 8: only the id goes into an expense's URLs", () => {
    const id = "0b6f1a52-3c3e-4f3a-9a52-1f1c2d3e4f50";
    expect(editExpensePath(id)).toBe(`/expenses/${id}/edit`);
    expect(expenseFilePath(id)).toBe(`/expenses/${id}/file`);
  });
});
