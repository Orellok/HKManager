/** Routes of the yearly ceilings screens (CEIL-1, admin only). Only years go into a URL. */

import { SETTINGS_PATH } from "@/lib/expense-categories/paths";

export const NEW_CEILING_PATH = `${SETTINGS_PATH}/ceilings/new`;

/** The add form, with the year filled in (CEIL-6: "set the ceiling for 2027"). */
export function newCeilingPathForYear(year: number): string {
  return `${NEW_CEILING_PATH}?year=${encodeURIComponent(String(year))}`;
}

export function editCeilingPath(year: number): string {
  return `${SETTINGS_PATH}/ceilings/${encodeURIComponent(String(year))}/edit`;
}

/** The id of the ceilings section's heading on the settings screen. */
export const CEILINGS_HEADING_ID = "tax-year-ceilings-heading";
