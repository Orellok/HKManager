"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { ActionStatus } from "@/lib/action-status";
import { requireAllowedUser } from "@/lib/auth/guards";
import { CLIENTS_PATH } from "@/lib/clients/paths";
import { todayInJerusalem } from "@/lib/dates";
import { DEBTS_PATH } from "@/lib/debts/paths";
import type { ServerFormState } from "@/lib/forms";
import { logDbFailure } from "@/lib/log";
import { withNotice } from "@/lib/notices";
import { PROJECTS_PATH, type ProjectNotice } from "@/lib/projects/paths";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { z } from "@/lib/zod";

import { isMonth } from "./month";
import {
  OVERPAYMENT_CONFIRM_FIELD,
  confirmedBalanceFor,
  overpaymentMessage,
  overpaymentToken,
  parseOverpaymentToken,
} from "./overpayment";
import {
  INCOMES_PATH,
  RETURN_TARGETS,
  returnPath,
  type IncomeNotice,
  type ReturnTarget,
} from "./paths";
import {
  getIncomesMonthSummary,
  listIncomeChoices,
  listIncomes,
  saveIncome,
  softDeleteIncome,
  type IncomeChoices,
  type IncomeListPage,
  type IncomeRefusal,
  type IncomesMonthSummary,
} from "./queries";
import {
  INCOME_FIELD_MESSAGES,
  incomeIdSchema,
  readIncomeFormValues,
  validateIncomeInput,
  type IncomeField,
  type IncomeFormValues,
} from "./schema";

/**
 * Server Actions for incomes (INC-1, INC-2, MS-4, MS-5). Each one checks the session with
 * requireAllowedUser() before anything else and validates its input on the server,
 * including ids and targets bound in the browser, which a caller can change.
 */

export type IncomeFormState = ServerFormState<IncomeField>;

const MESSAGES = {
  saveFailed: "השמירה נכשלה. הפרטים לא נשמרו, אפשר לנסות שוב.",
  notFound: "ההכנסה לא נמצאה. ייתכן שנמחקה.",
  referenceMissing: "הלקוח, הפרויקט או אבן הדרך לא נמצאו. ייתכן שנמחקו. יש לבחור שוב.",
  referencesMismatch:
    "הפרויקט או אבן הדרך כבר לא שייכים ללקוח שנבחר. ייתכן שהפרויקט הועבר ללקוח אחר. יש לבחור שוב.",
  milestoneCancelled: "אבן הדרך בוטלה, ולכן אי אפשר לרשום לה תשלום.",
  deleteFailed: "המחיקה נכשלה. אפשר לנסות שוב.",
} as const;

const returnTargetSchema = z.enum(RETURN_TARGETS);

/** Incomes appear on the incomes list, the project and client cards and in open debts. */
function revalidateIncomeScreens() {
  revalidatePath(INCOMES_PATH, "layout");
  revalidatePath(PROJECTS_PATH, "layout");
  revalidatePath(CLIENTS_PATH, "layout");
  revalidatePath(DEBTS_PATH);
}

function refusedState(values: IncomeFormValues, refusal: IncomeRefusal): IncomeFormState {
  switch (refusal) {
    case "milestone_cancelled":
      return {
        values,
        fieldErrors: { milestone_id: MESSAGES.milestoneCancelled },
        formError: null,
      };
    case "date_in_future":
      return {
        values,
        fieldErrors: { received_date: INCOME_FIELD_MESSAGES.receivedDateInFuture },
        formError: null,
      };
    case "references_mismatch":
      return { values, fieldErrors: {}, formError: MESSAGES.referencesMismatch };
    case "reference_missing":
      return { values, fieldErrors: {}, formError: MESSAGES.referenceMissing };
  }
}

function savedNotice(from: ReturnTarget, isNew: boolean): string {
  if (from === "project") {
    return (isNew ? "income_created" : "income_updated") satisfies ProjectNotice;
  }
  return (isNew ? "created" : "updated") satisfies IncomeNotice;
}

/**
 * Validates and saves (new when `incomeId` is null). MS-5: a payment above the milestone's
 * balance comes back with a confirmation; submitting it again with the confirm button's
 * token saves it if the balance and the amount are still those of the warning.
 */
async function saveIncomeForm(
  incomeId: string | null,
  fromParam: unknown,
  formData: FormData,
): Promise<IncomeFormState> {
  const values = readIncomeFormValues(formData);
  const from = returnTargetSchema.catch("incomes").parse(fromParam);
  const validation = validateIncomeInput(values, todayInJerusalem());
  if (!validation.success) {
    return { values, fieldErrors: validation.fieldErrors, formError: null };
  }
  const input = validation.data;
  const confirmedBalance = confirmedBalanceFor(
    parseOverpaymentToken(formData.get(OVERPAYMENT_CONFIRM_FIELD)),
    input.amount,
  );

  let result: Awaited<ReturnType<typeof saveIncome>>;
  try {
    result = await saveIncome(
      await createSupabaseServerClient(),
      incomeId,
      input,
      confirmedBalance,
    );
  } catch (error) {
    logDbFailure("incomes", incomeId === null ? "create" : "update", error);
    return { values, fieldErrors: {}, formError: MESSAGES.saveFailed };
  }
  switch (result.status) {
    case "needs_confirmation": {
      const warning = { balance: result.balance, amount: input.amount };
      return {
        values,
        fieldErrors: {},
        formError: null,
        confirmation: { message: overpaymentMessage(warning), token: overpaymentToken(warning) },
      };
    }
    case "not_found":
      return { values, fieldErrors: {}, formError: MESSAGES.notFound };
    case "refused":
      return refusedState(values, result.refusal);
    case "saved":
      break;
  }
  revalidateIncomeScreens();
  redirect(withNotice(returnPath(from, input.project_id), savedNotice(from, incomeId === null)));
}

