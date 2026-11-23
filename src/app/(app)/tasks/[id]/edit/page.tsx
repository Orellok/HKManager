import { notFound } from "next/navigation";

import { requireAllowedUser } from "@/lib/auth/guards";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { updateTaskAction } from "@/lib/tasks/actions";
import { TASK_FROM_PARAM, taskReturnPath, taskReturnTargetFrom } from "@/lib/tasks/paths";
import { getTask } from "@/lib/tasks/queries";
import { taskIdSchema, type TaskFormValues } from "@/lib/tasks/schema";

import { TaskDelete } from "../../task-delete";
import { TaskForm } from "../../task-form";
import { loadOrNotFound, loadTaskFormOptions } from "../../load-task-form";

/**
 * TASK-1: edit a task (its status too: open, done or cancelled) or delete it (TASK-10: soft
 * delete). `?from=client|project` returns to that card afterwards.
 */
export default async function EditTaskPage({
  params,
  searchParams,
}: PageProps<"/tasks/[id]/edit">) {
  await requireAllowedUser();
  const id = taskIdSchema.safeParse((await params).id);
  if (!id.success) {
    notFound();
  }
  const from = taskReturnTargetFrom((await searchParams)[TASK_FROM_PARAM]);
  const task = await loadOrNotFound("read", async () =>
    getTask(await createSupabaseServerClient(), id.data),
  );
  const { clients, projects } = await loadTaskFormOptions({
    clientId: task.client_id,
    projectId: task.project_id,
  });
  const initialValues: TaskFormValues = {
    title: task.title,
    due_date: task.due_date ?? "",
    priority: task.priority,
    client_id: task.client_id ?? "",
    project_id: task.project_id ?? "",
    description: task.description ?? "",
    status: task.status,
  };

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">עריכת משימה</h1>
      <TaskForm
        action={updateTaskAction.bind(null, task.id, from)}
        initialValues={initialValues}
        clientOptions={clients.options}
        moreClientsExist={clients.hasMore}
        projectOptions={projects.options}
        moreProjectsExist={projects.hasMore}
        showStatus
        submitLabel="שמירת שינויים"
        cancelHref={taskReturnPath(from, { clientId: task.client_id, projectId: task.project_id })}
      />
      <div className="max-w-xl border-t pt-6">
        <TaskDelete taskId={task.id} from={from} />
      </div>
    </section>
  );
}
