import Link from "next/link";
import { notFound } from "next/navigation";

import { buttonClasses } from "@/components/button";
import { ReceiptStatusBadge } from "@/components/receipt-status-badge";
import { requireAllowedUser } from "@/lib/auth/guards";
import { formatIsoDate, todayInJerusalem } from "@/lib/dates";
import { receiptPath } from "@/lib/documents/paths";
import { getIncomeWithReceipt, type IncomeWithReceipt } from "@/lib/documents/queries";
import { updateIncomeAction } from "@/lib/incomes/actions";
import { INCOME_LOCKED_MESSAGE } from "@/lib/incomes/locked";
import { FROM_PARAM, returnPath, returnTargetFrom } from "@/lib/incomes/paths";
import { getIncome } from "@/lib/incomes/queries";
import { incomeIdSchema, type IncomeFormValues } from "@/lib/incomes/schema";
import { agorotToShekelInput, formatAgorot } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { loadFormClients } from "../../../projects/load-form-clients";
import { IncomeDelete } from "../../income-delete";
import { IncomeForm } from "../../income-form";
import { loadIncomeChoices, loadOrNotFound } from "../../load-income-form";

/**
 * INC-1: edit an income, or soft-delete it (SPEC 6), while it waits for a receipt (INC-3),
 * with "הפק קבלה" (DOC-1). INC-4: once a receipt is recorded, the income is shown read-only
 * with the reason, and neither the form nor delete is offered (the database refuses both).
 */
export default async function EditIncomePage({
  params,
  searchParams,
}: PageProps<"/incomes/[id]/edit">) {
  await requireAllowedUser();
  const id = incomeIdSchema.safeParse((await params).id);
  if (!id.success) {
    notFound();
  }
  const from = returnTargetFrom((await searchParams)[FROM_PARAM]);
  const withReceipt = await loadOrNotFound("read receipt", async () =>
    getIncomeWithReceipt(await createSupabaseServerClient(), id.data),
  );
  const cancelHref = returnPath(from, withReceipt.project_id);
  if (withReceipt.document) {
    return <LockedIncome income={withReceipt} backHref={cancelHref} />;
  }

  const income = await loadOrNotFound("read", async () =>
    getIncome(await createSupabaseServerClient(), id.data),
  );
  const [{ options, hasMore }, choices] = await Promise.all([
    loadFormClients(income.client_id),
    loadIncomeChoices(income.client_id, {
      projectId: income.project_id,
      milestoneId: income.milestone_id,
    }),
  ]);
  const initialValues: IncomeFormValues = {
    client_id: income.client_id,
    project_id: income.project_id ?? "",
    milestone_id: income.milestone_id ?? "",
    received_date: income.received_date,
    amount: agorotToShekelInput(income.amount),
    payment_method: income.payment_method,
    notes: income.notes ?? "",
  };

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">עריכת הכנסה</h1>
      <div className="flex flex-wrap items-center gap-3">
        <ReceiptStatusBadge status="receipt_pending" />
        <Link href={receiptPath(income.id)} className={buttonClasses("secondary")}>
          הפק קבלה
        </Link>
      </div>
      <IncomeForm
        action={updateIncomeAction.bind(null, income.id, from)}
        initialValues={initialValues}
        clientOptions={options}
        moreClientsExist={hasMore}
        initialChoices={choices}
        today={todayInJerusalem()}
        fillAmountFromMilestone={false}
        submitLabel="שמירת שינויים"
        cancelHref={cancelHref}
      />
      <div className="max-w-xl border-t pt-6">
        <IncomeDelete incomeId={income.id} from={from} />
      </div>
    </section>
  );
}

/** INC-4: an income with a receipt, read-only, with the way to its receipt. */
function LockedIncome({ income, backHref }: { income: IncomeWithReceipt; backHref: string }) {
  const { transaction } = income;
  const rows = [
    { label: "לקוח", value: transaction.clientName },
    { label: "תיאור", value: transaction.description },
    { label: "תאריך קבלת התשלום", value: formatIsoDate(transaction.receivedDate) },
    { label: "סכום", value: formatAgorot(transaction.amount) },
    { label: "אמצעי תשלום", value: transaction.paymentMethod },
  ];
  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">פרטי הכנסה</h1>
      <ReceiptStatusBadge status="receipt_issued" />
      <p className="bg-muted max-w-xl rounded-md border-2 border-current p-3 text-sm">
        <strong>ההכנסה נעולה לעריכה:</strong> {INCOME_LOCKED_MESSAGE}
      </p>
      <dl className="max-w-xl divide-y rounded-lg border">
        {rows.map(({ label, value }) => (
          <div key={label} className="grid gap-1 p-4 sm:grid-cols-[10rem_1fr]">
            <dt className="text-muted-foreground text-sm">{label}</dt>
            <dd className="whitespace-pre-wrap wrap-anywhere">
              {value ?? <span className="text-muted-foreground">לא הוזן</span>}
            </dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-3">
        <Link href={receiptPath(income.id)} className={buttonClasses("primary")}>
          לפרטי הקבלה
        </Link>
        <Link href={backHref} className={buttonClasses("secondary")}>
          חזרה
        </Link>
      </div>
    </section>
  );
}
