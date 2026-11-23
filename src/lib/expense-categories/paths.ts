/** Routes of the settings screens. Only ids and fixed codes go into a URL (SPEC 8). */

/** SPEC 5.14: the settings screen; M3 holds the expense categories (EXP-3). */
export const SETTINGS_PATH = "/settings";
export const NEW_CATEGORY_PATH = `${SETTINGS_PATH}/categories/new`;

export function editCategoryPath(id: string): string {
  return `${SETTINGS_PATH}/categories/${encodeURIComponent(id)}/edit`;
}

/** Codes of the one-time confirmations on the settings screen. */
export type SettingsNotice =
  "category_created" | "category_renamed" | "ceiling_created" | "ceiling_updated";

export const SETTINGS_NOTICE_MESSAGES: Record<SettingsNotice, string> = {
  category_created: "הקטגוריה נוספה.",
  category_renamed: "שם הקטגוריה עודכן.",
  // CEIL-1 (admin only).
  ceiling_created: "התקרה נשמרה.",
  ceiling_updated: "התקרה עודכנה.",
};
