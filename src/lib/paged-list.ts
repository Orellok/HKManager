/** A paged list loaded with "load more" (clients, projects). */

export type ListPage<Item> = { items: Item[]; hasMore: boolean };

/** The filter that produced a list, e.g. `{ query: "דנה" }`. Values only, no nesting. */
export type ListFilter = Readonly<Record<string, string>>;

export type PagedListState<Item, Filter extends ListFilter> = ListPage<Item> & {
  /** The search and filters that produced `items`. */
  filter: Filter;
  /** Set once the user searched or filtered, so the result count is announced. */
  searched: boolean;
};

export type PageRequest<Filter extends ListFilter> = { filter: Filter; offset: number };

export function isSameFilter(first: ListFilter, second: ListFilter): boolean {
  const keys = Object.keys(first);
  return (
    keys.length === Object.keys(second).length && keys.every((key) => first[key] === second[key])
  );
}

/**
 * Appends a "load more" page. A page requested for another list (the search or a filter
 * changed, or the list was reloaded meanwhile) is dropped, so results of two searches never
 * mix. Items already shown are not repeated (a record that moved between pages, e.g. one
 * updated meanwhile in a list sorted by last update).
 */
export function appendPage<Item extends { id: string }, Filter extends ListFilter>(
  previous: PagedListState<Item, Filter>,
  request: PageRequest<Filter>,
  page: ListPage<Item>,
): PagedListState<Item, Filter> {
  if (!isSameFilter(previous.filter, request.filter) || previous.items.length !== request.offset) {
    return previous;
  }
  // The next request's offset is items.length, so a dropped repeat can at worst re-fetch a row.
  const shown = new Set(previous.items.map((item) => item.id));
  return {
    ...previous,
    items: [...previous.items, ...page.items.filter((item) => !shown.has(item.id))],
    hasMore: page.hasMore,
  };
}
