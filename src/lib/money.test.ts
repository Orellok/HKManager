import { describe, expect, it } from "vitest";

import {
  MAX_AGOROT,
  agorotFromDb,
  agorotToShekelInput,
  formatAgorot,
  parseShekelsToAgorot,
} from "./money";

/** Direction marks and spaces Intl puts around the number and the sign. */
const RLM = "‏";
const NBSP = " ";

describe("parseShekelsToAgorot", () => {
  it.each([
    ["0", 0],
    ["0.00", 0],
    ["0.01", 1],
    ["0.1", 10],
    ["0.5", 50],
    ["1", 100],
    ["12500", 1_250_000],
    ["12,500", 1_250_000],
    ["12,500.50", 1_250_050],
    ["12500.5", 1_250_050],
    ["1,234,567.89", 123_456_789],
    ["007", 700],
    ["  12,500 ", 1_250_000],
    ["₪12,500", 1_250_000],
    ["12500 ₪", 1_250_000],
    ["99,999,999.99", MAX_AGOROT],
    ["99999999.99", MAX_AGOROT],
    // Classic floating-point traps: 0.1 + 0.2, 1.005 * 100, 4.35 * 100.
    ["0.30", 30],
    ["1.01", 101],
    ["4.35", 435],
    ["1.15", 115],
  ])("PRJ-1: %j shekels are %i agorot", (input, agorot) => {
    expect(parseShekelsToAgorot(input)).toEqual({ ok: true, agorot });
  });

  it.each([
    ["1.005", "too_many_decimals"],
    ["12,500.505", "too_many_decimals"],
    ["-1", "negative"],
    ["-0.01", "negative"],
    ["−5", "negative"],
    ["100,000,000", "too_large"],
    ["99999999.991", "too_many_decimals"],
    ["100000000.00", "too_large"],
    ["99999999999999999999", "too_large"],
    ["", "invalid"],
    ["   ", "invalid"],
    ["abc", "invalid"],
    ["12a", "invalid"],
    ["1,25", "invalid"],
    ["12,50.00", "invalid"],
    [",500", "invalid"],
    ["1,000,00", "invalid"],
    ["12 500", "invalid"],
    ["12.", "invalid"],
    [".5", "invalid"],
    ["1.2.3", "invalid"],
    ["1e5", "invalid"],
    ["+5", "invalid"],
    ["NaN", "invalid"],
    ["Infinity", "invalid"],
    ["١٢٣", "non_latin_digits"],
    ["１２３", "non_latin_digits"],
    ["1٢3", "non_latin_digits"],
    ["-١", "non_latin_digits"],
    ["₪ ١٢,٥٠٠", "non_latin_digits"],
  ])("PRJ-1: %j is rejected as %s", (input, error) => {
    expect(parseShekelsToAgorot(input)).toEqual({ ok: false, error });
  });
});

describe("formatAgorot", () => {
  it.each([
    [0, "0.00"],
    [1, "0.01"],
    [50, "0.50"],
    [1_250_050, "12,500.50"],
    [1_250_000, "12,500.00"],
    [MAX_AGOROT, "99,999,999.99"],
  ])("PRJ-3: %i agorot are shown as ₪%s in Hebrew format", (agorot, number) => {
    expect(formatAgorot(agorot)).toBe(`${RLM}${number}${NBSP}${RLM}₪`);
  });

  it("PRJ-3: a large amount is exact to the agora", () => {
    expect(formatAgorot(9_007_199_254_740_991)).toBe(`${RLM}90,071,992,547,409.91${NBSP}${RLM}₪`);
  });

  it("PRJ-3: refuses an amount that is not an integer number of agorot", () => {
    expect(() => formatAgorot(1.5)).toThrow(RangeError);
    expect(() => formatAgorot(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });
});

describe("agorotToShekelInput", () => {
  it.each([
    [0, "0"],
    [1, "0.01"],
    [10, "0.10"],
    [1_250_000, "12500"],
    [1_250_050, "12500.50"],
  ])(
    "PRJ-1: %i agorot are prefilled as %j, which parses back to the same amount",
    (agorot, text) => {
      expect(agorotToShekelInput(agorot)).toBe(text);
      expect(parseShekelsToAgorot(text)).toEqual({ ok: true, agorot });
    },
  );
});

describe("agorotFromDb", () => {
  it.each([
    [null, null],
    [undefined, null],
    [0, 0],
    [1_250_050, 1_250_050],
    ["1250050", 1_250_050],
    [MAX_AGOROT, MAX_AGOROT],
    [String(MAX_AGOROT), MAX_AGOROT],
  ])("PRJ-1: reads %j as %j", (value, agorot) => {
    expect(agorotFromDb(value)).toBe(agorot);
  });

  it.each([
    [-1],
    [1.5],
    [MAX_AGOROT + 1],
    ["12.5"],
    ["-1"],
    ["9007199254740993"],
    [""],
    [true],
    [{}],
  ])("PRJ-1: rejects %j", (value) => {
    expect(() => agorotFromDb(value)).toThrow(RangeError);
  });
});
