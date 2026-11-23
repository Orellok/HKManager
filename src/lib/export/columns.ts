import { formatIsoDate } from "@/lib/dates";
import { PAYMENT_METHOD_LABELS } from "@/lib/incomes/payment-methods";
import { agorotToDecimal } from "@/lib/money";

import type { ExpenseExportRow, IncomeExportRow } from "./queries";

/**
 * EXPORT-2 / EXPORT-3: the columns of the export files, in the SPEC's order, and the text of
 * each field: dates as DD/MM/YYYY, amounts in shekels with exactly two decimals and no
 * thousands separator (from agorot, by their digits), payment methods by their Hebrew label.
 */

export const INCOME_COLUMNS = [
  "תאריך",
  "לקוח",
  "פרויקט",
  "אבן דרך",
  "סכום",
  "אמצעי תשלום",
  "מספר קבלה",
  "תאריך קבלה",
] as const;

export const EXPENSE_COLUMNS = [
  "תאריך",
  "ספק",
  "קטגוריה",
  "סכום",
  "אמצעי תשלום",
  "קיים מסמך",
] as const;

export const HAS_DOCUMENT_LABELS = { yes: "כן", no: "לא" } as const;

export function incomeFields(row: IncomeExportRow): string[] {
  return [
    formatIsoDate(row.received_date),
    row.client_name,
    row.project_name ?? "",
    row.milestone_description ?? "",
    agorotToDecimal(row.amount),
    PAYMENT_METHOD_LABELS[row.payment_method],
    row.receipt_number ?? "",
    row.receipt_date === null ? "" : formatIsoDate(row.receipt_date),
  ];
}

export function expenseFields(row: ExpenseExportRow): string[] {
  return [
    formatIsoDate(row.expense_date),
    row.vendor,
    row.category_name,
    agorotToDecimal(row.amount),
    PAYMENT_METHOD_LABELS[row.payment_method],
    row.has_file ? HAS_DOCUMENT_LABELS.yes : HAS_DOCUMENT_LABELS.no,
  ];
}
