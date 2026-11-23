"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { ActionStatus } from "@/lib/action-status";
import { requireAdmin, requireAllowedUser } from "@/lib/auth/guards";
import { isYear } from "@/lib/dashboard/period";
import { SETTINGS_PATH, type SettingsNotice } from "@/lib/expense-categories/paths";
import type { ServerFormState } from "@/lib/forms";
import { logDbFailure } from "@/lib/log";
import { withNotice } from "@/lib/notices";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { z } from "@/lib/zod";

import { CEILINGS_HEADING_ID } from "./paths";
import {
  acknowledgeCeilingAlert,
  createTaxYearCeiling,
  updateTaxYearCeiling,
  type SaveCeilingResult,
} from "./queries";
import {
  CEILING_FIELD_MESSAGES,
  readCeilingFormValues,
  validateCeilingInput,
  type CeilingField,
} from "./schema";
import { isCeilingThreshold } from "./status";

/**
 * Server Actions of the exempt-dealer ceiling. Saving a yearly ceiling is admin only
 * (CEIL-1, AUTH-5): requireAdmin() runs before anything else, so an owner gets the 404
 * screen. Acknowledging a banner (CEIL-4) is for both allowlisted users.
 */

export type CeilingFormState = ServerFormState<CeilingField>;

const MESSAGES = {
  saveFailed: "השמירה נכשלה. התקרה לא נשמרה, אפשר לנסות שוב.",
  notFound: "לא נמצאה תקרה לשנה הזו. אפשר להוסיף אותה מרשימת התקרות.",
  ackFailed: "אישור ההתראה נכשל. אפשר לנסות שוב.",
  acked: "ההתראה אושרה ולא תוצג שוב השנה.",
} as const;

/** The ceiling shows on the dashboard (CEIL-3) and in the settings. */
function revalidateCeilingScreens() {
  revalidatePath("/");
  revalidatePath(SETTINGS_PATH, "layout");
}

async function saveCeiling(
  fixedYear: number | null,
  formData: FormData,
): Promise<CeilingFormState> {
  const submitted = readCeilingFormValues(formData);
  // The edit form's year is part of the address, never taken from the form.
  const values = fixedYear === null ? submitted : { ...submitted, year: String(fixedYear) };
  const validation = validateCeilingInput(values);
  if (!validation.success) {
    return { values, fieldErrors: validation.fieldErrors, formError: null };
  }
  const input = { year: validation.data.year, ceiling: validation.data.exempt_ceiling };
  let result: SaveCeilingResult;
  try {
    const supabase = await createSupabaseServerClient();
    result =
      fixedYear === null
        ? await createTaxYearCeiling(supabase, input)
        : await updateTaxYearCeiling(supabase, input);
  } catch (error) {
    logDbFailure("tax_year_settings", fixedYear === null ? "create" : "update", error);
    return { values, fieldErrors: {}, formError: MESSAGES.saveFailed };
  }
  if (result.status === "year_taken") {
    return { values, fieldErrors: { year: CEILING_FIELD_MESSAGES.yearTaken }, formError: null };
  }
  if (result.status === "not_found") {
    return { values, fieldErrors: {}, formError: MESSAGES.notFound };
  }
  revalidateCeilingScreens();
  const notice: SettingsNotice = fixedYear === null ? "ceiling_created" : "ceiling_updated";
  redirect(`${withNotice(SETTINGS_PATH, notice)}#${CEILINGS_HEADING_ID}`);
}

/** CEIL-1: adds the ceiling of a year (admin only). */
export async function createCeilingAction(
  _previous: CeilingFormState,
  formData: FormData,
): Promise<CeilingFormState> {
  await requireAdmin();
  return saveCeiling(null, formData);
}

/** CEIL-1: changes the ceiling of a year (admin only). */
export async function updateCeilingAction(
  year: number,
  _previous: CeilingFormState,
  formData: FormData,
): Promise<CeilingFormState> {
  await requireAdmin();
  if (!isYear(year)) {
    return {
      values: readCeilingFormValues(formData),
      fieldErrors: {},
      formError: MESSAGES.notFound,
    };
  }
  return saveCeiling(year, formData);
}

const ackInputSchema = z.object({
  year: z.number().refine(isYear),
  threshold: z.number().refine(isCeilingThreshold),
});

/** CEIL-4: acknowledges the banner of a threshold for the year, for both users. */
export async function acknowledgeCeilingAlertAction(
  year: number,
  threshold: number,
): Promise<ActionStatus> {
  await requireAllowedUser();
  const parsed = ackInputSchema.safeParse({ year, threshold });
  if (!parsed.success || !isCeilingThreshold(parsed.data.threshold)) {
    return { message: null, error: MESSAGES.ackFailed };
  }
  try {
    await acknowledgeCeilingAlert(
      await createSupabaseServerClient(),
      parsed.data.year,
      parsed.data.threshold,
    );
  } catch (error) {
    logDbFailure("ceiling_alert_acks", "insert", error);
    return { message: null, error: MESSAGES.ackFailed };
  }
  revalidatePath("/");
  return { message: MESSAGES.acked, error: null };
}
