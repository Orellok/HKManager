import { describe, expect, it } from "vitest";

import {
  RECEIPT_FIELD_MESSAGES,
  readReceiptFormValues,
  validateReceiptInput,
  type ReceiptFormValues,
} from "./schema";

const TODAY = "2026-11-17";

function values(fields: Partial<ReceiptFormValues> = {}): ReceiptFormValues {
  return {
    doc_number: "10023",
    issued_date: TODAY,
    source: "file",
    file: "",
    url: "",
    ...fields,
  };
}

describe("validateReceiptInput", () => {
  it("DOC-2: a receipt with a file needs a number and an issue date; the link is dropped", () => {
    expect(validateReceiptInput(values({ url: "https://ignored.example" }), TODAY)).toEqual({
      success: true,
      data: { doc_number: "10023", issued_date: TODAY, source: "file", url: null },
    });
  });

  it("DOC-2: a receipt with an https link keeps the trimmed link", () => {
    expect(
      validateReceiptInput(
        values({ source: "link", url: "  https://app.sumit.co.il/doc/1?x=2  " }),
        TODAY,
      ),
    ).toEqual({
      success: true,
      data: {
        doc_number: "10023",
        issued_date: TODAY,
        source: "link",
        url: "https://app.sumit.co.il/doc/1?x=2",
      },
    });
  });

  it.each([
    ["", RECEIPT_FIELD_MESSAGES.urlRequired],
    ["http://app.sumit.co.il/doc/1", RECEIPT_FIELD_MESSAGES.urlNotHttps],
    ["javascript:alert(1)", RECEIPT_FIELD_MESSAGES.urlNotHttps],
    ["app.sumit.co.il/doc/1", RECEIPT_FIELD_MESSAGES.urlNotHttps],
    ["https://", RECEIPT_FIELD_MESSAGES.urlInvalid],
    ["https://app.sumit.co.il/a b", RECEIPT_FIELD_MESSAGES.urlInvalid],
    ["HTTPS://APP.SUMIT.CO.IL/", RECEIPT_FIELD_MESSAGES.urlInvalid],
    [`https://a.example/${"x".repeat(2000)}`, RECEIPT_FIELD_MESSAGES.urlTooLong],
  ])("owner decision: the link %j is refused", (url, message) => {
    expect(validateReceiptInput(values({ source: "link", url }), TODAY)).toEqual({
      success: false,
      fieldErrors: { url: message },
    });
  });

  it("DOC-2: the receipt number is required, trimmed and limited to letters, digits, - and /", () => {
    expect(validateReceiptInput(values({ doc_number: "  " }), TODAY)).toMatchObject({
      fieldErrors: { doc_number: RECEIPT_FIELD_MESSAGES.docNumberRequired },
    });
    expect(validateReceiptInput(values({ doc_number: " A-12/3 " }), TODAY)).toMatchObject({
      success: true,
      data: { doc_number: "A-12/3" },
    });
    for (const invalid of ["12 34", "קבלה1", "1".repeat(31), "12;drop"]) {
      expect(validateReceiptInput(values({ doc_number: invalid }), TODAY)).toMatchObject({
        fieldErrors: { doc_number: RECEIPT_FIELD_MESSAGES.docNumberInvalid },
      });
    }
  });

  it("DOC-2: a receipt number starting with - or / gets a message that explains the first character", () => {
    for (const invalid of ["-12", "/12", " -A1"]) {
      expect(validateReceiptInput(values({ doc_number: invalid }), TODAY)).toMatchObject({
        fieldErrors: { doc_number: RECEIPT_FIELD_MESSAGES.docNumberLeadingSymbol },
      });
    }
    expect(RECEIPT_FIELD_MESSAGES.docNumberLeadingSymbol).toContain("להתחיל בספרה או באות");
  });

  it("DOC-2: the issue date is required and cannot be in the future; today is accepted", () => {
    expect(validateReceiptInput(values({ issued_date: "" }), TODAY)).toMatchObject({
      fieldErrors: { issued_date: RECEIPT_FIELD_MESSAGES.issuedDateRequired },
    });
    expect(validateReceiptInput(values({ issued_date: "2026-11-18" }), TODAY)).toMatchObject({
      fieldErrors: { issued_date: RECEIPT_FIELD_MESSAGES.issuedDateInFuture },
    });
    expect(validateReceiptInput(values({ issued_date: "2026-02-30" }), TODAY)).toMatchObject({
      success: false,
    });
    expect(validateReceiptInput(values({ issued_date: "2025-12-31" }), TODAY).success).toBe(true);
  });

  it("DOC-2: the source must be a file or a link", () => {
    expect(validateReceiptInput(values({ source: "" }), TODAY)).toMatchObject({
      fieldErrors: { source: RECEIPT_FIELD_MESSAGES.sourceRequired },
    });
    expect(validateReceiptInput(values({ source: "email" }), TODAY)).toMatchObject({
      fieldErrors: { source: RECEIPT_FIELD_MESSAGES.sourceRequired },
    });
  });
});

describe("readReceiptFormValues", () => {
  it("DOC-2: reads the text fields; the file never comes from the form data", () => {
    const formData = new FormData();
    formData.set("doc_number", "1");
    formData.set("issued_date", TODAY);
    formData.set("source", "file");
    formData.set("file", new Blob(["%PDF-"]));
    expect(readReceiptFormValues(formData)).toEqual({
      doc_number: "1",
      issued_date: TODAY,
      source: "file",
      file: "",
      url: "",
    });
  });
});
