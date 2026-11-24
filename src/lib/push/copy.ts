import type { PushDeviceState } from "./browser";

/** M7.2-7 / 8: the Hebrew copy of the settings screen's push section (lead decision). */

export const PUSH_SECTION_HEADING = "התראות במכשיר זה";
export const PUSH_SECTION_INTRO =
  "תזכורת יומית ב-09:00 על משימות להיום, למחר ובאיחור. כל מכשיר מפעיל ומכבה את ההתראות בנפרד.";

export const PUSH_CHECKING_TEXT = "בודקים את מצב ההתראות במכשיר…";

/** NOTIF-13: the four states the spec names; "not configured" shows as unsupported. */
export const PUSH_STATE_LABELS: Record<PushDeviceState, string> = {
  active: "פעיל",
  off: "כבוי",
  blocked: "חסום בדפדפן",
  unsupported: "לא נתמך",
  not_configured: "לא נתמך",
};

export const PUSH_STATE_GUIDANCE: Record<PushDeviceState, string> = {
  active: "המכשיר הזה יקבל את התזכורת היומית ב-09:00.",
  off: "ההתראות כבויות במכשיר הזה.",
  blocked:
    "ההתראות חסומות בדפדפן. כדי לאפשר אותן: בתפריט של Chrome (⋮) ← הגדרות ← הגדרות אתרים ← התראות, לאפשר את האתר הזה ולרענן את הדף.",
  unsupported: "הדפדפן הזה לא תומך בהתראות. ההתראות נתמכות ב-Chrome באנדרואיד ובמחשב.",
  not_configured: "שליחת התראות עדיין לא הוגדרה בסביבה הזו.",
};

export const PUSH_BUTTONS = {
  enable: "הפעל התראות במכשיר זה",
  disable: "כבה התראות במכשיר זה",
  test: "שלח התראת בדיקה",
  install: "התקנת האפליקציה",
} as const;

export const PUSH_MESSAGES = {
  enabled: "ההתראות הופעלו במכשיר הזה.",
  disabled: "ההתראות כובו במכשיר הזה.",
  dismissed: "לא ניתנה הרשאה להתראות. אפשר לנסות שוב.",
  blocked: "הדפדפן חסם את ההתראות במכשיר הזה.",
  enableFailed: "הפעלת ההתראות נכשלה. אפשר לנסות שוב.",
  limit: "יש יותר מדי מכשירים עם התראות. אפשר לכבות התראות במכשיר אחר ולנסות שוב.",
  disableFailed: "כיבוי ההתראות נכשל. אפשר לנסות שוב.",
  testSent: "התראת הבדיקה נשלחה. היא אמורה להופיע תוך דקה.",
  testNotRegistered: "המכשיר הזה כבר לא רשום לקבלת התראות. אפשר להפעיל אותן מחדש.",
  testNotConfigured: "שליחת התראות עדיין לא הוגדרה בשרת.",
  testFailed: "שליחת התראת הבדיקה נכשלה. אפשר לנסות שוב.",
} as const;

export const INSTALL_HEADING = "התקנת האפליקציה";
export const INSTALL_TEXT =
  "אפשר להתקין את HKManager במסך הבית ולפתוח אותה כמו אפליקציה. ההתקנה לא נדרשת כדי לקבל התראות.";
export const INSTALL_MANUAL_TEXT =
  'ב-Chrome: בתפריט (⋮) לבחור "התקנת אפליקציה" או "הוספה למסך הבית".';
