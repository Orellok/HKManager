"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ChangeEvent } from "react";

import { Button, buttonClasses } from "@/components/button";
import { useGuardedTransition } from "@/components/use-guarded-transition";
import { callServerAction } from "@/lib/auth/action-failure";
import { formatIsoDate } from "@/lib/dates";
import { searchIncomesAction } from "@/lib/incomes/actions";
import { MAX_MONTH, MIN_MONTH, formatMonth, isMonth } from "@/lib/incomes/month";
import { NEW_INCOME_PATH, editIncomePath } from "@/lib/incomes/paths";
import { PAYMENT_METHOD_LABELS } from "@/lib/incomes/payment-methods";
import type { IncomeListItem, IncomeListPage, IncomesMonthSummary } from "@/lib/incomes/queries";
import { formatAgorot } from "@/lib/money";
import { appendPage, type PagedListState } from "@/lib/paged-list";
import { CLIENT_OPTIONS_LIMIT, type ClientOption } from "@/lib/projects/queries";

type Filter = { month: string; clientId: string };

type BrowserState = PagedListState<IncomeListItem, Filter> & { summary: IncomesMonthSummary };

type IncomesBrowserProps = {
  /** "YYYY-MM": the month the first page was loaded with (the current month). */
  initialMonth: string;
  clientOptions: readonly ClientOption[];
  moreClientsExist: boolean;
  initialPage: IncomeListPage;
  initialSummary: IncomesMonthSummary;
};

const FILTER_FAILED = "טעינת ההכנסות נכשלה. אפשר לנסות שוב.";
const LOAD_MORE_FAILED = "טעינת הכנסות נוספות נכשלה. אפשר לנסות שוב.";
const MONTH_INVALID = "יש לבחור חודש תקין.";

function countText(count: number): string {
  return count === 1 ? "הכנסה אחת" : `${count} הכנסות`;
}

/**
 * INC-1: the month and client filters, the month's total and the paged incomes list. Filters
 * go through a Server Action (POST). A filter change made while another load runs waits and
 * replaces any other waiting one, so the list always ends on the latest choice.
 */
