"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";

import { Button, buttonClasses } from "@/components/button";
import { MissingDocumentBadge } from "@/components/missing-document-badge";
import { useGuardedTransition } from "@/components/use-guarded-transition";
import { useHydrated } from "@/components/use-hydrated";
import { callServerAction } from "@/lib/auth/action-failure";
import { formatIsoDate } from "@/lib/dates";
import { searchExpensesAction } from "@/lib/expenses/actions";
import {
  expenseSearchInput,
  expenseTotalLabel,
  isNarrowedFilter,
  type ExpenseBrowserFilter,
} from "@/lib/expenses/list-filter";
import { NEW_EXPENSE_PATH, editExpensePath } from "@/lib/expenses/paths";
import type { ExpenseListItem, ExpenseListPage, ExpensesSummary } from "@/lib/expenses/queries";
import { VENDOR_MAX_LENGTH } from "@/lib/expenses/schema";
import { MAX_MONTH, MIN_MONTH, isMonth } from "@/lib/incomes/month";
import { PAYMENT_METHOD_LABELS } from "@/lib/incomes/payment-methods";
import { formatAgorot } from "@/lib/money";
import { appendPage, type PagedListState } from "@/lib/paged-list";

type Filter = ExpenseBrowserFilter;

type BrowserState = PagedListState<ExpenseListItem, Filter> & { summary: ExpensesSummary };

type CategoryFilterOption = { id: string; name: string; label: string };

type ExpensesBrowserProps = {
  /** "YYYY-MM": the month the first page was loaded with (the current month). */
  initialMonth: string;
  /** Every category in order, archived ones marked: their expenses stay reachable. */
  categoryOptions: readonly CategoryFilterOption[];
  initialPage: ExpenseListPage;
  initialSummary: ExpensesSummary;
};

const FILTER_FAILED = "טעינת ההוצאות נכשלה. אפשר לנסות שוב.";
const LOAD_MORE_FAILED = "טעינת הוצאות נוספות נכשלה. אפשר לנסות שוב.";
const MONTH_INVALID = "יש לבחור חודש תקין.";
const INPUT_CLASSES =
  "border-input bg-background aria-invalid:border-destructive min-h-11 w-full rounded-md border px-3 text-base aria-invalid:border-2";

function countText(count: number): string {
  return count === 1 ? "הוצאה אחת" : `${count} הוצאות`;
}

/**
 * EXP-4 / EXP-6: the month, category, vendor and "חסר מסמך" filters, the filter's total and
 * the paged expenses list. Filters go through a Server Action (POST), so the vendor searched
 * never appears in a URL. Month, category and "חסר מסמך" apply on change; the vendor applies
 * on "חיפוש" (or Enter). A filter change made while another load runs waits and replaces any
 * other waiting one, so the list always ends on the latest choice.
 */
