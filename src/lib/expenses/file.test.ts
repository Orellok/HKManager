import { describe, expect, it } from "vitest";

import {
  EXPENSE_FILE_MAX_BYTES,
  IMAGE_INPUT_MAX_BYTES,
  checkChosenFile,
  checkUploadFile,
  checkUploadFileContent,
  extensionFor,
  typeOfPath,
} from "./file";

const JPEG_BYTES = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);

describe("checkChosenFile", () => {
  it("EXP-2: JPEG, PNG and PDF are accepted (owner decision)", () => {
    for (const type of ["image/jpeg", "image/png", "application/pdf"]) {
      expect(checkChosenFile({ size: 1000, type })).toBeNull();
    }
  });

  it("EXP-2 / SPEC 10: other types are refused, also HEIC and an unknown type", () => {
    for (const type of ["image/heic", "image/gif", "image/webp", "text/html", ""]) {
      expect(checkChosenFile({ size: 1000, type })).toBe("unsupported");
    }
  });

  it("EXP-2: an empty file is refused", () => {
    expect(checkChosenFile({ size: 0, type: "image/jpeg" })).toBe("empty");
  });

  it("EXP-2 / SPEC 10: a PDF above 10MB is too large; an image is compressed first, up to 40MB", () => {
    expect(checkChosenFile({ size: EXPENSE_FILE_MAX_BYTES, type: "application/pdf" })).toBeNull();
    expect(checkChosenFile({ size: EXPENSE_FILE_MAX_BYTES + 1, type: "application/pdf" })).toBe(
      "too_large",
    );
    expect(checkChosenFile({ size: EXPENSE_FILE_MAX_BYTES + 1, type: "image/jpeg" })).toBeNull();
    expect(checkChosenFile({ size: IMAGE_INPUT_MAX_BYTES, type: "image/png" })).toBeNull();
    expect(checkChosenFile({ size: IMAGE_INPUT_MAX_BYTES + 1, type: "image/png" })).toBe(
      "image_too_large",
    );
  });
});

describe("checkUploadFile", () => {
  it("EXP-2: what is uploaded is at most 10MB (10485760 bytes, the bucket's limit)", () => {
    expect(EXPENSE_FILE_MAX_BYTES).toBe(10_485_760);
    expect(checkUploadFile({ size: EXPENSE_FILE_MAX_BYTES, type: "image/jpeg" })).toBeNull();
    expect(checkUploadFile({ size: EXPENSE_FILE_MAX_BYTES + 1, type: "image/jpeg" })).toBe(
      "too_large",
    );
    expect(checkUploadFile({ size: 0, type: "application/pdf" })).toBe("empty");
    expect(checkUploadFile({ size: 10, type: "image/gif" })).toBe("unsupported");
  });
});

describe("checkUploadFileContent", () => {
  it("EXP-2: a file whose bytes match its type is accepted", async () => {
    expect(await checkUploadFileContent(new Blob([JPEG_BYTES], { type: "image/jpeg" }))).toBeNull();
    expect(await checkUploadFileContent(new Blob([PNG_BYTES], { type: "image/png" }))).toBeNull();
    expect(
      await checkUploadFileContent(new Blob(["%PDF-1.4 body"], { type: "application/pdf" })),
    ).toBeNull();
  });

  it("EXP-2: a file whose bytes are another format, or not a file format, is refused", async () => {
    expect(await checkUploadFileContent(new Blob([PNG_BYTES], { type: "image/jpeg" }))).toBe(
      "not_matching",
    );
    expect(await checkUploadFileContent(new Blob(["<html>"], { type: "application/pdf" }))).toBe(
      "not_matching",
    );
  });

  it("EXP-2: the type and size checks come first", async () => {
    expect(await checkUploadFileContent(new Blob([], { type: "image/jpeg" }))).toBe("empty");
    expect(await checkUploadFileContent(new Blob([JPEG_BYTES], { type: "image/gif" }))).toBe(
      "unsupported",
    );
  });
});

describe("file extensions", () => {
  it("EXP-2: each type has its extension, and a stored name's extension gives its type", () => {
    expect(extensionFor("image/jpeg")).toBe("jpg");
    expect(extensionFor("image/png")).toBe("png");
    expect(extensionFor("application/pdf")).toBe("pdf");
    expect(typeOfPath("0b6f1a52-3c3e-4f3a-9a52-1f1c2d3e4f50.jpg")).toBe("image/jpeg");
    expect(typeOfPath("x.png")).toBe("image/png");
    expect(typeOfPath("x.pdf")).toBe("application/pdf");
    expect(typeOfPath("x.exe")).toBeNull();
    expect(typeOfPath("x")).toBeNull();
  });
});
