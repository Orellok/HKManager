import { quotaCounterText, quotaWarning } from "@/lib/documents/quota";

/**
 * DOC-4: receipts issued this month against the monthly quota, with a warning from 80% and
 * when the quota is reached or exceeded. A warning only: recording stays possible. Marked
 * with text ("שימו לב") and a heavier border, not color alone.
 */
export function QuotaNotice({ issued, quota }: { issued: number; quota: number }) {
  const warning = quotaWarning(issued, quota);
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{quotaCounterText(issued, quota)}</p>
      {warning ? (
        <p className="bg-muted rounded-md border-2 border-current p-3 text-sm">
          <strong>שימו לב:</strong> {warning}
        </p>
      ) : null}
    </div>
  );
}
