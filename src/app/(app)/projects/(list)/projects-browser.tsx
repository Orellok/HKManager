"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";

import { Button, buttonClasses } from "@/components/button";
import { ProjectStatusBadge } from "@/components/project-status-badge";
import { useGuardedTransition } from "@/components/use-guarded-transition";
import { callServerAction } from "@/lib/auth/action-failure";
import type { ListView } from "@/lib/list-view";
import { formatAgorot } from "@/lib/money";
import { appendPage, type PagedListState } from "@/lib/paged-list";
import { searchProjectsAction } from "@/lib/projects/actions";
import { NEW_PROJECT_PATH, projectPath } from "@/lib/projects/paths";
import type { ProjectListItem, ProjectListPage } from "@/lib/projects/queries";
import { PROJECT_SEARCH_QUERY_MAX_LENGTH } from "@/lib/projects/schema";
import {
  PROJECT_STATUS_FILTERS,
  STATUS_FILTER_LABELS,
  type ProjectStatusFilter,
} from "@/lib/projects/status";

type Filter = { query: string; status: ProjectStatusFilter };

type BrowserState = PagedListState<ProjectListItem, Filter>;

type ProjectsBrowserProps = {
  view: ListView;
  /** The status filter the first page was loaded with. */
  initialStatus: ProjectStatusFilter;
  /** The first page of the list without a search, rendered on the server. */
  initialPage: ProjectListPage;
};

const SEARCH_FAILED = "החיפוש נכשל. אפשר לנסות שוב.";
const LOAD_MORE_FAILED = "טעינת פרויקטים נוספים נכשלה. אפשר לנסות שוב.";

const STATUS_OPTIONS = PROJECT_STATUS_FILTERS.map((filter) => ({
  value: filter,
  label: STATUS_FILTER_LABELS[filter],
}));

function isStatusFilter(value: string): value is ProjectStatusFilter {
  return (PROJECT_STATUS_FILTERS as readonly string[]).includes(value);
}

function resultSummary({ items, hasMore, searched }: BrowserState, isFiltered: boolean): string {
  if (!searched || !isFiltered) {
    return "";
  }
  if (items.length === 0) {
    return "לא נמצאו פרויקטים שמתאימים לחיפוש.";
  }
  if (hasMore) {
    return `מוצגים ${items.length} הפרויקטים הראשונים שמתאימים לחיפוש.`;
  }
  return items.length === 1 ? "נמצא פרויקט אחד." : `נמצאו ${items.length} פרויקטים.`;
}

/**
 * PRJ-1: search by project or client name, the status filter and the paged project list.
 * Searches go through a Server Action (POST) so that names never appear in the URL (SPEC 8).
 */
