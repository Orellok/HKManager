import { describe, expect, it } from "vitest";

import { moveTargetIndex } from "./reorder";

describe("moveTargetIndex", () => {
  it.each([
    [1, 3, "up", 0],
    [2, 3, "up", 1],
    [0, 3, "down", 1],
    [1, 3, "down", 2],
  ] as const)(
    "MS-1: item %i of %i moved %s goes to index %i",
    (index, length, direction, target) => {
      expect(moveTargetIndex(index, length, direction)).toBe(target);
    },
  );

  it("MS-1: the first item cannot move up", () => {
    expect(moveTargetIndex(0, 3, "up")).toBeNull();
  });

  it("MS-1: the last item cannot move down", () => {
    expect(moveTargetIndex(2, 3, "down")).toBeNull();
  });

  it("MS-1: a single item cannot move at all", () => {
    expect(moveTargetIndex(0, 1, "up")).toBeNull();
    expect(moveTargetIndex(0, 1, "down")).toBeNull();
  });

  it.each([
    [-1, 3],
    [3, 3],
    [0, 0],
  ])("MS-1: an index outside the list (%i of %i) moves nowhere", (index, length) => {
    expect(moveTargetIndex(index, length, "up")).toBeNull();
    expect(moveTargetIndex(index, length, "down")).toBeNull();
  });
});
