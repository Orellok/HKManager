import { cn } from "@/lib/utils";

/** EXP-6: the text of the mark of an expense without a file. */
export const MISSING_DOCUMENT_LABEL = "חסר מסמך";

/**
 * EXP-6: an expense without a receipt file, as text in a pill with a heavy border (the look
 * of a waiting receipt, INC-3), so it is told apart by more than color.
 */
export function MissingDocumentBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "bg-background inline-flex shrink-0 items-center rounded-full border-2 border-current px-3 py-0.5 text-sm",
        className,
      )}
    >
      {MISSING_DOCUMENT_LABEL}
    </span>
  );
}