export function ProjectsBrowser({ view, initialStatus, initialPage }: ProjectsBrowserProps) {
  const [state, setState] = useState<BrowserState>({
    filter: { query: "", status: initialStatus },
    items: initialPage.items,
    hasMore: initialPage.hasMore,
    searched: false,
  });
  // The status shown in the filter: the one being searched while a search runs.
  const [status, setStatus] = useState<ProjectStatusFilter>(initialStatus);
  const [error, setError] = useState<string | null>(null);
  const [searchPending, startSearch] = useGuardedTransition();
  const [morePending, startLoadMore] = useGuardedTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  /** Index of the first item of a just-loaded last page, to move focus to once rendered. */
  const focusItemAfterLoad = useRef<number | null>(null);
  const busy = searchPending || morePending;

  // The "load more" button disappears with the last page; keyboard focus moves to the first
  // newly loaded project instead of falling back to <body>.
  useEffect(() => {
    const index = focusItemAfterLoad.current;
    if (index === null) {
      return;
    }
    focusItemAfterLoad.current = null;
    listRef.current?.querySelectorAll<HTMLAnchorElement>("a")[index]?.focus();
  }, [state.items]);

  function search(filter: Filter): boolean {
    if (busy) {
      return false;
    }
    return startSearch(async () => {
      setError(null);
      const call = await callServerAction(() =>
        searchProjectsAction({ view, ...filter, offset: 0 }),
      );
      if (call.status === "redirected") {
        return;
      }
      // A failed request (no connection, server error) keeps the list as it was.
      if (call.status === "failed" || !call.value.ok) {
        setStatus(state.filter.status);
        setError(SEARCH_FAILED);
        return;
      }
      const { page } = call.value;
      setState({ filter, items: page.items, hasMore: page.hasMore, searched: true });
    });
  }

  function currentQuery(): string {
    return inputRef.current?.value.trim() ?? "";
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    search({ query: currentQuery(), status });
  }

  function changeStatus(event: ChangeEvent<HTMLSelectElement>) {
    const next = event.currentTarget.value;
    if (isStatusFilter(next) && search({ query: currentQuery(), status: next })) {
      setStatus(next);
    }
  }

  function clearSearch() {
    if (busy) {
      return;
    }
    if (inputRef.current) {
      inputRef.current.value = "";
      inputRef.current.focus();
    }
    search({ query: "", status });
  }

  function loadMore() {
    if (busy) {
      return;
    }
    const request = { filter: state.filter, offset: state.items.length };
    startLoadMore(async () => {
      setError(null);
      const call = await callServerAction(() =>
        searchProjectsAction({ view, ...request.filter, offset: request.offset }),
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

  const isSearchActive = state.filter.query !== "";
  const isFiltered = isSearchActive || state.filter.status !== initialStatus;

  return (
    <div className="space-y-4">
      <form role="search" onSubmit={handleSubmit} className="space-y-3">
        <div className="space-y-1.5">
          <label htmlFor="projects-search" className="block text-sm font-medium">
            חיפוש לפי שם פרויקט או שם לקוח
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              ref={inputRef}
              id="projects-search"
              name="query"
              type="search"
              maxLength={PROJECT_SEARCH_QUERY_MAX_LENGTH}
              autoComplete="off"
              enterKeyHint="search"
              className="border-input bg-background min-h-11 min-w-0 flex-1 basis-48 rounded-md border px-3 text-base"
            />
            <Button type="submit" pending={busy}>
              {searchPending ? "מחפש…" : "חיפוש"}
            </Button>
            {isSearchActive ? (
              <Button variant="secondary" onClick={clearSearch} pending={busy}>
                ניקוי החיפוש
              </Button>
            ) : null}
          </div>
        </div>
        <div className="max-w-xs space-y-1.5">
          <label htmlFor="projects-status" className="block text-sm font-medium">
            סטטוס
          </label>
          <select
            id="projects-status"
            name="status"
            value={status}
            onChange={changeStatus}
            className="border-input bg-background min-h-11 w-full rounded-md border px-3 text-base"
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </form>

      <p role="status" className="text-sm">
        {resultSummary(state, isFiltered)}
      </p>
      <p role="alert" className="text-destructive text-sm font-medium">
        {error}
      </p>

      {state.items.length === 0 ? (
        <EmptyList view={view} isFiltered={isFiltered} />
      ) : (
        <ul
          ref={listRef}
          aria-label="רשימת הפרויקטים"
          aria-busy={searchPending}
          className="divide-y rounded-lg border"
        >
          {state.items.map((project) => (
            <li key={project.id}>
              <Link
                href={projectPath(project.id)}
                className="hover:bg-accent flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2"
              >
                <span className="min-w-0 space-y-0.5">
                  <span className="block font-medium wrap-anywhere">{project.name}</span>
                  <span className="text-muted-foreground block text-sm wrap-anywhere">
                    {project.client_name}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {project.contract_amount !== null ? (
                    <span className="text-sm">{formatAgorot(project.contract_amount)}</span>
                  ) : null}
                  <ProjectStatusBadge status={project.status} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {state.hasMore ? (
        <Button variant="secondary" onClick={loadMore} pending={busy}>
          {morePending ? "טוען…" : "הצגת פרויקטים נוספים"}
        </Button>
      ) : null}
    </div>
  );
}

function EmptyList({ view, isFiltered }: { view: ListView; isFiltered: boolean }) {
  if (isFiltered) {
    return <p className="text-muted-foreground">אפשר לחפש בשם אחר או לבחור סטטוס אחר.</p>;
  }
  if (view === "archived") {
    return <p className="text-muted-foreground">אין פרויקטים בארכיון.</p>;
  }
  return (
    <div className="space-y-3 rounded-lg border p-6 text-center">
      <p className="font-medium">אין פרויקטים פתוחים.</p>
      <p className="text-muted-foreground text-sm">
        כאן יופיעו פרויקטים בסטטוס ליד, פעיל או מושהה. פרויקטים שהושלמו או בוטלו מופיעים בסינון לפי
        סטטוס.
      </p>
      <Link href={NEW_PROJECT_PATH} className={buttonClasses("primary")}>
        הוספת פרויקט
      </Link>
    </div>
  );
}
