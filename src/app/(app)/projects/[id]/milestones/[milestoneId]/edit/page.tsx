import { notFound } from "next/navigation";

import { requireAllowedUser } from "@/lib/auth/guards";
import { logDbFailure } from "@/lib/log";
import { updateMilestoneAction } from "@/lib/milestones/actions";
import { getMilestone, type Milestone } from "@/lib/milestones/queries";
import { milestoneIdSchema, type MilestoneFormValues } from "@/lib/milestones/schema";
import { agorotToShekelInput } from "@/lib/money";
import { projectPath } from "@/lib/projects/paths";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { loadProjectOrNotFound } from "../../../load-project";
import { MilestoneForm } from "../../milestone-form";

/** MS-1: edit a milestone's description, amount and due date. */
export default async function EditMilestonePage({
  params,
}: PageProps<"/projects/[id]/milestones/[milestoneId]/edit">) {
  await requireAllowedUser();
  const project = await loadProjectOrNotFound(params);
  const milestoneId = milestoneIdSchema.safeParse((await params).milestoneId);
  if (!milestoneId.success) {
    notFound();
  }
  let milestone: Milestone | null;
  try {
    milestone = await getMilestone(await createSupabaseServerClient(), milestoneId.data);
  } catch (error) {
    // Logged by code only; the error boundary gets no database details (SPEC 8).
    logDbFailure("milestones", "read", error);
    throw new Error("Could not load the milestone");
  }
  // A milestone of another project under this project's address is not shown here.
  if (!milestone || milestone.project_id !== project.id) {
    notFound();
  }
  const initialValues: MilestoneFormValues = {
    description: milestone.description,
    amount: agorotToShekelInput(milestone.amount),
    due_date: milestone.due_date,
  };

  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">עריכת אבן דרך</h1>
        <p className="text-muted-foreground wrap-anywhere">פרויקט: {project.name}</p>
      </div>
      <MilestoneForm
        action={updateMilestoneAction.bind(null, milestone.id)}
        initialValues={initialValues}
        submitLabel="שמירת שינויים"
        cancelHref={projectPath(project.id)}
      />
    </section>
  );
}