export function ExpensesBrowser({
  initialMonth,
  categoryOptions,
  initialPage,
  initialSummary,
}: ExpensesBrowserProps) {
  const initialFilter: Filter = {
    month: initialMonth,
    categoryId: "",
    vendor: "",
    missingDocument: "",
  };
  const [state, setState] = useState<BrowserState>({
    filter: initialFilter,
    items: initialPage.items,
    hasMore: initialPage.hasMore,
    searched: false,
    summary: initialSummary,
  });
  // The filters shown: always the user's latest choice.
  const [month, setMonth] = useState(initialMonth);
  const [categoryId, setCategoryId] = useState("");
  const [vendor, setVendor] = useState("");
  const [missingDocument, setMissingDocument] = useState(false);
  const queuedFilter = useRef<Filter | null>(null);
  /** The filter of the list on screen, for undoing the shown filters when a load fails. */
  const shownFilter = useRef<Filter>(initialFilter);
  const [error, setError] = useState<string | null>(null);
  const [filterPending, startFilter] = useGuardedTransition();
  const [morePending, startLoadMore] = useGuardedTransition();
  const listRef = useRef<HTMLUListElement>(null);
  const focusItemAfterLoad = useRef<number | null>(null);
  const busy = filterPending || morePending;
  // The filters only work through JavaScript, and a choice made before hydration would be
  // reset by it; they are disabled until the page is interactive.
  const hydrated = useHydrated();

  // The "load more" button disappears with the last page; keyboard focus moves to the first
  // newly loaded expense instead of falling back to <body>.
  useEffect(() => {
    const index = focusItemAfterLoad.current;
    if (index === null) {
      return;
    }
    focusItemAfterLoad.current = null;
    listRef.current?.querySelectorAll<HTMLAnchorElement>("a")[index]?.focus();
  }, [state.items]);

  function currentFilter(changes: Partial<Filter> = {}): Filter {
    return {
      month,
      categoryId,
      vendor: vendor.trim(),
      missingDocument: missingDocument ? "1" : "",
      ...changes,
    };
  }

  function applyFilter(filter: Filter) {
    if (!isMonth(filter.month)) {
      // A cleared or partly typed month loads nothing until it is complete again.
      return;
    }
    queuedFilter.current = filter;
    startFilter(async () => {
      let next = queuedFilter.current;
      while (next) {
        queuedFilter.current = null;
        const current = next;
        setError(null);
        const call = await callServerAction(() =>
          searchExpensesAction(expenseSearchInput(current, 0)),
        );
        if (call.status === "redirected") {
          return;
        }
        next = queuedFilter.current;
        if (next) {
          continue;
        }
        if (call.status === "failed" || !call.value.ok || !call.value.summary) {
          const shown = shownFilter.current;
          setMonth(shown.month);
          setCategoryId(shown.categoryId);
          setVendor(shown.vendor);
          setMissingDocument(shown.missingDocument === "1");
          setError(FILTER_FAILED);
          return;
        }
        const { page, summary } = call.value;
        shownFilter.current = current;
        setState({
          filter: current,
          items: page.items,
          hasMore: page.hasMore,
          searched: true,
          summary,
        });
      }
    });
  }

  function changeMonth(event: ChangeEvent<HTMLInputElement>) {
    const next = event.currentTarget.value;
    setMonth(next);
    applyFilter(currentFilter({ month: next }));
  }

  function changeCategory(event: ChangeEvent<HTMLSelectElement>) {
    const next = event.currentTarget.value;
    setCategoryId(next);
    applyFilter(currentFilter({ categoryId: next }));
  }

  function changeMissingDocument(event: ChangeEvent<HTMLInputElement>) {
    const next = event.currentTarget.checked;
    setMissingDocument(next);
    applyFilter(currentFilter({ missingDocument: next ? "1" : "" }));
  }

  /** "חיפוש" or Enter in any filter: applies the filters as shown, vendor included. */
  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    applyFilter(currentFilter());
  }

  function loadMore() {
    if (busy) {
      return;
    }
    const request = { filter: state.filter, offset: state.items.length };
    startLoadMore(async () => {
      setError(null);
      const call = await callServerAction(() =>
        searchExpensesAction(expenseSearchInput(request.filter, request.offset)),
      );
      if (call.status === "redirected") {
        return;
      }
      if (call.status === "failed" || !call.value.ok) {
        setError(LOAD_MORE_FAILED);
        return;
      }
      const { page } = call.value;
      if (!page.hasMore && page.items.length > 0) {
        focusItemAfterLoad.current = request.offset;
      }
      setState((previous) => ({
        ...appendPage(previous, request, page),
        summary: previous.summary,
      }));
    });
  }

  const shownCategory = categoryOptions.find((option) => option.id === state.filter.categoryId);
  const totalLabel = expenseTotalLabel(state.filter, shownCategory?.name);
  const isFiltered = isNarrowedFilter(state.filter);

  return (
    <div className="space-y-4">
      <form
        role="search"
        aria-label="סינון הוצאות"
        onSubmit={search}
        className="grid gap-3 sm:grid-cols-2"
      >
        <div className="space-y-1.5">
          <label htmlFor="expenses-month" className="block text-sm font-medium">
            חודש
          </label>
          <input
            id="expenses-month"
            disabled={!hydrated}
            name="month"
            type="month"
            min={MIN_MONTH}
            max={MAX_MONTH}
            value={month}
            onChange={changeMonth}
            aria-invalid={isMonth(month) ? undefined : true}
            aria-describedby={isMonth(month) ? undefined : "expenses-month-error"}
            className={INPUT_CLASSES}
          />
          {isMonth(month) ? null : (
            <p id="expenses-month-error" className="text-destructive text-sm">
              {MONTH_INVALID}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <label htmlFor="expenses-category" className="block text-sm font-medium">
            קטגוריה
          </label>
          <select
            id="expenses-category"
            disabled={!hydrated}
            name="category"
            value={categoryId}
            onChange={changeCategory}
            className={INPUT_CLASSES}
          >
            <option value="">כל הקטגוריות</option>
            {categoryOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="expenses-vendor" className="block text-sm font-medium">
            ספק
          </label>
          <div className="flex gap-2">
            <input
              id="expenses-vendor"
              disabled={!hydrated}
              name="vendor"
              type="search"
              autoComplete="off"
              maxLength={VENDOR_MAX_LENGTH}
              value={vendor}
              onChange={(event) => setVendor(event.currentTarget.value)}
              aria-describedby="expenses-vendor-hint"
              className={INPUT_CLASSES}
            />
            {/* Never `pending`: Enter in a filter submits through this button, and a search made
                while a load runs is queued, not dropped. */}
            <Button type="submit" variant="secondary" disabled={!hydrated}>
              חיפוש
            </Button>
          </div>
          <p id="expenses-vendor-hint" className="text-muted-foreground text-sm">
            חלק משם הספק, ואז &quot;חיפוש&quot;.
          </p>
        </div>
        <div className="flex items-center sm:pt-7">
          <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              name="missing_document"
              disabled={!hydrated}
              checked={missingDocument}
              onChange={changeMissingDocument}
              className="size-5"
            />
            רק הוצאות שחסר להן מסמך
          </label>
        </div>
      </form>

      <dl className="rounded-lg border p-4" aria-busy={filterPending}>
        <dt className="text-muted-foreground text-sm wrap-anywhere">{totalLabel}</dt>
        <dd className="text-xl font-semibold">
          {formatAgorot(state.summary.total)}{" "}
          <span className="text-muted-foreground text-sm font-normal">
            ({countText(state.summary.count)})
          </span>
        </dd>
      </dl>

      <p role="status" className="sr-only">
        {state.searched
          ? `${totalLabel}: ${formatAgorot(state.summary.total)}, ${countText(state.summary.count)}.`
          : ""}
      </p>
      <p role="alert" className="text-destructive text-sm font-medium">
        {error}
      </p>

      {state.items.length === 0 ? (
        <EmptyList isFiltered={isFiltered} />
      ) : (
        <ul
          ref={listRef}
          aria-label="רשימת ההוצאות"
          aria-busy={filterPending}
          className="divide-y rounded-lg border"
        >
          {state.items.map((expense) => (
            <li key={expense.id}>
              <ExpenseListRow expense={expense} />
            </li>
          ))}
        </ul>
      )}

      {state.hasMore ? (
        <Button variant="secondary" onClick={loadMore} pending={busy}>
          {morePending ? "טוען…" : "הצגת הוצאות נוספות"}
        </Button>
      ) : null}
    </div>
  );
}

/** One expense: vendor and category, date, payment method, amount, and EXP-6's mark. */
function ExpenseListRow({ expense }: { expense: ExpenseListItem }) {
  return (
    <Link
      href={editExpensePath(expense.id)}
      className="hover:bg-accent flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2"
    >
      <span className="min-w-0 space-y-0.5">
        <span className="block font-medium wrap-anywhere">{expense.vendor}</span>
        <span className="text-muted-foreground block text-sm wrap-anywhere">
          {expense.category_name}
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span>{formatIsoDate(expense.expense_date)}</span>
        <span className="text-muted-foreground">
          {PAYMENT_METHOD_LABELS[expense.payment_method]}
        </span>
        <span className="text-base font-semibold">{formatAgorot(expense.amount)}</span>
        {expense.has_file ? null : <MissingDocumentBadge />}
      </span>
    </Link>
  );
}

function EmptyList({ isFiltered }: { isFiltered: boolean }) {
  return (
    <div className="space-y-3 rounded-lg border p-6 text-center">
      <p className="font-medium">
        {isFiltered ? "אין הוצאות שמתאימות לסינון." : "אין הוצאות בחודש הזה."}
      </p>
      <p className="text-muted-foreground text-sm">
        {isFiltered
          ? "אפשר לשנות את הסינון או לבחור חודש אחר."
          : "כאן יופיעו ההוצאות של החודש, מהחדשה לישנה, עם הסכום הכולל."}
      </p>
      <Link href={NEW_EXPENSE_PATH} className={buttonClasses("secondary")}>
        הוספת הוצאה
      </Link>
    </div>
  );
}
