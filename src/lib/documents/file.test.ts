import { describe, expect, it } from "vitest";

import {
  RECEIPT_MAX_BYTES,
  checkReceiptFile,
  checkReceiptFileContent,
  hasPdfSignature,
} from "./file";

const encode = (text: string) => new TextEncoder().encode(text);

describe("hasPdfSignature", () => {
  it("DOC-2: accepts bytes that start with %PDF-", () => {
    expect(hasPdfSignature(encode("%PDF-1.7\n"))).toBe(true);
  });

  it("DOC-2: refuses other starts, a lowercase signature and too few bytes", () => {
    expect(hasPdfSignature(encode("<html>"))).toBe(false);
    expect(hasPdfSignature(encode("%pdf-1.7"))).toBe(false);
    expect(hasPdfSignature(encode(" %PDF-1.7"))).toBe(false);
    expect(hasPdfSignature(encode("%PDF"))).toBe(false);
    expect(hasPdfSignature(new Uint8Array())).toBe(false);
  });
});

describe("checkReceiptFile", () => {
  it("DOC-2: a PDF of up to 10MB is accepted", () => {
    expect(checkReceiptFile({ size: 1, type: "application/pdf" })).toBeNull();
    expect(checkReceiptFile({ size: RECEIPT_MAX_BYTES, type: "application/pdf" })).toBeNull();
  });

  it("DOC-2: one byte above 10MB is too large", () => {
    expect(checkReceiptFile({ size: RECEIPT_MAX_BYTES + 1, type: "application/pdf" })).toBe(
      "too_large",
    );
  });

  it("DOC-2: an empty file and other types are refused", () => {
    expect(checkReceiptFile({ size: 0, type: "application/pdf" })).toBe("empty");
    expect(checkReceiptFile({ size: 10, type: "image/png" })).toBe("not_pdf");
    expect(checkReceiptFile({ size: 10, type: "" })).toBe("not_pdf");
  });

  it("DOC-2: 10MB is 10485760 bytes, the bucket's limit", () => {
    expect(RECEIPT_MAX_BYTES).toBe(10_485_760);
  });
});

describe("checkReceiptFileContent", () => {
  it("DOC-2: a PDF typed blob with the signature is accepted", async () => {
    const blob = new Blob(["%PDF-1.4 body"], { type: "application/pdf" });
    expect(await checkReceiptFileContent(blob)).toBeNull();
  });

  it("DOC-2: a file named and typed as PDF without the signature is refused", async () => {
    const blob = new Blob(["MZ executable"], { type: "application/pdf" });
    expect(await checkReceiptFileContent(blob)).toBe("not_pdf");
  });

  it("DOC-2: the size and type checks come first", async () => {
    expect(await checkReceiptFileContent(new Blob([], { type: "application/pdf" }))).toBe("empty");
    expect(await checkReceiptFileContent(new Blob(["%PDF-"], { type: "text/plain" }))).toBe(
      "not_pdf",
    );
  });
});
