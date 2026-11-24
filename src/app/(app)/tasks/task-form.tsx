"use client";

import Link from "next/link";
import { useState, type ChangeEvent } from "react";

import { CreateKeyInput } from "@/components/create-key-input";
import { Button, buttonClasses } from "@/components/button";
import { checkDateInputs } from "@/components/check-date-inputs";
import { SelectField, TextInputField, TextareaField } from "@/components/form-field";
import { useHydrated } from "@/components/use-hydrated";
import { useServerForm } from "@/components/use-server-form";
import { MAX_ISO_DATE, MIN_ISO_DATE } from "@/lib/dates";
import { CLIENT_OPTIONS_LIMIT, type ClientOption } from "@/lib/projects/queries";
import type { TaskFormState } from "@/lib/tasks/actions";
import { PROJECT_OPTIONS_LIMIT, type ProjectOption } from "@/lib/tasks/queries";
import {
  TASK_DESCRIPTION_MAX_LENGTH,
  TASK_FIELDS,
  TASK_TITLE_MAX_LENGTH,
  readTaskFormValues,
  validateTaskInput,
  type TaskFormValues,
} from "@/lib/tasks/schema";
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
} from "@/lib/tasks/status";

type TaskFormProps = {
  action: (state: TaskFormState, formData: FormData) => Promise<TaskFormState>;
  initialValues: TaskFormValues;
  /** Active clients, plus the current client when it is archived. */
  clientOptions: readonly ClientOption[];
  moreClientsExist: boolean;
  /** Active projects with their clients, plus the current project when it is archived. */
  projectOptions: readonly ProjectOption[];
  moreProjectsExist: boolean;
  /** The edit form also changes the status (open / done / cancelled). */
  showStatus: boolean;
  /** M7.1-8: the key of a create form (null when editing). */
  createKey?: string | null;
  submitLabel: string;
  cancelHref: string;
};

const REQUIRED = "(חובה)";
const OPTIONAL = "(לא חובה)";
const DATE_FIELDS = ["due_date"] as const;
const MORE_CLIENTS_HINT = `מוצגים ${CLIENT_OPTIONS_LIMIT} הלקוחות הפעילים הראשונים לפי שם. אפשר ליצור משימה גם מכרטיס הלקוח.`;
const MORE_PROJECTS_HINT = `מוצגים ${PROJECT_OPTIONS_LIMIT} הפרויקטים הפעילים הראשונים לפי שם. אפשר ליצור משימה גם מכרטיס הפרויקט.`;

const PRIORITY_OPTIONS = TASK_PRIORITIES.map((priority) => ({
  value: priority,
  label: TASK_PRIORITY_LABELS[priority],
}));
const STATUS_OPTIONS = TASK_STATUSES.map((status) => ({
  value: status,
  label: TASK_STATUS_LABELS[status],
}));

function checkDueDateInput(form: HTMLFormElement) {
  return checkDateInputs(form, DATE_FIELDS);
}

function archivedLabel(name: string, archived: boolean): string {
  return archived ? `${name} (בארכיון)` : name;
}

/**
 * TASK-1 / TASK-2 / TASK-9: the task form (saving, validation, errors and failed requests:
 * see useServerForm). Only the title is required; without a due date the task gets no
 * reminders and stays off the calendar. Choosing a project chooses its client; choosing a
 * client limits the projects to its own and clears a project of another client, so a project
 * of another client cannot be chosen (the database refuses it too).
 */
