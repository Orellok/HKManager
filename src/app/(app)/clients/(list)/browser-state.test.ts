import { describe, expect, it } from "vitest";

import { appendPage, type BrowserState } from "./browser-state";

const first = { id: "1", name: "א", phone: null };
const second = { id: "2", name: "ב", phone: null };

function state(overrides: Partial<BrowserState>): BrowserState {
  return { query: "דנה", items: [first], hasMore: true, searched: true, ...overrides };
}

describe("appendPage", () => {
  it("CLI-3: appends the next page of the same search", () => {
    const next = appendPage(
      state({}),
      { query: "דנה", offset: 1 },
      {
        items: [second],
        hasMore: false,
      },
    );

    expect(next.items).toEqual([first, second]);
    expect(next.hasMore).toBe(false);
  });

  it("CLI-3: drops a page that arrives after the search changed", () => {
    const current = state({ query: "רונית" });

    expect(
      appendPage(current, { query: "דנה", offset: 1 }, { items: [second], hasMore: false }),
    ).toBe(current);
  });

  it("CLI-3: drops a page that arrives after the same search was run again", () => {
    const current = state({ items: [first, second] });

    expect(
      appendPage(current, { query: "דנה", offset: 1 }, { items: [second], hasMore: false }),
    ).toBe(current);
  });
});
