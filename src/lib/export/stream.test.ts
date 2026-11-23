import { describe, expect, it, vi } from "vitest";

import { openCsvStream } from "./stream";

type Row = { name: string; amount: string };

const COLUMNS = ["שם", "סכום"];
const fields = (row: Row) => [row.name, row.amount];

async function* pagesOf(
  pages: Row[][],
  failAt: number | null = null,
  finished?: { done: boolean },
): AsyncGenerator<Row[], void, undefined> {
  try {
    for (const [index, page] of pages.entries()) {
      if (index === failAt) {
        throw new Error("database down");
      }
      yield page;
    }
  } finally {
    if (finished) {
      finished.done = true;
    }
  }
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

describe("EXPORT-2 / criterion 5: the CSV stream", () => {
  it("EXPORT-2: starts with the BOM bytes EF BB BF, then the header and every page, CRLF", async () => {
    const stream = await openCsvStream(
      COLUMNS,
      pagesOf([[{ name: "א, ב", amount: "1.00" }], [{ name: "ג", amount: "2.50" }]]),
      fields,
      vi.fn(),
    );
    const bytes = await readAll(stream);
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)).toBe(
      '﻿שם,סכום\r\n"א, ב",1.00\r\nג,2.50\r\n',
    );
  });

  it("EXPORT-1: an empty range is a file with the header only", async () => {
    const stream = await openCsvStream(COLUMNS, pagesOf([]), fields, vi.fn());
    expect(new TextDecoder().decode(await readAll(stream))).toBe("שם,סכום\r\n");
  });

  it("criterion 5: a failure before the first page rejects, so no download starts", async () => {
    await expect(openCsvStream(COLUMNS, pagesOf([[]], 0), fields, vi.fn())).rejects.toThrow(
      "database down",
    );
  });

  it("criterion 5: a later failure errors the stream (a failed download, not a short file)", async () => {
    const onError = vi.fn();
    const stream = await openCsvStream(
      COLUMNS,
      pagesOf([[{ name: "א", amount: "1.00" }], [{ name: "ב", amount: "2.00" }]], 1),
      fields,
      onError,
    );
    await expect(readAll(stream)).rejects.toThrow("The export stopped before the end");
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("criterion 5: reads a page only when the previous one was consumed", async () => {
    let requested = 0;
    async function* counted(): AsyncGenerator<Row[], void, undefined> {
      for (let page = 0; page < 100; page += 1) {
        requested += 1;
        yield [{ name: `ש${page}`, amount: "1.00" }];
      }
    }
    const stream = await openCsvStream(COLUMNS, counted(), fields, vi.fn());
    const reader = stream.getReader();
    await reader.read();
    await reader.read();
    // Let any eager pulls run.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(requested).toBeLessThanOrEqual(3);
    await reader.cancel();
  });

  it("criterion 5: cancelling the download stops reading pages", async () => {
    const finished = { done: false };
    const stream = await openCsvStream(
      COLUMNS,
      pagesOf([[{ name: "א", amount: "1.00" }], [{ name: "ב", amount: "1.00" }]], null, finished),
      fields,
      vi.fn(),
    );
    await stream.cancel();
    expect(finished.done).toBe(true);
  });
});
