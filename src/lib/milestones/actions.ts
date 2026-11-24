"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { ActionStatus } from "@/lib/action-status";
import { requireAllowedUser } from "@/lib/auth/guards";
import { readCreateKey } from "@/lib/create-key";
import { DEBTS_PATH } from "@/lib/debts/paths";
import type { ServerFormState } from "@/lib/forms";
import { logDbFailure } from "@/lib/log";
import { withNotice } from "@/lib/notices";
import { PROJECTS_PATH, projectPath, type ProjectNotice } from "@/lib/projects/paths";
import { projectIdSchema } from "@/lib/projects/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { z } from "@/lib/zod";

import {
  MAX_MILESTONES_PER_PROJECT,
  deleteMilestone,
  insertMilestone,
  moveMilestone,
  updateMilestone,
  type MoveMilestoneResult,
} from "./queries";
import { MOVE_DIRECTIONS, type MoveDirection } from "./reorder";
import {
  milestoneIdSchema,
  readMilestoneFormValues,
  validateMilestoneInput,
  type MilestoneField,
} from "./schema";

/**
 * Server Actions for milestones (MS-1, owner decisions on cancel and delete). Each one checks
 * the session with requireAllowedUser() before anything else and validates its input on the
 * server, including ids bound in the browser, which a caller can change.
 */

export type MilestoneFormState = ServerFormState<MilestoneField>;

export type MoveMilestoneActionResult = MoveMilestoneResult | { status: "failed"; error: string };

const MESSAGES = {
  saveFailed: "השמירה נכשלה. הפרטים לא נשמרו, אפשר לנסות שוב.",
  notFound: "אבן הדרך לא נמצאה. ייתכן שנמחקה.",
  projectMissing: "הפרויקט לא נמצא. ייתכן שנמחק.",
  tooMany: `לפרויקט יש כבר ${MAX_MILESTONES_PER_PROJECT} אבני דרך, המספר המרבי.`,
  cancelled: "אבן הדרך בוטלה.",
  restored: "אבן הדרך הוחזרה מביטול.",
  deleted: "אבן הדרך נמחקה.",
  actionFailed: "הפעולה נכשלה. אפשר לנסות שוב.",
  deleteReferenced: "אי אפשר למחוק אבן דרך שנרשמו לה תשלומים. אפשר לבטל אותה.",
} as const;

/** Milestones appear on the project card and on the open debts screen (MS-6). */
function revalidateMilestoneScreens() {
  revalidatePath(PROJECTS_PATH, "layout");
  revalidatePath(DEBTS_PATH);
}

/** MS-1: adds a milestone at the end of the project's list and returns to the card. */
export async function createMilestoneAction(
  projectId: string,
  _previous: MilestoneFormState,
  formData: FormData,
): Promise<MilestoneFormState> {
  await requireAllowedUser();
  const values = readMilestoneFormValues(formData);
  const project = projectIdSchema.safeParse(projectId);
  if (!project.success) {
    return { values, fieldErrors: {}, formError: MESSAGES.projectMissing };
  }
  const validation = validateMilestoneInput(values);
  if (!validation.success) {
    return { values, fieldErrors: validation.fieldErrors, formError: null };
  }

  let result: Awaited<ReturnType<typeof insertMilestone>>;
  try {
    result = await insertMilestone(
      await createSupabaseServerClient(),
      project.data,
      validation.data,
      readCreateKey(formData),
    );
  } catch (error) {
    logDbFailure("milestones", "create", error);
    return { values, fieldErrors: {}, formError: MESSAGES.saveFailed };
  }
  if (result === "project_missing") {
    return { values, fieldErrors: {}, formError: MESSAGES.projectMissing };
  }
  if (result === "too_many") {
    return { values, fieldErrors: {}, formError: MESSAGES.tooMany };
  }
  revalidateMilestoneScreens();
  redirect(withNotice(projectPath(project.data), "milestone_created" satisfies ProjectNotice));
}