export function IncomesBrowser({
  initialMonth,
  clientOptions,
  moreClientsExist,
  initialPage,
  initialSummary,
}: IncomesBrowserProps) {
  const initialFilter: Filter = { month: initialMonth, clientId: "" };
  const [state, setState] = useState<BrowserState>({
    filter: initialFilter,
    items: initialPage.items,
    hasMore: initialPage.hasMore,
    searched: false,
    summary: initialSummary,
  });
  // The filters shown: always the user's latest choice.
  const [month, setMonth] = useState(initialMonth);
  const [clientId, setClientId] = useState("");
  const queuedFilter = useRef<Filter | null>(null);
  /** The filter of the list on screen, for undoing the shown filters when a load fails. */
  const shownFilter = useRef<Filter>(initialFilter);
  const [error, setError] = useState<string | null>(null);
  const [filterPending, startFilter] = useGuardedTransition();
  const [morePending, startLoadMore] = useGuardedTransition();
  const listRef = useRef<HTMLUListElement>(null);
  const focusItemAfterLoad = useRef<number | null>(null);
  const busy = filterPending || morePending;

  // The "load more" button disappears with the last page; keyboard focus moves to the first
  // newly loaded income instead of falling back to <body>.
  useEffect(() => {
    const index = focusItemAfterLoad.current;
    if (index === null) {
      return;
    }
    focusItemAfterLoad.current = null;
    listRef.current?.querySelectorAll<HTMLAnchorElement>("a")[index]?.focus();
  }, [state.items]);

  function applyFilter(filter: Filter) {
    queuedFilter.current = filter;
    startFilter(async () => {
      let next = queuedFilter.current;
      while (next) {
        queuedFilter.current = null;
        const current = next;
        setError(null);
        const call = await callServerAction(() => searchIncomesAction({ ...current, offset: 0 }));
        if (call.status === "redirected") {
          return;
        }
        next = queuedFilter.current;
        if (next) {
          continue;
        }
        if (call.status === "failed" || !call.value.ok || !call.value.summary) {
          setMonth(shownFilter.current.month);
          setClientId(shownFilter.current.clientId);
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
    if (!isMonth(next)) {
      // A cleared or partly typed month loads nothing until it is complete again.
      return;
    }
    applyFilter({ month: next, clientId });
  }

  function changeClient(event: ChangeEvent<HTMLSelectElement>) {
    const next = event.currentTarget.value;
    setClientId(next);
    if (isMonth(month)) {
      applyFilter({ month, clientId: next });
    }
  }

  function loadMore() {
    if (busy) {
      return;
    }
    const request = { filter: state.filter, offset: state.items.length };
    startLoadMore(async () => {
      setError(null);
      const call = await callServerAction(() =>
        searchIncomesAction({ ...request.filter, offset: request.offset }),
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

  const shownClient = clientOptions.find((client) => client.id === state.filter.clientId);
  const totalLabel = shownClient
    ? `סה״כ הכנסות ב-${formatMonth(state.filter.month)}, לקוח: ${shownClient.name}`
    : `סה״כ הכנסות ב-${formatMonth(state.filter.month)}`;

  return (
    <div className="space-y-4">
      <form
        role="search"
        aria-label="סינון הכנסות"
        onSubmit={(event) => event.preventDefault()}
        className="grid gap-3 sm:grid-cols-2"
      >
        <div className="space-y-1.5">
          <label htmlFor="incomes-month" className="block text-sm font-medium">
            חודש
          </label>
          <input
            id="incomes-month"
            name="month"
            type="month"
            min={MIN_MONTH}
            max={MAX_MONTH}
            value={month}
            onChange={changeMonth}
            aria-invalid={isMonth(month) ? undefined : true}
            aria-describedby={isMonth(month) ? undefined : "incomes-month-error"}
            className="border-input bg-background aria-invalid:border-destructive min-h-11 w-full rounded-md border px-3 text-base aria-invalid:border-2"
          />
          {isMonth(month) ? null : (
            <p id="incomes-month-error" className="text-destructive text-sm">
              {MONTH_INVALID}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <label htmlFor="incomes-client" className="block text-sm font-medium">
            לקוח
          </label>
          <select
            id="incomes-client"
            name="client"
            value={clientId}
            onChange={changeClient}
            aria-describedby={moreClientsExist ? "incomes-client-hint" : undefined}
            className="border-input bg-background min-h-11 w-full rounded-md border px-3 text-base"
          >
            <option value="">כל הלקוחות</option>
            {clientOptions.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
          {moreClientsExist ? (
            <p id="incomes-client-hint" className="text-muted-foreground text-sm">
              מוצגים {CLIENT_OPTIONS_LIMIT} הלקוחות הפעילים הראשונים לפי שם.
            </p>
          ) : null}
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
        <EmptyList isFiltered={state.searched} />
      ) : (
        <ul
          ref={listRef}
          aria-label="רשימת ההכנסות"
          aria-busy={filterPending}
          className="divide-y rounded-lg border"
        >
          {state.items.map((income) => (
            <li key={income.id}>
              <Link
                href={editIncomePath(income.id)}
                className="hover:bg-accent flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2"
              >
                <span className="min-w-0 space-y-0.5">
                  <span className="block font-medium wrap-anywhere">{income.client_name}</span>
                  {income.project_name !== null ? (
                    <span className="text-muted-foreground block text-sm wrap-anywhere">
                      {income.project_name}
                      {income.milestone_description !== null
                        ? ` – ${income.milestone_description}`
                        : null}
                    </span>
                  ) : (
                    <span className="text-muted-foreground block text-sm">ללא פרויקט</span>
                  )}
                </span>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span>{formatIsoDate(income.received_date)}</span>
                  <span className="text-muted-foreground">
                    {PAYMENT_METHOD_LABELS[income.payment_method]}
                  </span>
                  <span className="text-base font-semibold">{formatAgorot(income.amount)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {state.hasMore ? (
        <Button variant="secondary" onClick={loadMore} pending={busy}>
          {morePending ? "טוען…" : "הצגת הכנסות נוספות"}
        </Button>
      ) : null}
    </div>
  );
}

function EmptyList({ isFiltered }: { isFiltered: boolean }) {
  return (
    <div className="space-y-3 rounded-lg border p-6 text-center">
      <p className="font-medium">אין הכנסות בחודש הזה.</p>
      <p className="text-muted-foreground text-sm">
        {isFiltered
          ? "אפשר לבחור חודש אחר או לקוח אחר."
          : "כאן יופיעו התשלומים שהתקבלו בחודש, מהחדש לישן. תשלום על אבן דרך נרשם מכרטיס הפרויקט."}
      </p>
      <Link href={NEW_INCOME_PATH} className={buttonClasses("secondary")}>
        הוספת הכנסה
      </Link>
    </div>
  );
}
