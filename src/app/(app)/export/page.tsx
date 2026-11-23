import { requireAllowedUser } from "@/lib/auth/guards";
import {
  ERROR_PARAM,
  EXPORT_MESSAGES,
  FAILED_ERROR,
  FROM_PARAM,
  TO_PARAM,
  defaultExportRange,
  validateExportRange,
} from "@/lib/export/range";

import { ExportForm } from "./export-form";

function stringParam(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * EXPORT-1 / EXPORT-4: the export screen. A date range (1 January of this year to today by
 * default) and one download per file: incomes and expenses (EXPORT-4: no receipt files). The
 * files are built by the Route Handlers under /export; when one sends the user back with the
 * submitted dates (an invalid range, or an export that failed before its first byte), the
 * errors show next to the fields.
 */
export default async function ExportPage({ searchParams }: PageProps<"/export">) {
  await requireAllowedUser();
  const params = await searchParams;
  const submittedFrom = stringParam(params[FROM_PARAM]);
  const submittedTo = stringParam(params[TO_PARAM]);
  const submitted = submittedFrom !== undefined || submittedTo !== undefined;
  const defaults = defaultExportRange();
  const values = submitted ? { from: submittedFrom ?? "", to: submittedTo ?? "" } : defaults;
  const validation = submitted ? validateExportRange(values.from, values.to) : null;
  const failed = params[ERROR_PARAM] === FAILED_ERROR;

  return (
    <section className="space-y-5">
      <h1 className="text-2xl font-semibold">ייצוא</h1>
      <p className="text-muted-foreground max-w-prose text-sm">
        ייצוא ההכנסות או ההוצאות של טווח תאריכים לקובץ CSV שנפתח ב-Excel, קובץ נפרד לכל אחד. הכנסות
        והוצאות שנמחקו אינן נכללות. קובצי הקבלות עצמם אינם מיוצאים.
      </p>
      <ExportForm
        // Another address (the server sent the user back) starts the form afresh.
        key={`${values.from}|${values.to}|${failed}`}
        initialValues={values}
        initialErrors={validation && !validation.ok ? validation.errors : {}}
        initialFormError={failed ? EXPORT_MESSAGES.failed : null}
      />
    </section>
  );
}
