"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/button";
import { useGuardedTransition } from "@/components/use-guarded-transition";
import { callServerAction } from "@/lib/auth/action-failure";
import { loadPendingReceiptsAction } from "@/lib/documents/actions";
import { receiptPath } from "@/lib/documents/paths";
import type { IncomeListItem, IncomeListPage } from "@/lib/incomes/queries";
import { appendPage, type PagedListState } from "@/lib/paged-list";

import { IncomeListRow } from "./income-list-row";

const LOAD_MORE_FAILED = "טעינת הכנסות נוספות נכשלה. אפשר לנסות שוב.";

type NoFilter = Record<string, never>;

/**
 * DOC-5: the incomes waiting for a receipt, of every month, the longest waiting first; each
 * opens its receipt page ("הפק קבלה"). More load page by page; keyboard focus moves to the
 * first newly loaded income when the button disappears with the last page.
 */
export function PendingReceiptsBrowser({ initialPage }: { initialPage: IncomeListPage }) {
  const [state, setState] = useState<PagedListState<IncomeListItem, NoFilter>>({
    filter: {},
    items: initialPage.items,
    hasMore: initialPage.hasMore,
    searched: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useGuardedTransition();
  const listRef = useRef<HTMLUListElement>(null);
  const focusItemAfterLoad = useRef<number | null>(null);

  useEffect(() => {
    const index = focusItemAfterLoad.current;
    if (index === null) {
      return;
    }
    focusItemAfterLoad.current = null;
    listRef.current?.querySelectorAll<HTMLAnchorElement>("a")[index]?.focus();
  }, [state.items]);

  function loadMore() {
    const request = { filter: {}, offset: state.items.length };
    start(async () => {
      setError(null);
      const call = await callServerAction(() => loadPendingReceiptsAction(request.offset));
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

  return (
    <div className="space-y-4">
      <p role="alert" className="text-destructive text-sm font-medium">
        {error}
      </p>
      {state.items.length === 0 ? (
        <div className="space-y-2 rounded-lg border p-6 text-center">
          <p className="font-medium">אין הכנסות שממתינות לקבלה.</p>
          <p className="text-muted-foreground text-sm">
            כל הכנסה חדשה תופיע כאן מיום קבלת התשלום ועד שתירשם לה קבלה.
          </p>
        </div>
      ) : (
        <ul
          ref={listRef}
          aria-label="הכנסות שממתינות לקבלה"
          aria-busy={pending}
          className="divide-y rounded-lg border"
        >
          {state.items.map((income) => (
            <li key={income.id}>
              <IncomeListRow income={income} href={receiptPath(income.id)} />
            </li>
          ))}
        </ul>
      )}
      {state.hasMore ? (
        <Button variant="secondary" onClick={loadMore} pending={pending}>
          {pending ? "טוען…" : "הצגת הכנסות נוספות"}
        </Button>
      ) : null}
    </div>
  );
}
