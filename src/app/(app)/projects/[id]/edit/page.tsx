import { requireAllowedUser } from "@/lib/auth/guards";
import { agorotToShekelInput } from "@/lib/money";
import { updateProjectAction } from "@/lib/projects/actions";
import { projectPath } from "@/lib/projects/paths";
import type { ProjectFormValues } from "@/lib/projects/schema";

import { loadFormClients } from "../../load-form-clients";
import { ProjectForm } from "../../project-form";
import { loadProjectOrNotFound } from "../load-project";

/** PRJ-1: edit a project's details. */
export default async function EditProjectPage({ params }: PageProps<"/projects/[id]/edit">) {
  await requireAllowedUser();
  const project = await loadProjectOrNotFound(params);
  const { options } = await loadFormClients(project.client_id);
  const initialValues: ProjectFormValues = {
    client_id: project.client_id,
    name: project.name,
    property_address: project.property_address ?? "",
    status: project.status,
    contract_amount:
      project.contract_amount === null ? "" : agorotToShekelInput(project.contract_amount),
    start_date: project.start_date ?? "",
    end_date: project.end_date ?? "",
    notes: project.notes ?? "",
  };

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">עריכת פרויקט</h1>
      <ProjectForm
        action={updateProjectAction.bind(null, project.id)}
        initialValues={initialValues}
        clientOptions={options}
        submitLabel="שמירת שינויים"
        cancelHref={projectPath(project.id)}
      />
    </section>
  );
}
