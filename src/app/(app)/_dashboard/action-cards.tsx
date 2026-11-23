import Link from "next/link";
import type { ReactNode } from "react";

import { buttonClasses } from "@/components/button";
import { QuotaNotice } from "@/components/quota-notice";
import type { DashboardData } from "@/lib/dashboard/queries";
import { DEBTS_PATH } from "@/lib/debts/paths";
import { MISSING_DOCUMENT_EXPENSES_PATH } from "@/lib/expenses/paths";
import { PENDING_RECEIPTS_PATH } from "@/lib/incomes/paths";
import { formatAgorot } from "@/lib/money";

function debtsText(count: number, total: number): string {
  if (count === 0) {
    return "אין חובות פתוחים.";
  }
  const amount = formatAgorot(total);
  return count === 1 ? `חוב פתוח אחד בסך ${amount}.` : `${count} חובות פתוחים בסך ${amount}.`;
}

function pendingText(count: number): string {
  if (count === 0) {
    return "אין הכנסות שממתינות לקבלה.";
  }
  return count === 1 ? "הכנסה אחת ממתינה לקבלה." : `${count} הכנסות ממתינות לקבלה.`;
}

function missingText(count: number): string {
  if (count === 0) {
    return "לכל ההוצאות של החודש יש מסמך.";
  }
  return count === 1 ? "הוצאה אחת החודש בלי מסמך." : `${count} הוצאות החודש בלי מסמך.`;
}

function ActionCard({
  id,
  title,
  count,
  text,
  children,
}: {
  id: string;
  title: string;
  count: number;
  text: string;
  children?: ReactNode;
}) {
  const headingId = `${id}-heading`;
  return (
    <section aria-labelledby={headingId} className="space-y-3 rounded-lg border p-4">
      <h3 id={headingId} className="text-lg font-semibold">
        {title}
      </h3>
      <p>
        <span aria-hidden="true" className="block text-3xl font-semibold">
          {count}
        </span>
        <span className="text-sm">{text}</span>
      </p>
      {children}
    </section>
  );
}

/**
 * DASH-5: what needs attention now: open debts (MS-6), incomes waiting for a receipt with the
 * monthly receipts counter (DOC-4/5, the card from M2.2), and this month's expenses without a
 * document (EXP-6), each with a link to its list, and the tasks (overdue / today / tomorrow,
 * NOTIF-2). Today's events come with M5; no placeholder is shown until then.
 */
export function ActionCards({
  cards,
  monthlyQuota,
  tasks,
}: {
  cards: DashboardData["cards"];
  monthlyQuota: number;
  tasks: ReactNode;
}) {
  return (
    <section aria-labelledby="action-cards-heading" className="space-y-3">
      <h2 id="action-cards-heading" className="text-xl font-semibold">
        לטיפול
      </h2>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {tasks}
        <ActionCard
          id="open-debts"
          title="חובות פתוחים"
          count={cards.openDebtsCount}
          text={debtsText(cards.openDebtsCount, cards.openDebtsTotal)}
        >
          {cards.openDebtsCount > 0 ? (
            <Link href={DEBTS_PATH} className={buttonClasses("primary")}>
              לרשימת החובות הפתוחים
            </Link>
          ) : null}
        </ActionCard>
        <ActionCard
          id="pending-receipts"
          title="קבלות ממתינות"
          count={cards.pendingReceipts}
          text={pendingText(cards.pendingReceipts)}
        >
          {cards.pendingReceipts > 0 ? (
            <Link href={PENDING_RECEIPTS_PATH} className={buttonClasses("primary")}>
              להכנסות שממתינות לקבלה
            </Link>
          ) : null}
          <QuotaNotice issued={cards.receiptsIssuedThisMonth} quota={monthlyQuota} />
        </ActionCard>
        <ActionCard
          id="missing-documents"
          title="הוצאות ללא מסמך"
          count={cards.missingDocuments}
          text={missingText(cards.missingDocuments)}
        >
          {cards.missingDocuments > 0 ? (
            <Link href={MISSING_DOCUMENT_EXPENSES_PATH} className={buttonClasses("primary")}>
              להוצאות החודש שחסר להן מסמך
            </Link>
          ) : null}
        </ActionCard>
      </div>
    </section>
  );
}
