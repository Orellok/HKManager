import { requireAllowedUser } from "@/lib/auth/guards";
import { todayInJerusalem } from "@/lib/dates";
import {
  getOpenDebtsSummary,
  listOpenDebts,
  type OpenDebtsPage,
  type OpenDebtsSummary,
} from "@/lib/debts/queries";
import { logDbFailure } from "@/lib/log";
import { formatAgorot } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { DebtsBrowser } from "./debts-browser";

function countText(count: number): string {
  return count === 1 ? "אבן דרך אחת" : `${count} אבני דרך`;
}

/**
 * MS-6: open debts: milestones that are not cancelled, have a balance and whose due date has
 * passed (Asia/Jerusalem), oldest first, with the total. Owner decision (M1.3): projects of
 * every status, archived ones included, so nothing disappears from the list silently.
 */
export default async function DebtsPage() {
  await requireAllowedUser();
  const today = todayInJerusalem();
  let initialPage: OpenDebtsPage;
  let summary: OpenDebtsSummary;
  try {
    const supabase = await createSupabaseServerClient();
    [initialPage, summary] = await Promise.all([
      listOpenDebts(supabase, today, 0),
      getOpenDebtsSummary(supabase, today),
    ]);
  } catch (error) {
    // Logged by code only; the error boundary gets no database details (SPEC 8).
    logDbFailure("debts", "list", error);
    throw new Error("Could not load open debts");
  }

  return (
    <section className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">חובות פתוחים</h1>
        <p className="text-muted-foreground text-sm">
          אבני דרך שמועד התשלום שלהן עבר ויש בהן יתרה, מהוותיקה לחדשה. כולל פרויקטים בכל סטטוס
          ובארכיון. אבני דרך שבוטלו אינן נכללות.
        </p>
      </div>

      {summary.count > 0 ? (
        <dl className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground text-sm">סה״כ יתרות פתוחות</dt>
            <dd className="text-xl font-semibold">{formatAgorot(summary.total)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-sm">אבני דרך באיחור</dt>
            <dd className="text-xl font-semibold">{countText(summary.count)}</dd>
          </div>
        </dl>
      ) : null}

      <DebtsBrowser today={today} initialPage={initialPage} />
    </section>
  );
}
