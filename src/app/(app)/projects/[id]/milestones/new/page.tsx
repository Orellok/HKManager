import { requireAllowedUser } from "@/lib/auth/guards";
import { createMilestoneAction } from "@/lib/milestones/actions";
import { EMPTY_MILESTONE_FORM_VALUES } from "@/lib/milestones/schema";
import { projectPath } from "@/lib/projects/paths";

import { loadProjectOrNotFound } from "../../load-project";
import { MilestoneForm } from "../milestone-form";

/** MS-1: a new milestone, added at the end of the project's list. */
export default async function NewMilestonePage({
  params,
}: PageProps<"/projects/[id]/milestones/new">) {
  await requireAllowedUser();
  const project = await loadProjectOrNotFound(params);

  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">אבן דרך חדשה</h1>
        <p className="text-muted-foreground wrap-anywhere">פרויקט: {project.name}</p>
      </div>
      <MilestoneForm
        action={createMilestoneAction.bind(null, project.id)}
        initialValues={EMPTY_MILESTONE_FORM_VALUES}
        submitLabel="שמירת אבן דרך"
        cancelHref={projectPath(project.id)}
      />
    </section>
  );
}
