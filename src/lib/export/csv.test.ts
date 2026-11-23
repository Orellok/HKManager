import { describe, expect, it } from "vitest";

import { CSV_BOM, CSV_LINE_END, csvField, csvRecord, neutralizeFormula } from "./csv";

describe("EXPORT-2: CSV fields (RFC 4180)", () => {
  it("EXPORT-2: a plain field, Hebrew included, is written as is", () => {
    expect(csvField("דוד לוי")).toBe("דוד לוי");
    expect(csvField("")).toBe("");
  });

  it.each([
    ["כהן, משה", '"כהן, משה"'],
    ['חברת "הבית"', '"חברת ""הבית"""'],
    ["שורה\nשנייה", '"שורה\nשנייה"'],
    ["שורה\r\nשנייה", '"שורה\r\nשנייה"'],
    ['שיפוצים בע"מ', '"שיפוצים בע""מ"'],
    ['"', '""""'],
    [",", '","'],
  ])("EXPORT-2: %j is quoted as %j", (value, expected) => {
    expect(csvField(value)).toBe(expected);
  });

  it("EXPORT-2: a record joins fields with commas and ends with CRLF", () => {
    expect(csvRecord(["16/11/2026", 'לוי, "דני"', "12500.50"])).toBe(
      '16/11/2026,"לוי, ""דני""",12500.50\r\n',
    );
    expect(CSV_LINE_END).toBe("\r\n");
  });

  it("EXPORT-2: the BOM is U+FEFF, encoded in UTF-8 as EF BB BF", () => {
    expect([...new TextEncoder().encode(CSV_BOM)]).toEqual([0xef, 0xbb, 0xbf]);
  });
});

describe("EXPORT-2 / criterion 4: CSV injection", () => {
  it.each([
    ['=HYPERLINK("http://x")', '\'=HYPERLINK("http://x")'],
    ["+972501234567", "'+972501234567"],
    ["-5% הנחה", "'-5% הנחה"],
    ["@SUM(A1)", "'@SUM(A1)"],
    ["\t=1+1", "'\t=1+1"],
    ["\r=1+1", "'\r=1+1"],
  ])("EXPORT-2: %j becomes text: %j", (value, expected) => {
    expect(neutralizeFormula(value)).toBe(expected);
  });

  it("EXPORT-2: a field is neutralized before it is quoted", () => {
    expect(csvField('=1+1,"x"')).toBe(`"'=1+1,""x"""`);
    expect(csvField("\r=cmd")).toBe(`"'\r=cmd"`);
  });

  it("EXPORT-2: fields that only contain those characters later are left alone", () => {
    for (const value of ["משה-כהן", "a=b", "x@y.com", "1+1", " =1", "12500.50", "16/11/2026"]) {
      expect(neutralizeFormula(value)).toBe(value);
    }
  });
});
