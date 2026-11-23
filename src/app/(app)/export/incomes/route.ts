import { exportCsvResponse } from "@/lib/export/response";

/** EXPORT-1: the incomes of a date range as a CSV file (see exportCsvResponse). */
export function GET(request: Request) {
  return exportCsvResponse(request, "incomes");
}
