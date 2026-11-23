import { describe, expect, it } from "vitest";

import { DATE_MESSAGES } from "@/lib/field-rules";

import {
  EXPORT_MESSAGES,
  defaultExportRange,
  exportFileName,
  exportFilePath,
  lastAllowedTo,
  tooLongMessage,
  validateExportRange,
} from "./range";

describe("EXPORT-1 / criterion 5: the export range", () => {
  it("EXPORT-1: a valid range, inclusive, one day long included", () => {
    expect(validateExportRange("2026-01-01", "2026-12-31")).toEqual({
      ok: true,
      range: { from: "2026-01-01", to: "2026-12-31" },
    });
    expect(validateExportRange("2026-11-23", "2026-11-23")).toEqual({
      ok: true,
      range: { from: "2026-11-23", to: "2026-11-23" },
    });
    expect(validateExportRange(" 2026-01-01 ", "2026-01-02")).toMatchObject({ ok: true });
  });

  it("EXPORT-1: missing dates say which one is missing", () => {
    expect(validateExportRange("", "")).toEqual({
      ok: false,
      errors: { from: EXPORT_MESSAGES.fromMissing, to: EXPORT_MESSAGES.toMissing },
    });
    expect(validateExportRange(null, "2026-01-01")).toEqual({
      ok: false,
      errors: { from: EXPORT_MESSAGES.fromMissing },
    });
    expect(validateExportRange("2026-01-01", undefined)).toEqual({
      ok: false,
      errors: { to: EXPORT_MESSAGES.toMissing },
    });
  });

  it("EXPORT-1: impossible and malformed dates are invalid", () => {
    for (const value of ["2026-02-29", "2026-13-01", "16/11/2026", "2026-1-1", "x", "2026-04-31"]) {
      expect(validateExportRange(value, "2026-12-31")).toEqual({
        ok: false,
        errors: { from: DATE_MESSAGES.invalid },
      });
    }
  });

  it("EXPORT-1: dates outside 1900–2100 are refused", () => {
    expect(validateExportRange("1899-12-31", "1900-01-01")).toEqual({
      ok: false,
      errors: { from: DATE_MESSAGES.outOfRange },
    });
    expect(validateExportRange("2100-01-01", "2101-01-01")).toEqual({
      ok: false,
      errors: { to: DATE_MESSAGES.outOfRange },
    });
    expect(validateExportRange("1900-01-01", "1900-12-31")).toMatchObject({ ok: true });
    expect(validateExportRange("2100-01-01", "2100-12-31")).toMatchObject({ ok: true });
  });

  it("EXPORT-1: the end cannot be before the start", () => {
    expect(validateExportRange("2027-01-01", "2026-12-31")).toEqual({
      ok: false,
      errors: { to: EXPORT_MESSAGES.order },
    });
  });

  it("criterion 5: at most 5 years: 01/01/2021–31/12/2025 is allowed, one more day is not", () => {
    expect(validateExportRange("2021-01-01", "2025-12-31")).toMatchObject({ ok: true });
    expect(validateExportRange("2021-01-01", "2026-01-01")).toEqual({
      ok: false,
      errors: { to: tooLongMessage("2025-12-31") },
    });
    expect(tooLongMessage("2025-12-31")).toBe(
      "אפשר לייצא עד 5 שנים בכל קובץ. לתאריך ההתחלה הזה, תאריך הסיום יכול להיות עד 31/12/2025.",
    );
  });

  it("criterion 5: the 5-year limit across a leap day", () => {
    expect(lastAllowedTo("2024-02-29")).toBe("2029-02-28");
    expect(lastAllowedTo("2023-03-01")).toBe("2028-02-29");
    expect(lastAllowedTo("2026-11-23")).toBe("2031-11-22");
    expect(validateExportRange("2024-02-29", "2029-02-28")).toMatchObject({ ok: true });
    expect(validateExportRange("2024-02-29", "2029-03-01")).toMatchObject({ ok: false });
  });
});

describe("EXPORT-1 / criterion 4: addresses and file names", () => {
  it("criterion 4: the file address holds only the dates", () => {
    expect(exportFilePath("incomes", { from: "2026-01-01", to: "2026-12-31" })).toBe(
      "/export/incomes?from=2026-01-01&to=2026-12-31",
    );
    expect(exportFilePath("expenses", { from: "2026-01-01", to: "2026-01-31" })).toBe(
      "/export/expenses?from=2026-01-01&to=2026-01-31",
    );
  });

  it("criterion 4: the file name is ASCII", () => {
    const name = exportFileName("incomes", { from: "2026-01-01", to: "2026-12-31" });
    expect(name).toBe("hkmanager-incomes-2026-01-01_2026-12-31.csv");
    expect(/^[\x20-\x7e]+$/.test(name)).toBe(true);
    expect(exportFileName("expenses", { from: "1900-01-01", to: "1904-12-31" })).toBe(
      "hkmanager-expenses-1900-01-01_1904-12-31.csv",
    );
  });

  it("EXPORT-1: the default range is 1 January to today in Asia/Jerusalem", () => {
    // 31/12/2026 23:30 in Israel is still 2026 there, already 2027 nowhere relevant.
    expect(defaultExportRange(new Date("2026-12-31T21:30:00.000Z"))).toEqual({
      from: "2026-01-01",
      to: "2026-12-31",
    });
    // 1/1/2027 00:30 in Israel, while it is still 31/12 in UTC.
    expect(defaultExportRange(new Date("2026-12-31T22:30:00.000Z"))).toEqual({
      from: "2027-01-01",
      to: "2027-01-01",
    });
  });
});
