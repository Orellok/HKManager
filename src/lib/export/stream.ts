import { CSV_BOM, csvRecord } from "./csv";

/**
 * EXPORT-2 / criterion 5: a CSV file as a byte stream with bounded memory. The first page is
 * read before the stream is returned, so a failure to start (the database is unreachable)
 * can still be answered with an error screen instead of a download. Each further page is read
 * only when the client has consumed the previous bytes (pull), so the server holds about one
 * page at a time. A page that fails later errors the stream: the browser marks the download
 * as failed rather than saving a silently shortened file.
 */
export async function openCsvStream<Row>(
  columns: readonly string[],
  pages: AsyncGenerator<Row[], void, undefined>,
  fields: (row: Row) => readonly string[],
  onError: (error: unknown) => void,
): Promise<ReadableStream<Uint8Array>> {
  const encoder = new TextEncoder();
  const encodePage = (rows: readonly Row[]) =>
    encoder.encode(rows.map((row) => csvRecord(fields(row))).join(""));

  const first = await pages.next();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(CSV_BOM + csvRecord(columns)));
      if (first.done) {
        controller.close();
        return;
      }
      controller.enqueue(encodePage(first.value));
    },
    async pull(controller) {
      if (first.done) {
        return;
      }
      try {
        const next = await pages.next();
        if (next.done) {
          controller.close();
        } else {
          controller.enqueue(encodePage(next.value));
        }
      } catch (error) {
        onError(error);
        controller.error(new Error("The export stopped before the end"));
      }
    },
    async cancel() {
      await pages.return(undefined);
    },
  });
}
