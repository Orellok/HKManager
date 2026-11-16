import type { ClientListItem, ClientListPage } from "@/lib/clients/queries";

export type BrowserState = {
  /** The search that produced `items`; "" for the full list. */
  query: string;
  items: ClientListItem[];
  hasMore: boolean;
  /** Set once the user searched, so the result count is announced. */
  searched: boolean;
};

export type PageRequest = { query: string; offset: number };

/**
 * Appends a "load more" page. A page requested for another list (the search changed, or
 * the list was reloaded meanwhile) is dropped, so results of two searches never mix.
 */
export function appendPage(
  previous: BrowserState,
  request: PageRequest,
  page: ClientListPage,
): BrowserState {
  if (previous.query !== request.query || previous.items.length !== request.offset) {
    return previous;
  }
  return { ...previous, items: [...previous.items, ...page.items], hasMore: page.hasMore };
}
