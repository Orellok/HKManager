/**
 * DOC-4: receipts issued this month against the provider's monthly quota. A warning at 80%
 * of the quota and when it is reached or exceeded; it never blocks recording a receipt.
 */

/** The share of the quota (percent) from which the warning shows. */
export const QUOTA_WARNING_PERCENT = 80;

export type QuotaLevel = "ok" | "near" | "reached" | "over";

/** The quota level of `issued` receipts against a quota of at least 1. */
export function quotaLevel(issued: number, quota: number): QuotaLevel {
  if (!Number.isInteger(issued) || issued < 0 || !Number.isInteger(quota) || quota < 1) {
    throw new RangeError("Expected a non-negative count and a quota of at least 1");
  }
  if (issued > quota) {
    return "over";
  }
  if (issued === quota) {
    return "reached";
  }
  // Integer arithmetic: issued / quota >= 80%.
  return issued * 100 >= quota * QUOTA_WARNING_PERCENT ? "near" : "ok";
}

/** "קבלות שהופקו החודש: 8 מתוך 10". */
export function quotaCounterText(issued: number, quota: number): string {
  return `קבלות שהופקו החודש: ${issued} מתוך ${quota}`;
}

/** The warning for a level, or null when there is nothing to warn about. */
export function quotaWarning(issued: number, quota: number): string | null {
  switch (quotaLevel(issued, quota)) {
    case "ok":
      return null;
    case "near":
      return `נוצלו ${Math.floor((issued * 100) / quota)}% מהמכסה החודשית של ספק הקבלות.`;
    case "reached":
      return "המכסה החודשית של ספק הקבלות נוצלה במלואה. אפשר להמשיך לתעד קבלות, וכדאי לבדוק את תנאי המסלול אצל הספק.";
    case "over": {
      const excess = issued - quota;
      const issuedText = excess === 1 ? "הופקה קבלה אחת" : `הופקו ${excess} קבלות`;
      return `החודש ${issuedText} מעבר למכסה החודשית של ספק הקבלות. אפשר להמשיך לתעד קבלות, וכדאי לבדוק את תנאי המסלול אצל הספק.`;
    }
  }
}
