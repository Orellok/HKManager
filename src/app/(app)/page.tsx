import Link from "next/link";

import { buttonClasses } from "@/components/button";
import { QuotaNotice } from "@/components/quota-notice";
import { getReceiptSettings, type ReceiptSettings } from "@/lib/app-settings";
import { requireAllowedUser } from "@/lib/auth/guards";
import { getReceiptsSummary, type ReceiptsSummary } from "@/lib/documents/queries";
import { PENDING_RECEIPTS_PATH } from "@/lib/incomes/paths";
import { logDbFailure } from "@/lib/log";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const PENDING_HEADING_ID = "pending-receipts-heading";

function pendingText(count: number): string {
  if (count === 0) {
    return "אין הכנסות שממתינות לקבלה.";
  }
  return count === 1 ? "הכנסה אחת ממתינה לקבלה." : `${count} הכנסות ממתינות לקבלה.`;
}

export default async function HomePage() {
  // AUTH-3: every page checks the session itself (see the (app) layout).
  await requireAllowedUser();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">דף הבית</h1>
      <PendingReceiptsCard />
    </div>
  );
}

/**
 * DOC-5 / owner decision (M2.2): the incomes waiting for a receipt, counted from the day the
 * payment was received, with a link to their list, and the monthly receipts counter (DOC-4).
 * A failure to load is shown inside the card; the rest of the home page stays usable.
 */
async function PendingReceiptsCard() {
  let summary: ReceiptsSummary;
  let settings: ReceiptSettings;
  try {
    const supabase = await createSupabaseServerClient();
    [summary, settings] = await Promise.all([
      getReceiptsSummary(supabase),
      getReceiptSettings(supabase),
    ]);
  } catch (error) {
    logDbFailure("home", "read receipts summary", error);
    return (
      <section aria-labelledby={PENDING_HEADING_ID} className="space-y-2 rounded-lg border p-4">
        <h2 id={PENDING_HEADING_ID} className="text-xl font-semibold">
          קבלות ממתינות
        </h2>
        <p className="text-destructive text-sm font-medium">
          לא הצלחנו לטעון את נתוני הקבלות. אפשר לרענן את הדף ולנסות שוב.
        </p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby={PENDING_HEADING_ID}
      className="max-w-xl space-y-3 rounded-lg border p-4"
    >
      <h2 id={PENDING_HEADING_ID} className="text-xl font-semibold">
        קבלות ממתינות
      </h2>
      <p>
        <span aria-hidden="true" className="block text-3xl font-semibold">
          {summary.pendingCount}
        </span>
        <span className="text-sm">{pendingText(summary.pendingCount)}</span>
      </p>
      {summary.pendingCount > 0 ? (
        <Link href={PENDING_RECEIPTS_PATH} className={buttonClasses("primary")}>
          להכנסות שממתינות לקבלה
        </Link>
      ) : null}
      <QuotaNotice issued={summary.issuedThisMonth} quota={settings.monthlyQuota} />
    </section>
  );
}
