import { describe, expect, it } from "vitest";

import { appendPage, isSameFilter, type PagedListState } from "./paged-list";

const first = { id: "1", name: "א", phone: null };
const second = { id: "2", name: "ב", phone: null };

type Item = typeof first;
type State = PagedListState<Item, { query: string }>;

function state(overrides: Partial<State>): State {
  return { filter: { query: "דנה" }, items: [first], hasMore: true, searched: true, ...overrides };
}

describe("appendPage", () => {
  it("CLI-3: appends the next page of the same search", () => {
    const next = appendPage(
      state({}),
      { filter: { query: "דנה" }, offset: 1 },
      {
        items: [second],
        hasMore: false,
      },
    );

    expect(next.items).toEqual([first, second]);
    expect(next.hasMore).toBe(false);
  });

  it("CLI-3: drops a page that arrives after the search changed", () => {
    const current = state({ filter: { query: "רונית" } });

    expect(
      appendPage(
        current,
        { filter: { query: "דנה" }, offset: 1 },
        { items: [second], hasMore: false },
      ),
    ).toBe(current);
  });

  it("CLI-3: drops a page that arrives after the same search was run again", () => {
    const current = state({ items: [first, second] });

    expect(
      appendPage(
        current,
        { filter: { query: "דנה" }, offset: 1 },
        { items: [second], hasMore: false },
      ),
    ).toBe(current);
  });

  it("PRJ-1: drops a page that arrives after the status filter changed", () => {
    const current: PagedListState<Item, { query: string; status: string }> = {
      filter: { query: "", status: "completed" },
      items: [first],
      hasMore: true,
      searched: true,
    };

    expect(
      appendPage(
        current,
        { filter: { query: "", status: "open" }, offset: 1 },
        { items: [second], hasMore: false },
      ),
    ).toBe(current);
  });

  it("PRJ-1: does not repeat an item that moved to the next page", () => {
    const next = appendPage(
      state({}),
      { filter: { query: "דנה" }, offset: 1 },
      { items: [first, second], hasMore: false },
    );

    expect(next.items).toEqual([first, second]);
  });
});

describe("isSameFilter", () => {
  it("PRJ-1: compares every value", () => {
    expect(isSameFilter({ query: "a", status: "open" }, { status: "open", query: "a" })).toBe(true);
    expect(isSameFilter({ query: "a", status: "open" }, { query: "a", status: "all" })).toBe(false);
    expect(isSameFilter({ query: "a" }, { query: "a", status: "open" })).toBe(false);
  });
});
