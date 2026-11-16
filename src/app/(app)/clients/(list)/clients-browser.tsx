"use client";

import Link from "next/link";
import { useRef, useState, useTransition, type FormEvent } from "react";

import { Button, buttonClasses } from "@/components/button";
import { searchClientsAction } from "@/lib/clients/actions";
import { NEW_CLIENT_PATH, clientPath } from "@/lib/clients/paths";
import type { ClientListPage, ClientListView } from "@/lib/clients/queries";
import { CLIENT_SEARCH_QUERY_MAX_LENGTH } from "@/lib/clients/schema";

import { appendPage, type BrowserState } from "./browser-state";

type ClientsBrowserProps = {
  view: ClientListView;
  /** The first page of the list without a search, rendered on the server. */
  initialPage: ClientListPage;
};

const SEARCH_FAILED = "החיפוש נכשל. אפשר לנסות שוב.";
const LOAD_MORE_FAILED = "טעינת לקוחות נוספים נכשלה. אפשר לנסות שוב.";

function resultSummary({ query, items, hasMore, searched }: BrowserState): string {
  if (!searched || query === "") {
    return "";
  }
  if (items.length === 0) {
    return "לא נמצאו לקוחות שמתאימים לחיפוש.";
  }
  if (hasMore) {
    return `מוצגים ${items.length} הלקוחות הראשונים שמתאימים לחיפוש.`;
  }
  return items.length === 1 ? "נמצא לקוח אחד." : `נמצאו ${items.length} לקוחות.`;
}

/**
 * CLI-3: search by name or phone, and the paged client list. Searches go through a Server
 * Action (POST) so that names and phones never appear in the URL (SPEC 8).
 */
export function ClientsBrowser({ view, initialPage }: ClientsBrowserProps) {
  const [state, setState] = useState<BrowserState>({
    query: "",
    items: initialPage.items,
    hasMore: initialPage.hasMore,
    searched: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [searchPending, startSearch] = useTransition();
  const [morePending, startLoadMore] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function search(query: string) {
    setError(null);
    startSearch(async () => {
      const result = await searchClientsAction({ view, query, offset: 0 });
      if (!result.ok) {
        setError(SEARCH_FAILED);
        return;
      }
      setState({ query, items: result.page.items, hasMore: result.page.hasMore, searched: true });
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (morePending) {
      return;
    }
    search(inputRef.current?.value.trim() ?? "");
  }

  function clearSearch() {
    if (inputRef.current) {
      inputRef.current.value = "";
      inputRef.current.focus();
    }
    search("");
  }

  function loadMore() {
    setError(null);
    const request = { query: state.query, offset: state.items.length };
    startLoadMore(async () => {
      const result = await searchClientsAction({ view, ...request });
      if (!result.ok) {
        setError(LOAD_MORE_FAILED);
        return;
      }
      setState((previous) => appendPage(previous, request, result.page));
    });
  }

  const isSearchActive = state.query !== "";

  return (
    <div className="space-y-4">
      <form role="search" onSubmit={handleSubmit} className="space-y-1.5">
        <label htmlFor="clients-search" className="block text-sm font-medium">
          חיפוש לפי שם או טלפון
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            ref={inputRef}
            id="clients-search"
            name="query"
            type="search"
            maxLength={CLIENT_SEARCH_QUERY_MAX_LENGTH}
            autoComplete="off"
            enterKeyHint="search"
            className="border-input bg-background min-h-11 min-w-0 flex-1 basis-48 rounded-md border px-3 text-base"
          />
          <Button type="submit" disabled={searchPending || morePending} aria-busy={searchPending}>
            {searchPending ? "מחפש…" : "חיפוש"}
          </Button>
          {isSearchActive ? (
            <Button
              variant="secondary"
              onClick={clearSearch}
              disabled={searchPending || morePending}
            >
              ניקוי החיפוש
            </Button>
          ) : null}
        </div>
      </form>

      <p role="status" className="text-sm">
        {resultSummary(state)}
      </p>
      <p role="alert" className="text-destructive text-sm font-medium">
        {error}
      </p>

      {state.items.length === 0 ? (
        <EmptyList view={view} isSearchActive={isSearchActive} />
      ) : (
        <ul
          aria-label="רשימת הלקוחות"
          aria-busy={searchPending}
          className="divide-y rounded-lg border"
        >
          {state.items.map((client) => (
            <li key={client.id}>
              <Link
                href={clientPath(client.id)}
                className="hover:bg-accent flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2"
              >
                <span className="min-w-0 font-medium wrap-anywhere">{client.name}</span>
                {client.phone ? (
                  <span dir="ltr" className="text-muted-foreground text-sm">
                    {client.phone}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {state.hasMore ? (
        <Button
          variant="secondary"
          onClick={loadMore}
          disabled={morePending || searchPending}
          aria-busy={morePending}
        >
          {morePending ? "טוען…" : "הצגת לקוחות נוספים"}
        </Button>
      ) : null}
    </div>
  );
}

function EmptyList({ view, isSearchActive }: { view: ClientListView; isSearchActive: boolean }) {
  if (isSearchActive) {
    return <p className="text-muted-foreground">אפשר לחפש בשם אחר או במספר טלפון אחר.</p>;
  }
  if (view === "archived") {
    return <p className="text-muted-foreground">אין לקוחות בארכיון.</p>;
  }
  return (
    <div className="space-y-3 rounded-lg border p-6 text-center">
      <p className="font-medium">עדיין אין לקוחות.</p>
      <p className="text-muted-foreground text-sm">כאן יופיעו הלקוחות שתוסיפו.</p>
      <Link href={NEW_CLIENT_PATH} className={buttonClasses("primary")}>
        הוספת לקוח ראשון
      </Link>
    </div>
  );
}
