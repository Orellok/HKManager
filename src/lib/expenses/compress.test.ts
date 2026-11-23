import { describe, expect, it } from "vitest";

import { MAX_IMAGE_SIDE, scaledSize } from "./compress";

describe("scaledSize", () => {
  it("EXP-2: the longest side limit is 2000px (owner decision)", () => {
    expect(MAX_IMAGE_SIDE).toBe(2000);
  });

  it("EXP-2: an image whose longest side is at most 2000px keeps its size", () => {
    expect(scaledSize(800, 600)).toEqual({ width: 800, height: 600 });
    expect(scaledSize(2000, 1500)).toEqual({ width: 2000, height: 1500 });
    expect(scaledSize(1, 1)).toEqual({ width: 1, height: 1 });
  });

  it("EXP-2: a landscape photo is scaled so its width is 2000px, keeping the proportions", () => {
    expect(scaledSize(4000, 3000)).toEqual({ width: 2000, height: 1500 });
    expect(scaledSize(4032, 3024)).toEqual({ width: 2000, height: 1500 });
  });

  it("EXP-2: a portrait photo (e.g. after EXIF rotation) is scaled so its height is 2000px", () => {
    expect(scaledSize(3024, 4032)).toEqual({ width: 1500, height: 2000 });
    expect(scaledSize(2001, 4002)).toEqual({ width: 1000, height: 2000 });
  });

  it("EXP-2: a square image above the limit becomes 2000 × 2000", () => {
    expect(scaledSize(5000, 5000)).toEqual({ width: 2000, height: 2000 });
  });

  it("EXP-2: a very long, thin image keeps at least 1px on its short side", () => {
    expect(scaledSize(100_000, 10)).toEqual({ width: 2000, height: 1 });
    expect(scaledSize(10, 100_000)).toEqual({ width: 1, height: 2000 });
  });

  it("EXP-2: one pixel above the limit is scaled down", () => {
    expect(scaledSize(2001, 1000)).toEqual({ width: 2000, height: 1000 });
  });

  it("EXP-2: an empty or invalid size is refused rather than drawn", () => {
    expect(() => scaledSize(0, 100)).toThrow(RangeError);
    expect(() => scaledSize(100, Number.NaN)).toThrow(RangeError);
    expect(() => scaledSize(Number.POSITIVE_INFINITY, 100)).toThrow(RangeError);
  });

  it("EXP-2: a custom limit applies the same way", () => {
    expect(scaledSize(300, 150, 100)).toEqual({ width: 100, height: 50 });
  });
});
