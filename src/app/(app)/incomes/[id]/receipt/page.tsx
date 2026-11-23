import Link from "next/link";
import { notFound } from "next/navigation";

import { buttonClasses } from "@/components/button";
import { CopyableDetails, type CopyableDetail } from "@/components/copyable-details";
import { QuotaNotice } from "@/components/quota-notice";
import { ReceiptStatusBadge } from "@/components/receipt-status-badge";
import { RedirectNotice } from "@/components/redirect-notice";
import { getReceiptSettings, type ReceiptSettings } from "@/lib/app-settings";
import { requireAllowedUser } from "@/lib/auth/guards";
import { formatIsoDate, todayInJerusalem } from "@/lib/dates";
import { recordReceiptAction, updateReceiptAction } from "@/lib/documents/actions";
import { RECEIPT_NOTICE_MESSAGES, receiptFilePath } from "@/lib/documents/paths";
import { documentProviderFor, type ReceiptTransaction } from "@/lib/documents/provider";
import {
  getIncomeWithReceipt,
  getReceiptsSummary,
  type IncomeReceiptDocument,
  type IncomeWithReceipt,
  type ReceiptsSummary,
} from "@/lib/documents/queries";
import type { ReceiptFormValues } from "@/lib/documents/schema";
import { receiptStatus } from "@/lib/documents/status";
import { PENDING_RECEIPTS_PATH, editIncomePath } from "@/lib/incomes/paths";
import { incomeIdSchema } from "@/lib/incomes/schema";
import { logDbFailure } from "@/lib/log";
import { agorotToShekelInput, formatAgorot } from "@/lib/money";
import { NOTICE_PARAM, noticeMessage } from "@/lib/notices";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { ReceiptForm } from "./receipt-form";

const LINK_CLASSES =
  "text-muted-foreground hover:text-foreground inline-flex min-h-11 items-center text-sm underline underline-offset-4";
const VALUE_LINK_CLASSES = "inline-flex min-h-11 items-center underline underline-offset-4";

/** DOC-1: the transaction details, each with the value a copy button copies. */
function transactionDetails(transaction: ReceiptTransaction): CopyableDetail[] {
  const receivedDate = formatIsoDate(transaction.receivedDate);
  return [
    { label: "שם הלקוח", display: transaction.clientName, copyValue: transaction.clientName },
    {
      label: "סכום",
      display: formatAgorot(transaction.amount),
      // Digits only, as the provider's amount field expects them.
      copyValue: agorotToShekelInput(transaction.amount),
    },
    {
      label: "תיאור",
      display: transaction.description ?? "אין תיאור (אין פרויקט או הערות)",
      copyValue: transaction.description,
    },
    { label: "תאריך קבלת התשלום", display: receivedDate, copyValue: receivedDate },
    {
      label: "אמצעי תשלום",
      display: transaction.paymentMethod,
      copyValue: transaction.paymentMethod,
    },
  ];
}

function formValuesOf(document: IncomeReceiptDocument | null, today: string): ReceiptFormValues {
  if (!document) {
    return { doc_number: "", issued_date: today, source: "file", file: "", url: "" };
  }
  return {
    doc_number: document.doc_number,
    issued_date: document.issued_date,
    source: document.url !== null ? "link" : "file",
    file: "",
    url: document.url ?? "",
  };
}

/**
 * DOC-1 / DOC-2 / DOC-4 and the owner decisions: the receipt of one income. Waiting for a
 * receipt: the monthly counter, the transaction details with copy buttons, a link to the
 * provider and the form that records the receipt. With a receipt: its details, the file or
 * link, and the form that changes them (audited; a receipt is never deleted).
 */
