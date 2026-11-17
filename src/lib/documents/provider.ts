import type { ReceiptSettings } from "@/lib/app-settings";

/**
 * SPEC 5.6 / 9.1: receipts are issued by an external provider through a DocumentProvider.
 * The screens and the data model depend on this interface only, never on a concrete provider
 * or on the provider's identity (its name and link are settings).
 *
 * V1 has one implementation, ManualProvider: the user issues the receipt in the provider's
 * own system from the transaction details shown here, then records its number, date and
 * file or link. Stage 2 adds an ApiProvider (DOC-7..9) behind the same interface; switching
 * is a matter of keys and a feature flag, with no data migration (SPEC 9.1). It is designed
 * only (ApiDocumentProvider below) and must not be implemented in V1.
 */

/** The transaction a receipt is issued for, as shown to the user (DOC-1). */
export type ReceiptTransaction = {
  clientName: string;
  /** Agorot. */
  amount: number;
  /** The milestone and project, the project, or the income's notes; null when none. */
  description: string | null;
  /** ISO date the payment was received. */
  receivedDate: string;
  /** The payment method's label. */
  paymentMethod: string;
};

/** How the user gets a receipt issued in manual mode. */
export type ManualIssue = {
  /** The provider's name, e.g. "SUMIT". */
  providerName: string;
  /** Where the receipt is issued; opened in a new tab. */
  providerUrl: string;
  /** The details to copy into the provider's form. */
  transaction: ReceiptTransaction;
};

type DocumentProviderBase = {
  /** The provider documents are recorded with (documents.provider). */
  readonly providerName: string;
};

/** V1: the user issues the receipt at the provider and records it in the app (DOC-1, DOC-2). */
export type ManualDocumentProvider = DocumentProviderBase & {
  readonly mode: "manual";
  issue(transaction: ReceiptTransaction): ManualIssue;
};

/**
 * Stage 2, design only (DOC-7..9). Not implemented in V1.
 * - createReceipt() issues the receipt at the provider and returns its external id, number,
 *   issue date and PDF link, which are stored in documents (external_id, doc_number,
 *   issued_date, url) by the same insert as a manual receipt.
 * - Every request carries an idempotency key (DOC-8), e.g. the income id, so a retry never
 *   issues a second receipt.
 * - It runs on the server only; the API keys never reach the browser (DOC-9).
 */
export type ApiDocumentProvider = DocumentProviderBase & {
  readonly mode: "api";
  createReceipt(request: {
    incomeId: string;
    idempotencyKey: string;
    transaction: ReceiptTransaction;
  }): Promise<{ externalId: string; docNumber: string; issuedDate: string; url: string }>;
};

/** What the app uses. V1 configures manual mode only. */
export type DocumentProvider = ManualDocumentProvider;

/** The manual provider for the configured provider name and link. */
export class ManualProvider implements ManualDocumentProvider {
  readonly mode = "manual";
  readonly providerName: string;
  private readonly providerUrl: string;

  constructor(settings: Pick<ReceiptSettings, "providerName" | "providerUrl">) {
    this.providerName = settings.providerName;
    this.providerUrl = settings.providerUrl;
  }

  issue(transaction: ReceiptTransaction): ManualIssue {
    return { providerName: this.providerName, providerUrl: this.providerUrl, transaction };
  }
}

/** The DocumentProvider for the current settings (V1: always manual). */
export function documentProviderFor(settings: ReceiptSettings): DocumentProvider {
  return new ManualProvider(settings);
}
