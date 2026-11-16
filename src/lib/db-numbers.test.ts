import { describe, expect, it } from "vitest";

import { countFromDb } from "./db-numbers";

describe("countFromDb", () => {
  it.each([
    [0, 0],
    [3, 3],
    ["42", 42],
    [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  ])("MS-6: reads the count %j as %i", (value, count) => {
    expect(countFromDb(value)).toBe(count);
  });

  it.each([null, undefined, -1, 1.5, "1.5", "-1", "abc", Number.MAX_SAFE_INTEGER + 1])(
    "MS-6: rejects the count %j",
    (value) => {
      expect(() => countFromDb(value)).toThrow(RangeError);
    },
  );
});
