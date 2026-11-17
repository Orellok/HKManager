import Link from "next/link";

import { ReceiptStatusBadge } from "@/components/receipt-status-badge";
import { formatIsoDate } from "@/lib/dates";
import { receiptStatus } from "@/lib/documents/status";
import { PAYMENT_METHOD_LABELS } from "@/lib/incomes/payment-methods";
import type { IncomeListItem } from "@/lib/incomes/queries";
import { formatAgorot } from "@/lib/money";

/**
 * One income in a list (INC-1): client, project and milestone, received date, payment
 * method, amount and its receipt status (INC-3), as a link.
 */
export function IncomeListRow({ income, href }: { income: IncomeListItem; href: string }) {
  return (
    <Link
      href={href}
      className="hover:bg-accent flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2"
    >
      <span className="min-w-0 space-y-0.5">
        <span className="block font-medium wrap-anywhere">{income.client_name}</span>
        {income.project_name !== null ? (
          <span className="text-muted-foreground block text-sm wrap-anywhere">
            {income.project_name}
            {income.milestone_description !== null ? ` – ${income.milestone_description}` : null}
          </span>
        ) : (
          <span className="text-muted-foreground block text-sm">ללא פרויקט</span>
        )}
      </span>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span>{formatIsoDate(income.received_date)}</span>
        <span className="text-muted-foreground">
          {PAYMENT_METHOD_LABELS[income.payment_method]}
        </span>
        <span className="text-base font-semibold">{formatAgorot(income.amount)}</span>
        <ReceiptStatusBadge status={receiptStatus(income.receipt_issued)} />
      </span>
    </Link>
  );
}
