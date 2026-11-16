"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/button";
import { useGuardedTransition } from "@/components/use-guarded-transition";
import { callServerAction } from "@/lib/auth/action-failure";
import { clientPath } from "@/lib/clients/paths";
import { formatIsoDate } from "@/lib/dates";
import { loadOpenDebtsAction } from "@/lib/debts/actions";
import type { OpenDebt, OpenDebtsPage } from "@/lib/debts/queries";
import { formatAgorot } from "@/lib/money";
import { appendPage, type PagedListState } from "@/lib/paged-list";
import { projectPath } from "@/lib/projects/paths";

type Filter = { today: string };

type DebtsBrowserProps = {
  /** The date (Asia/Jerusalem) the first page was loaded with; later pages use it too. */
  today: string;
  initialPage: OpenDebtsPage;
};

const LOAD_MORE_FAILED = "טעינת חובות נוספים נכשלה. אפשר לנסות שוב.";
const LINK_CLASSES = "inline-flex min-h-11 items-center underline underline-offset-4 wrap-anywhere";

function overdueText(days: number): string {
  return days === 1 ? "באיחור של יום אחד" : `באיחור של ${days} ימים`;
}

/** MS-6: the paged open debts list with "load more". */
export function DebtsBrowser({ today, initialPage }: DebtsBrowserProps) {
  const [state, setState] = useState<PagedListState<OpenDebt, Filter>>({
    filter: { today },
    items: initialPage.items,
    hasMore: initialPage.hasMore,
    searched: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startLoadMore] = useGuardedTransition();
  const listRef = useRef<HTMLOListElement>(null);
  /** Index of the first item of a just-loaded last page, to move focus to once rendered. */
  const focusItemAfterLoad = useRef<number | null>(null);

  // The "load more" button disappears with the last page; keyboard focus moves to the first
  // newly loaded debt's first link instead of falling back to <body>.
  useEffect(() => {
    const index = focusItemAfterLoad.current;
    if (index === null) {
      return;
    }
    focusItemAfterLoad.current = null;
    listRef.current?.children[index]?.querySelector<HTMLAnchorElement>("a")?.focus();
  }, [state.items]);

  function loadMore() {
    const request = { filter: state.filter, offset: state.items.length };
    startLoadMore(async () => {
      setError(null);
      const call = await callServerAction(() =>
        loadOpenDebtsAction({ today: request.filter.today, offset: request.offset }),
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
      setState((previous) => appendPage(previous, request, page));
    });
  }

  if (state.items.length === 0) {
    return (
      <div className="space-y-2 rounded-lg border p-6 text-center">
        <p className="font-medium">אין חובות פתוחים.</p>
        <p className="text-muted-foreground text-sm">
          כאן יופיעו אבני דרך שמועד התשלום שלהן עבר ועדיין יש בהן יתרה.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ol ref={listRef} aria-label="רשימת החובות הפתוחים" className="divide-y rounded-lg border">
        {state.items.map((debt) => (
          <li key={debt.id} className="space-y-2 p-4">
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
              <p className="min-w-0 font-medium wrap-anywhere">{debt.description}</p>
              <p className="shrink-0 font-semibold">
                <span className="text-muted-foreground text-sm font-normal">יתרה: </span>
                {formatAgorot(debt.balance)}
              </p>
            </div>
            <div className="flex flex-wrap gap-x-4 text-sm">
              <span>
                <span className="text-muted-foreground">לקוח: </span>
                <Link href={clientPath(debt.client_id)} className={LINK_CLASSES}>
                  {debt.client_name}
                </Link>
              </span>
              <span>
                <span className="text-muted-foreground">פרויקט: </span>
                <Link href={projectPath(debt.project_id)} className={LINK_CLASSES}>
                  {debt.project_name}
                  {debt.project_archived ? " (בארכיון)" : null}
                </Link>
              </span>
            </div>
            <p className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <span>
                תאריך יעד: <span className="text-foreground">{formatIsoDate(debt.due_date)}</span>
              </span>
              <span className="text-foreground font-medium">{overdueText(debt.days_overdue)}</span>
            </p>
          </li>
        ))}
      </ol>

      <p role="alert" className="text-destructive text-sm font-medium">
        {error}
      </p>

      {state.hasMore ? (
        <Button variant="secondary" onClick={loadMore} pending={pending}>
          {pending ? "טוען…" : "הצגת חובות נוספים"}
        </Button>
      ) : null}
    </div>
  );
}