export function TaskForm({
  action,
  initialValues,
  clientOptions,
  moreClientsExist,
  projectOptions,
  moreProjectsExist,
  showStatus,
  createKey = null,
  submitLabel,
  cancelHref,
}: TaskFormProps) {
  const { formRef, formAction, handleSubmit, values, errors, formMessage, pending } = useServerForm(
    {
      action,
      initialValues,
      fields: TASK_FIELDS,
      read: readTaskFormValues,
      validate: validateTaskInput,
      checkControls: checkDueDateInput,
    },
  );
  const [clientId, setClientId] = useState(initialValues.client_id);
  const [projectId, setProjectId] = useState(initialValues.project_id);
  /**
   * Client and project are controlled and linked through JavaScript; a choice made before
   * hydration would be reset by it. Until then they are disabled, and hidden inputs carry
   * their initial values, so a form sent without JavaScript keeps them.
   */
  const hydrated = useHydrated();

  // A project's client may be missing from the client list (e.g. an archived client of an
  // active project); it is added so choosing that project can show its client.
  const clients = [...clientOptions];
  for (const project of projectOptions) {
    if (!clients.some((client) => client.id === project.client_id)) {
      clients.push({ id: project.client_id, name: project.client_name, archived: false });
    }
  }
  const visibleProjects = projectOptions.filter(
    (project) => clientId === "" || project.client_id === clientId,
  );

  function changeClient(event: ChangeEvent<HTMLSelectElement>) {
    const next = event.currentTarget.value;
    setClientId(next);
    const project = projectOptions.find((candidate) => candidate.id === projectId);
    if (project && next !== "" && project.client_id !== next) {
      setProjectId("");
    }
    if (next === "") {
      setProjectId("");
    }
  }

  function changeProject(event: ChangeEvent<HTMLSelectElement>) {
    const next = event.currentTarget.value;
    setProjectId(next);
    const project = projectOptions.find((candidate) => candidate.id === next);
    if (project) {
      setClientId(project.client_id);
    }
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={handleSubmit}
      noValidate
      className="max-w-xl space-y-5"
    >
      <CreateKeyInput value={createKey} />
      <p role="alert" className="text-destructive text-sm font-medium">
        {formMessage}
      </p>
      {hydrated ? null : (
        <>
          <input type="hidden" name="client_id" value={clientId} />
          <input type="hidden" name="project_id" value={projectId} />
        </>
      )}

      <TextInputField
        name="title"
        label="כותרת"
        requiredMark={REQUIRED}
        maxLength={TASK_TITLE_MAX_LENGTH}
        autoComplete="off"
        defaultValue={values.title}
        error={errors.title}
      />
      <TextInputField
        name="due_date"
        label="דדליין"
        requiredMark={OPTIONAL}
        hint="תאריך בלבד. משימה בלי דדליין אינה מקבלת תזכורות ואינה מוצגת ביומן."
        type="date"
        min={MIN_ISO_DATE}
        max={MAX_ISO_DATE}
        defaultValue={values.due_date}
        error={errors.due_date}
      />
      <SelectField
        name="priority"
        label="עדיפות"
        requiredMark={REQUIRED}
        options={PRIORITY_OPTIONS}
        defaultValue={values.priority}
        error={errors.priority}
      />
      <SelectField
        name="client_id"
        label="לקוח"
        requiredMark={OPTIONAL}
        placeholder="ללא לקוח"
        hint={moreClientsExist ? MORE_CLIENTS_HINT : undefined}
        options={clients.map((client) => ({
          value: client.id,
          label: archivedLabel(client.name, client.archived),
        }))}
        value={clientId}
        onChange={changeClient}
        disabled={!hydrated}
        error={errors.client_id}
      />
      <SelectField
        name="project_id"
        label="פרויקט"
        requiredMark={OPTIONAL}
        placeholder="ללא פרויקט"
        hint={
          moreProjectsExist
            ? MORE_PROJECTS_HINT
            : clientId === ""
              ? "בחירת פרויקט בוחרת גם את הלקוח שלו."
              : "מוצגים רק הפרויקטים של הלקוח שנבחר."
        }
        options={visibleProjects.map((project) => ({
          value: project.id,
          label:
            clientId === ""
              ? `${archivedLabel(project.name, project.archived)} – ${project.client_name}`
              : archivedLabel(project.name, project.archived),
        }))}
        value={projectId}
        onChange={changeProject}
        disabled={!hydrated}
        error={errors.project_id}
      />
      <TextareaField
        name="description"
        label="תיאור"
        requiredMark={OPTIONAL}
        maxLength={TASK_DESCRIPTION_MAX_LENGTH}
        defaultValue={values.description}
        error={errors.description}
      />
      {showStatus ? (
        <SelectField
          name="status"
          label="סטטוס"
          requiredMark={REQUIRED}
          options={STATUS_OPTIONS}
          defaultValue={values.status}
          error={errors.status}
        />
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" pending={pending}>
          {pending ? "שומר…" : submitLabel}
        </Button>
        <Link href={cancelHref} className={buttonClasses("secondary")}>
          ביטול
        </Link>
      </div>
    </form>
  );
}
