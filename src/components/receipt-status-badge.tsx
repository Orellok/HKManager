import { RECEIPT_STATUS_LABELS, type ReceiptStatus } from "@/lib/documents/status";
import { cn } from "@/lib/utils";

/**
 * INC-3: an income's receipt status as text in a pill. A waiting receipt also has a heavier
 * border, so the two are told apart by more than color.
 */
export function ReceiptStatusBadge({
  status,
  className,
}: {
  status: ReceiptStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-3 py-0.5 text-sm",
        status === "receipt_pending" ? "bg-background border-2 border-current" : "bg-muted border",
        className,
      )}
    >
      {RECEIPT_STATUS_LABELS[status]}
    </span>
  );
}
