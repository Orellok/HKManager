import { requireAllowedUser } from "@/lib/auth/guards";
import { projectIdSchema } from "@/lib/projects/schema";
import { createTaskAction } from "@/lib/tasks/actions";
import {
  TASK_CLIENT_PARAM,
  TASK_FROM_PARAM,
  TASK_PROJECT_PARAM,
  taskReturnPath,
  taskReturnTargetFrom,
} from "@/lib/tasks/paths";
import { EMPTY_TASK_FORM_VALUES, type TaskFormValues } from "@/lib/tasks/schema";

import { TaskForm } from "../task-form";
import { loadTaskFormOptions } from "../load-task-form";

/**
 * TASK-1 / TASK-8: a new task. `?client=<id>` or `?project=<id>` (the quick create of the
 * client and project cards) fills the link in, and `?from=client|project` returns to that card
 * after saving. A project fills its client in (TASK-9). An unknown or malformed id is ignored.
 */
export default async function NewTaskPage({ searchParams }: PageProps<"/tasks/new">) {
  await requireAllowedUser();
  const params = await searchParams;
  const from = taskReturnTargetFrom(params[TASK_FROM_PARAM]);
  const clientParam = projectIdSchema.safeParse(params[TASK_CLIENT_PARAM]);
  const projectParam = projectIdSchema.safeParse(params[TASK_PROJECT_PARAM]);
  const { clients, projects } = await loadTaskFormOptions({
    clientId: clientParam.success ? clientParam.data : null,
    projectId: projectParam.success ? projectParam.data : null,
  });

  const initialValues: TaskFormValues = { ...EMPTY_TASK_FORM_VALUES };
  const project = projectParam.success
    ? projects.options.find((option) => option.id === projectParam.data)
    : undefined;
  if (project) {
    Object.assign(initialValues, { client_id: project.client_id, project_id: project.id });
  } else if (clients.selected) {
    initialValues.client_id = clients.selected.id;
  }

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">משימה חדשה</h1>
      <TaskForm
        action={createTaskAction.bind(null, from)}
        initialValues={initialValues}
        clientOptions={clients.options}
        moreClientsExist={clients.hasMore}
        projectOptions={projects.options}
        moreProjectsExist={projects.hasMore}
        showStatus={false}
        submitLabel="שמירת משימה"
        cancelHref={taskReturnPath(from, {
          clientId: initialValues.client_id || null,
          projectId: initialValues.project_id || null,
        })}
      />
    </section>
  );
}