export default async function ReceiptPage({
  params,
  searchParams,
}: PageProps<"/incomes/[id]/receipt">) {
  await requireAllowedUser();
  const id = incomeIdSchema.safeParse((await params).id);
  if (!id.success) {
    notFound();
  }
  const notice = noticeMessage(RECEIPT_NOTICE_MESSAGES, (await searchParams)[NOTICE_PARAM]);
  let income: IncomeWithReceipt | null;
  let settings: ReceiptSettings;
  let summary: ReceiptsSummary;
  try {
    const supabase = await createSupabaseServerClient();
    [income, settings, summary] = await Promise.all([
      getIncomeWithReceipt(supabase, id.data),
      getReceiptSettings(supabase),
      getReceiptsSummary(supabase),
    ]);
  } catch (error) {
    // Logged by code only; the error boundary gets no database details (SPEC 8).
    logDbFailure("documents", "read receipt page", error);
    throw new Error("Could not load the receipt page");
  }
  if (!income) {
    notFound();
  }
  const issue = documentProviderFor(settings).issue(income.transaction);
  const { document } = income;
  const today = todayInJerusalem();

  return (
    <article className="space-y-6">
      <nav aria-label="ניווט משני" className="flex flex-wrap gap-x-6">
        <Link href={editIncomePath(income.id)} className={LINK_CLASSES}>
          חזרה להכנסה
        </Link>
        <Link href={PENDING_RECEIPTS_PATH} className={LINK_CLASSES}>
          לכל ההכנסות שממתינות לקבלה
        </Link>
      </nav>

      <RedirectNotice message={notice} />

      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{document ? "קבלה להכנסה" : "הפקת קבלה"}</h1>
        <ReceiptStatusBadge status={receiptStatus(document !== null)} />
      </header>

      {document ? (
        <>
          <ReceiptDetails incomeId={income.id} document={document} />
          <section aria-labelledby="receipt-transaction-heading" className="space-y-3">
            <h2 id="receipt-transaction-heading" className="text-xl font-semibold">
              פרטי העסקה
            </h2>
            <CopyableDetails details={transactionDetails(issue.transaction)} />
          </section>
          <section aria-labelledby="receipt-edit-heading" className="space-y-3">
            <h2 id="receipt-edit-heading" className="text-xl font-semibold">
              עדכון פרטי הקבלה
            </h2>
            <p className="text-muted-foreground text-sm">
              תיקון נעשה קודם במערכת {issue.providerName}. אחר כך אפשר לעדכן כאן את המספר, התאריך,
              הקובץ או הקישור. כל שינוי נרשם ביומן השינויים, ואי אפשר למחוק קבלה.
            </p>
            <ReceiptForm
              action={updateReceiptAction.bind(null, income.id)}
              incomeId={income.id}
              initialValues={formValuesOf(document, today)}
              hasStoredFile={document.file_path !== null}
              today={today}
              submitLabel="שמירת פרטי הקבלה"
              cancelHref={editIncomePath(income.id)}
            />
          </section>
        </>
      ) : (
        <>
          <QuotaNotice issued={summary.issuedThisMonth} quota={settings.monthlyQuota} />
          <section aria-labelledby="receipt-transaction-heading" className="space-y-3">
            <h2 id="receipt-transaction-heading" className="text-xl font-semibold">
              פרטי העסקה
            </h2>
            <p className="text-muted-foreground text-sm">
              מעתיקים כל פרט ומדביקים אותו בטופס הקבלה במערכת {issue.providerName}.
            </p>
            <CopyableDetails details={transactionDetails(issue.transaction)} />
            <a
              href={issue.providerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClasses("primary")}
            >
              פתיחת {issue.providerName}
              <span className="sr-only"> (נפתח בכרטיסייה חדשה)</span>
            </a>
          </section>
          <section aria-labelledby="receipt-record-heading" className="space-y-3">
            <h2 id="receipt-record-heading" className="text-xl font-semibold">
              רישום הקבלה
            </h2>
            <p className="text-muted-foreground text-sm">
              אחרי שהקבלה הופקה ב-{issue.providerName}, מזינים כאן את המספר והתאריך שלה ומצרפים את
              קובץ ה-PDF או קישור אליה.
            </p>
            <ReceiptForm
              action={recordReceiptAction.bind(null, income.id)}
              incomeId={income.id}
              initialValues={formValuesOf(null, today)}
              hasStoredFile={false}
              today={today}
              submitLabel="שמירת הקבלה"
              cancelHref={editIncomePath(income.id)}
            />
          </section>
        </>
      )}
    </article>
  );
}

function ReceiptDetails({
  incomeId,
  document,
}: {
  incomeId: string;
  document: IncomeReceiptDocument;
}) {
  const rows = [
    { label: "מספר קבלה", value: <span dir="ltr">{document.doc_number}</span> },
    { label: "תאריך הפקה", value: formatIsoDate(document.issued_date) },
    { label: "ספק הקבלות", value: document.provider },
    {
      label: "הקבלה",
      value:
        document.file_path !== null ? (
          // A Route Handler that redirects to a short-lived signed URL: a plain link, so it is
          // never prefetched.
          <a
            href={receiptFilePath(incomeId)}
            target="_blank"
            rel="noopener noreferrer"
            className={VALUE_LINK_CLASSES}
          >
            צפייה בקובץ הקבלה (PDF)
            <span className="sr-only"> (נפתח בכרטיסייה חדשה)</span>
          </a>
        ) : (
          <a
            href={document.url ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            className={VALUE_LINK_CLASSES}
          >
            פתיחת הקישור לקבלה
            <span className="sr-only"> (נפתח בכרטיסייה חדשה)</span>
          </a>
        ),
    },
  ];
  return (
    <dl className="divide-y rounded-lg border">
      {rows.map(({ label, value }) => (
        <div key={label} className="grid gap-1 p-4 sm:grid-cols-[8rem_1fr]">
          <dt className="text-muted-foreground text-sm">{label}</dt>
          <dd className="wrap-anywhere">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