/** INC-1 / MS-4: records an income and returns to the list or the project card. */
export async function createIncomeAction(
  from: ReturnTarget,
  _previous: IncomeFormState,
  formData: FormData,
): Promise<IncomeFormState> {
  await requireAllowedUser();
  return saveIncomeForm(null, from, formData);
}

/** INC-1: saves changes to an income (M2.1: no receipt blocks it yet). */
export async function updateIncomeAction(
  incomeId: string,
  from: ReturnTarget,
  _previous: IncomeFormState,
  formData: FormData,
): Promise<IncomeFormState> {
  await requireAllowedUser();
  const id = incomeIdSchema.safeParse(incomeId);
  if (!id.success) {
    return {
      values: readIncomeFormValues(formData),
      fieldErrors: {},
      formError: MESSAGES.notFound,
    };
  }
  return saveIncomeForm(id.data, from, formData);
}

/**
 * SPEC 6: soft-deletes an income (after the confirmation dialog) and returns to the list or
 * the project card. Returns only on failure.
 */
export async function deleteIncomeAction(
  incomeId: string,
  fromParam: ReturnTarget,
): Promise<ActionStatus> {
  await requireAllowedUser();
  const id = incomeIdSchema.safeParse(incomeId);
  if (!id.success) {
    return { message: null, error: MESSAGES.notFound };
  }
  const from = returnTargetSchema.catch("incomes").parse(fromParam);
  let result: Awaited<ReturnType<typeof softDeleteIncome>>;
  try {
    result = await softDeleteIncome(await createSupabaseServerClient(), id.data);
  } catch (error) {
    logDbFailure("incomes", "delete", error);
    return { message: null, error: MESSAGES.deleteFailed };
  }
  if (result.status === "not_found") {
    return { message: null, error: MESSAGES.notFound };
  }
  revalidateIncomeScreens();
  const notice: string =
    from === "project"
      ? ("income_deleted" satisfies ProjectNotice)
      : ("deleted" satisfies IncomeNotice);
  redirect(withNotice(returnPath(from, result.projectId), notice));
}

export type LoadIncomeChoicesResult = { ok: true; choices: IncomeChoices } | { ok: false };

const choicesInputSchema = z.object({
  clientId: z.uuid(),
  projectId: z.uuid().nullable(),
  milestoneId: z.uuid().nullable(),
});

/** INC-1: the projects and milestones of the client chosen in the income form. */
export async function loadIncomeChoicesAction(input: {
  clientId: string;
  projectId: string | null;
  milestoneId: string | null;
}): Promise<LoadIncomeChoicesResult> {
  await requireAllowedUser();
  const parsed = choicesInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false };
  }
  try {
    return {
      ok: true,
      choices: await listIncomeChoices(await createSupabaseServerClient(), parsed.data.clientId, {
        projectId: parsed.data.projectId,
        milestoneId: parsed.data.milestoneId,
      }),
    };
  } catch (error) {
    logDbFailure("incomes", "list choices", error);
    return { ok: false };
  }
}

export type SearchIncomesResult =
  | {
      ok: true;
      page: IncomeListPage;
      /** The filter's count and total; only with the first page (offset 0). */
      summary: IncomesMonthSummary | null;
    }
  | { ok: false };

const searchInputSchema = z.object({
  month: z.string().refine(isMonth),
  clientId: z.union([z.literal(""), z.uuid()]),
  offset: z.number().int().min(0),
});

/**
 * INC-1: a page of the incomes list for a month and optionally a client, through a Server
 * Action (POST), with the month's total on the first page.
 */
export async function searchIncomesAction(input: {
  month: string;
  clientId: string;
  offset: number;
}): Promise<SearchIncomesResult> {
  await requireAllowedUser();
  const parsed = searchInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false };
  }
  const filter = { month: parsed.data.month, clientId: parsed.data.clientId || null };
  try {
    const supabase = await createSupabaseServerClient();
    const [page, summary] = await Promise.all([
      listIncomes(supabase, filter, parsed.data.offset),
      parsed.data.offset === 0 ? getIncomesMonthSummary(supabase, filter) : null,
    ]);
    return { ok: true, page, summary };
  } catch (error) {
    logDbFailure("incomes", "list", error);
    return { ok: false };
  }
}