/** MS-1: saves changes to a milestone and returns to its project's card. */
export async function updateMilestoneAction(
  milestoneId: string,
  _previous: MilestoneFormState,
  formData: FormData,
): Promise<MilestoneFormState> {
  await requireAllowedUser();
  const values = readMilestoneFormValues(formData);
  const id = milestoneIdSchema.safeParse(milestoneId);
  if (!id.success) {
    return { values, fieldErrors: {}, formError: MESSAGES.notFound };
  }
  const validation = validateMilestoneInput(values);
  if (!validation.success) {
    return { values, fieldErrors: validation.fieldErrors, formError: null };
  }

  let result: Awaited<ReturnType<typeof updateMilestone>>;
  try {
    result = await updateMilestone(await createSupabaseServerClient(), id.data, validation.data);
  } catch (error) {
    logDbFailure("milestones", "update", error);
    return { values, fieldErrors: {}, formError: MESSAGES.saveFailed };
  }
  if (result.status === "not_found") {
    return { values, fieldErrors: {}, formError: MESSAGES.notFound };
  }
  revalidateMilestoneScreens();
  redirect(withNotice(projectPath(result.projectId), "milestone_updated" satisfies ProjectNotice));
}

const moveInputSchema = z.object({
  id: milestoneIdSchema,
  direction: z.enum(MOVE_DIRECTIONS),
});

/** MS-1: moves a milestone one place up or down (an edge move changes nothing). */
export async function moveMilestoneAction(
  milestoneId: string,
  direction: MoveDirection,
): Promise<MoveMilestoneActionResult> {
  await requireAllowedUser();
  const parsed = moveInputSchema.safeParse({ id: milestoneId, direction });
  if (!parsed.success) {
    return { status: "not_found" };
  }
  let result: MoveMilestoneResult;
  try {
    result = await moveMilestone(
      await createSupabaseServerClient(),
      parsed.data.id,
      parsed.data.direction,
    );
  } catch (error) {
    logDbFailure("milestones", "move", error);
    return { status: "failed", error: MESSAGES.actionFailed };
  }
  // Also after "edge" or "not_found": the card was out of date, so it is reloaded.
  revalidateMilestoneScreens();
  return result;
}

async function setCancelled(milestoneId: string, cancelled: boolean): Promise<ActionStatus> {
  await requireAllowedUser();
  const id = milestoneIdSchema.safeParse(milestoneId);
  if (!id.success) {
    return { message: null, error: MESSAGES.notFound };
  }
  let result: Awaited<ReturnType<typeof updateMilestone>>;
  try {
    result = await updateMilestone(await createSupabaseServerClient(), id.data, {
      cancelled_at: cancelled ? new Date().toISOString() : null,
    });
  } catch (error) {
    logDbFailure("milestones", cancelled ? "cancel" : "restore", error);
    return { message: null, error: MESSAGES.actionFailed };
  }
  if (result.status === "not_found") {
    return { message: null, error: MESSAGES.notFound };
  }
  revalidateMilestoneScreens();
  return { message: cancelled ? MESSAGES.cancelled : MESSAGES.restored, error: null };
}

/** Owner decision (M1.3): cancels a milestone (after the confirmation dialog). */
export async function cancelMilestoneAction(milestoneId: string): Promise<ActionStatus> {
  return setCancelled(milestoneId, true);
}

/** Owner decision (M1.3): brings a cancelled milestone back. */
export async function restoreMilestoneAction(milestoneId: string): Promise<ActionStatus> {
  return setCancelled(milestoneId, false);
}

/** Owner decision (M1.3): permanently deletes a milestone (after the confirmation dialog). */
export async function deleteMilestoneAction(milestoneId: string): Promise<ActionStatus> {
  await requireAllowedUser();
  const id = milestoneIdSchema.safeParse(milestoneId);
  if (!id.success) {
    return { message: null, error: MESSAGES.notFound };
  }
  let result: Awaited<ReturnType<typeof deleteMilestone>>;
  try {
    result = await deleteMilestone(await createSupabaseServerClient(), id.data);
  } catch (error) {
    logDbFailure("milestones", "delete", error);
    return { message: null, error: MESSAGES.actionFailed };
  }
  if (result === "referenced") {
    return { message: null, error: MESSAGES.deleteReferenced };
  }
  if (result === "not_found") {
    return { message: null, error: MESSAGES.notFound };
  }
  revalidateMilestoneScreens();
  return { message: MESSAGES.deleted, error: null };
}
