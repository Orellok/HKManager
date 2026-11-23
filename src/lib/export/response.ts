import { NextResponse } from "next/server";

import { requireAllowedUser } from "@/lib/auth/guards";
import { logDbFailure } from "@/lib/log";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { EXPENSE_COLUMNS, INCOME_COLUMNS, expenseFields, incomeFields } from "./columns";
import { exportPages } from "./queries";
import {
  ERROR_PARAM,
  EXPORT_PATH,
  FAILED_ERROR,
  FROM_PARAM,
  TO_PARAM,
  exportFileName,
  validateExportRange,
  type ExportKind,
  type ExportRange,
} from "./range";
import { openCsvStream } from "./stream";

/** Longest date value echoed back to the export screen (an ISO date has 10 characters). */
const MAX_ECHOED_LENGTH = 10;

/**
 * The export screen with the submitted dates, so it can show what is wrong next to the
 * fields (criterion 5: an inline error, never a broken download). Only the dates and a fixed
 * error code go into the address (SPEC 8).
 */
function backToExportScreen(
  request: Request,
  from: string | null,
  to: string | null,
  failed: boolean,
): NextResponse {
  const url = new URL(EXPORT_PATH, request.url);
  url.searchParams.set(FROM_PARAM, (from ?? "").slice(0, MAX_ECHOED_LENGTH));
  url.searchParams.set(TO_PARAM, (to ?? "").slice(0, MAX_ECHOED_LENGTH));
  if (failed) {
    url.searchParams.set(ERROR_PARAM, FAILED_ERROR);
  }
  const response = NextResponse.redirect(url, 303);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

async function openStream(kind: ExportKind, range: ExportRange) {
  const supabase = await createSupabaseServerClient();
  const onError = (error: unknown) => logDbFailure(kind, "export page", error);
  return kind === "incomes"
    ? openCsvStream(INCOME_COLUMNS, exportPages(supabase, kind, range), incomeFields, onError)
    : openCsvStream(EXPENSE_COLUMNS, exportPages(supabase, kind, range), expenseFields, onError);
}

/**
 * EXPORT-1..3 / criterion 4: answers GET /export/<kind>?from=…&to=… with the CSV file of the
 * range, built on the server for an allowlisted session only. An invalid range or a failure
 * before the first byte returns to the export screen with the error; the file is never
 * cached and its name is ASCII.
 */
export async function exportCsvResponse(request: Request, kind: ExportKind): Promise<Response> {
  await requireAllowedUser();
  const params = new URL(request.url).searchParams;
  const from = params.get(FROM_PARAM);
  const to = params.get(TO_PARAM);
  const validation = validateExportRange(from, to);
  if (!validation.ok) {
    return backToExportScreen(request, from, to, false);
  }
  let body: ReadableStream<Uint8Array>;
  try {
    body = await openStream(kind, validation.range);
  } catch (error) {
    logDbFailure(kind, "export", error);
    return backToExportScreen(request, from, to, true);
  }
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFileName(kind, validation.range)}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
