import { formatMonth } from "@/lib/incomes/month";

/**
 * EXP-4 / EXP-6: the expenses list filter as the list screen keeps it. Values are strings,
 * as paged lists compare them (src/lib/paged-list.ts); missingDocument is "1" for "only
 * expenses without a file", "" otherwise.
 */
export type ExpenseBrowserFilter = {
  /** "YYYY-MM". */
  month: string;
  /** A category id, or "" for all. */
  categoryId: string;
  /** Part of the vendor's name (trimmed), or "" for all. */
  vendor: string;
  missingDocument: "1" | "";
};

/** The filter and page as searchExpensesAction takes them. */
export function expenseSearchInput(filter: ExpenseBrowserFilter, offset: number) {
  return {
    month: filter.month,
    categoryId: filter.categoryId,
    vendor: filter.vendor,
    missingDocument: filter.missingDocument === "1",
    offset,
  };
}

/** Whether anything beyond the month narrows the list. */
export function isNarrowedFilter(filter: ExpenseBrowserFilter): boolean {
  return filter.categoryId !== "" || filter.vendor !== "" || filter.missingDocument === "1";
}

/**
 * What the total is the total of, e.g. "סה״כ הוצאות ב-11/2026, קטגוריה: הדפסות, ספק: דפוס".
 * `categoryName` is the name of the filter's category, when there is one.
 */
export function expenseTotalLabel(filter: ExpenseBrowserFilter, categoryName?: string): string {
  return [
    `סה״כ הוצאות ב-${formatMonth(filter.month)}`,
    filter.categoryId !== "" && categoryName ? `קטגוריה: ${categoryName}` : null,
    filter.vendor !== "" ? `ספק: ${filter.vendor}` : null,
    filter.missingDocument === "1" ? "חסר מסמך בלבד" : null,
  ]
    .filter(Boolean)
    .join(", ");
}
