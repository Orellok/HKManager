"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ChangeEvent } from "react";

import { Button, buttonClasses } from "@/components/button";
import { checkDateInputs } from "@/components/check-date-inputs";
import { SelectField, TextInputField, TextareaField } from "@/components/form-field";
import { useServerForm } from "@/components/use-server-form";
import { callServerAction } from "@/lib/auth/action-failure";
import { MIN_ISO_DATE, todayInJerusalem } from "@/lib/dates";
import { loadIncomeChoicesAction, type IncomeFormState } from "@/lib/incomes/actions";
import { OVERPAYMENT_CONFIRM_FIELD } from "@/lib/incomes/overpayment";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from "@/lib/incomes/payment-methods";
import {
  PROJECT_CHOICES_LIMIT,
  type IncomeChoices,
  type MilestoneChoice,
} from "@/lib/incomes/queries";
import {
  INCOME_FIELDS,
  INCOME_NOTES_MAX_LENGTH,
  readIncomeFormValues,
  validateIncomeInput,
  type IncomeFormValues,
} from "@/lib/incomes/schema";
import { agorotToShekelInput, formatAgorot } from "@/lib/money";
import { CLIENT_OPTIONS_LIMIT, type ClientOption } from "@/lib/projects/queries";

type IncomeFormProps = {
  action: (state: IncomeFormState, formData: FormData) => Promise<IncomeFormState>;
  initialValues: IncomeFormValues;
  /** The clients to choose from: active ones, plus the current client when it is archived. */
  clientOptions: readonly ClientOption[];
  /** More active clients exist than `clientOptions` holds (CLIENT_OPTIONS_LIMIT). */
  moreClientsExist: boolean;
  /** The projects and milestones of the initial client, or null without a client. */
  initialChoices: IncomeChoices | null;
  /** Today in Asia/Jerusalem, from the server: the latest date the date input offers. */
  today: string;
  /** MS-4: choosing a milestone fills the amount with its balance (new incomes only). */
  fillAmountFromMilestone: boolean;
  submitLabel: string;
  cancelHref: string;
};

type ChoicesState =
  { status: "ready"; choices: IncomeChoices | null } | { status: "loading" } | { status: "failed" };

const REQUIRED = "(חובה)";
const OPTIONAL = "(לא חובה)";
const DATE_FIELDS = ["received_date"] as const;
const CHOICES_FAILED = "לא הצלחנו לטעון את הפרויקטים של הלקוח. אפשר לבחור את הלקוח שוב.";
const MORE_CLIENTS_HINT = `מוצגים ${CLIENT_OPTIONS_LIMIT} הלקוחות הפעילים הראשונים לפי שם. לתשלום על אבן דרך של לקוח אחר אפשר להשתמש ב"רשום תשלום" בכרטיס הפרויקט.`;
const MORE_PROJECTS_HINT = `מוצגים ${PROJECT_CHOICES_LIMIT} הפרויקטים הראשונים של הלקוח לפי שם. לפרויקט אחר אפשר לרשום הכנסה מכרטיס הפרויקט.`;

const PAYMENT_METHOD_OPTIONS = PAYMENT_METHODS.map((method) => ({
  value: method,
  label: PAYMENT_METHOD_LABELS[method],
}));

function checkReceivedDateInput(form: HTMLFormElement) {
  return checkDateInputs(form, DATE_FIELDS);
}

/** Validated against today in the browser at the moment of saving; the server checks again. */
function validateForToday(values: IncomeFormValues) {
  return validateIncomeInput(values, todayInJerusalem());
}

function milestoneLabel(milestone: MilestoneChoice, projectName?: string): string {
  const balance =
    milestone.balance > 0 ? `יתרה: ${formatAgorot(milestone.balance)}` : "שולמה במלואה";
  const name = projectName ? `${projectName} – ${milestone.description}` : milestone.description;
  return `${name} (${balance})`;
}

