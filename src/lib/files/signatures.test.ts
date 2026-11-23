import { describe, expect, it } from "vitest";

import {
  JPEG_MIME_TYPE,
  PDF_MIME_TYPE,
  PNG_MIME_TYPE,
  SIGNATURE_LENGTH,
  hasSignature,
  readFirstBytes,
} from "./signatures";

const JPEG_START = [0xff, 0xd8, 0xff, 0xe0];
const PNG_START = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe("hasSignature", () => {
  it("EXP-2: recognises JPEG, PNG and PDF by their first bytes", () => {
    expect(hasSignature(JPEG_MIME_TYPE, Uint8Array.from(JPEG_START))).toBe(true);
    expect(hasSignature(PNG_MIME_TYPE, Uint8Array.from(PNG_START))).toBe(true);
    expect(hasSignature(PDF_MIME_TYPE, new TextEncoder().encode("%PDF-1.7"))).toBe(true);
  });

  it("EXP-2: one format's bytes are not another's, and too few bytes match nothing", () => {
    expect(hasSignature(PNG_MIME_TYPE, Uint8Array.from(JPEG_START))).toBe(false);
    expect(hasSignature(JPEG_MIME_TYPE, Uint8Array.from(PNG_START))).toBe(false);
    expect(hasSignature(PDF_MIME_TYPE, Uint8Array.from(PNG_START))).toBe(false);
    expect(hasSignature(JPEG_MIME_TYPE, Uint8Array.from([0xff, 0xd8]))).toBe(false);
    expect(hasSignature(PNG_MIME_TYPE, new Uint8Array())).toBe(false);
  });
});

describe("readFirstBytes", () => {
  it("EXP-2: reads as many bytes as the longest signature needs", async () => {
    const blob = new Blob([new Uint8Array(100)]);
    expect((await readFirstBytes(blob)).length).toBe(SIGNATURE_LENGTH);
    expect(SIGNATURE_LENGTH).toBe(8);
  });

  it("EXP-2: a shorter file gives all of its bytes", async () => {
    expect((await readFirstBytes(new Blob([Uint8Array.from([1, 2])]))).length).toBe(2);
  });
});