/**
 * INC-1 / INC-2 / MS-4 / MS-5: the income form (saving, validation, errors and failed
 * requests: see useServerForm). The client is required; project and milestone are optional.
 * Choosing a client loads its projects and milestones; choosing a project limits the
 * milestones to its own; choosing a milestone also chooses its project (and, for a new
 * income, fills the amount with the milestone's balance). A payment above the balance comes
 * back with a warning and an explicit confirm button (MS-5).
 */
export function IncomeForm({
  action,
  initialValues,
  clientOptions,
  moreClientsExist,
  initialChoices,
  today,
  fillAmountFromMilestone,
  submitLabel,
  cancelHref,
}: IncomeFormProps) {
  const { formRef, formAction, handleSubmit, values, errors, formMessage, confirmation, pending } =
    useServerForm({
      action,
      initialValues,
      fields: INCOME_FIELDS,
      read: readIncomeFormValues,
      validate: validateForToday,
      checkControls: checkReceivedDateInput,
    });
  const [clientId, setClientId] = useState(initialValues.client_id);
  const [projectId, setProjectId] = useState(initialValues.project_id);
  const [milestoneId, setMilestoneId] = useState(initialValues.milestone_id);
  const [choicesState, setChoicesState] = useState<ChoicesState>({
    status: "ready",
    choices: initialChoices,
  });
  /** The latest choices request; an older answer arriving later is dropped. */
  const choicesRequest = useRef(0);
  const amountRef = useRef<HTMLInputElement>(null);
  /** The amount the form filled in from a milestone, so it is replaced only while unchanged. */
  const filledAmount = useRef<string | null>(
    fillAmountFromMilestone && initialValues.milestone_id !== "" ? initialValues.amount : null,
  );
  const confirmationRef = useRef<HTMLDivElement>(null);

  // MS-5: the warning appears after a save attempt; focus moves to it so it is read first.
  useEffect(() => {
    if (confirmation) {
      confirmationRef.current?.focus();
    }
  }, [confirmation]);

  const choices = choicesState.status === "ready" ? choicesState.choices : null;
  const projects = choices?.projects ?? [];
  const selectedProject = projects.find((project) => project.id === projectId);
  const milestoneOptions = (selectedProject ? [selectedProject] : projects).flatMap((project) =>
    project.milestones.map((milestone) => ({
      value: milestone.id,
      label: milestoneLabel(milestone, selectedProject ? undefined : project.name),
    })),
  );

  async function changeClient(event: ChangeEvent<HTMLSelectElement>) {
    const next = event.currentTarget.value;
    setClientId(next);
    setProjectId("");
    setMilestoneId("");
    const request = ++choicesRequest.current;
    if (next === "") {
      setChoicesState({ status: "ready", choices: null });
      return;
    }
    setChoicesState({ status: "loading" });
    const call = await callServerAction(() =>
      loadIncomeChoicesAction({ clientId: next, projectId: null, milestoneId: null }),
    );
    if (request !== choicesRequest.current || call.status === "redirected") {
      return;
    }
    setChoicesState(
      call.status === "done" && call.value.ok
        ? { status: "ready", choices: call.value.choices }
        : { status: "failed" },
    );
  }

  function changeProject(event: ChangeEvent<HTMLSelectElement>) {
    const next = event.currentTarget.value;
    setProjectId(next);
    const project = projects.find((candidate) => candidate.id === next);
    if (!project?.milestones.some((milestone) => milestone.id === milestoneId)) {
      setMilestoneId("");
    }
  }

  function changeMilestone(event: ChangeEvent<HTMLSelectElement>) {
    const next = event.currentTarget.value;
    setMilestoneId(next);
    for (const project of projects) {
      const milestone = project.milestones.find((candidate) => candidate.id === next);
      if (milestone) {
        setProjectId(project.id);
        fillAmount(milestone);
        return;
      }
    }
  }

  /** MS-4: the amount defaults to the milestone's balance, unless the user typed one. */
  function fillAmount(milestone: MilestoneChoice) {
    const input = amountRef.current;
    if (!fillAmountFromMilestone || !input) {
      return;
    }
    if (input.value.trim() !== "" && input.value !== filledAmount.current) {
      return;
    }
    const value = milestone.balance > 0 ? agorotToShekelInput(milestone.balance) : "";
    input.value = value;
    filledAmount.current = value;
  }

  const clientSelectOptions = clientOptions.map((client) => ({
    value: client.id,
    label: client.archived ? `${client.name} (בארכיון)` : client.name,
  }));
  const projectOptions = projects.map((project) => ({
    value: project.id,
    label: project.archived ? `${project.name} (בארכיון)` : project.name,
  }));
  const choicesHint =
    choicesState.status === "loading"
      ? "טוען את הפרויקטים של הלקוח…"
      : clientId === ""
        ? "יש לבחור לקוח קודם."
        : undefined;

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={handleSubmit}
      noValidate
      className="max-w-xl space-y-5"
    >
      <p role="alert" className="text-destructive text-sm font-medium">
        {formMessage}
      </p>

      <SelectField
        name="client_id"
        label="לקוח"
        requiredMark={REQUIRED}
        placeholder="בחירת לקוח"
        hint={moreClientsExist ? MORE_CLIENTS_HINT : undefined}
        options={clientSelectOptions}
        value={clientId}
        onChange={changeClient}
        error={errors.client_id}
      />
      <p role="status" className="text-destructive text-sm empty:sr-only">
        {choicesState.status === "failed" ? CHOICES_FAILED : null}
      </p>
      <SelectField
        name="project_id"
        label="פרויקט"
        requiredMark={OPTIONAL}
        placeholder="ללא פרויקט"
        hint={choicesHint ?? (choices?.hasMoreProjects ? MORE_PROJECTS_HINT : undefined)}
        options={projectOptions}
        value={projectId}
        onChange={changeProject}
        error={errors.project_id}
      />
      <SelectField
        name="milestone_id"
        label="אבן דרך"
        requiredMark={OPTIONAL}
        placeholder="ללא אבן דרך"
        hint={choicesHint ?? "בחירת אבן דרך בוחרת גם את הפרויקט שלה."}
        options={milestoneOptions}
        value={milestoneId}
        onChange={changeMilestone}
        error={errors.milestone_id}
      />
      <TextInputField
        name="received_date"
        label="תאריך קבלת התשלום"
        requiredMark={REQUIRED}
        type="date"
        min={MIN_ISO_DATE}
        max={today}
        defaultValue={values.received_date}
        error={errors.received_date}
      />
      <TextInputField
        ref={amountRef}
        name="amount"
        label="סכום (₪)"
        requiredMark={REQUIRED}
        hint="בשקלים, למשל 12,500 או 12,500.50."
        inputMode="decimal"
        autoComplete="off"
        dir="ltr"
        className="text-end"
        defaultValue={values.amount}
        error={errors.amount}
      />
      <SelectField
        name="payment_method"
        label="אמצעי תשלום"
        requiredMark={REQUIRED}
        placeholder="בחירת אמצעי תשלום"
        options={PAYMENT_METHOD_OPTIONS}
        defaultValue={values.payment_method}
        error={errors.payment_method}
      />
      <TextareaField
        name="notes"
        label="הערות"
        requiredMark={OPTIONAL}
        maxLength={INCOME_NOTES_MAX_LENGTH}
        defaultValue={values.notes}
        error={errors.notes}
      />

      {confirmation ? (
        <div
          ref={confirmationRef}
          tabIndex={-1}
          role="alert"
          className="bg-muted space-y-3 rounded-md border-2 border-current p-4"
        >
          <p className="text-sm">
            <strong>שימו לב:</strong> {confirmation.message}
          </p>
          <Button
            type="submit"
            name={OVERPAYMENT_CONFIRM_FIELD}
            value={confirmation.token}
            pending={pending}
          >
            {pending ? "שומר…" : "כן, לרשום את התשלום"}
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" variant={confirmation ? "secondary" : "primary"} pending={pending}>
          {pending ? "שומר…" : submitLabel}
        </Button>
        <Link href={cancelHref} className={buttonClasses("secondary")}>
          ביטול
        </Link>
      </div>
    </form>
  );
}
