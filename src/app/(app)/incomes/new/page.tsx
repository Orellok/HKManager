import Link from "next/link";

import { buttonClasses } from "@/components/button";
import { newCreateKey } from "@/lib/create-key";
import { requireAllowedUser } from "@/lib/auth/guards";
import { NEW_CLIENT_PATH } from "@/lib/clients/paths";
import { todayInJerusalem } from "@/lib/dates";
import { createIncomeAction } from "@/lib/incomes/actions";
import {
  FROM_PARAM,
  INCOMES_PATH,
  MILESTONE_PARAM,
  PROJECT_PARAM,
  returnPath,
  returnTargetFrom,
} from "@/lib/incomes/paths";
import { EMPTY_INCOME_FORM_VALUES, type IncomeFormValues } from "@/lib/incomes/schema";
import { getMilestone } from "@/lib/milestones/queries";
import { milestoneIdSchema } from "@/lib/milestones/schema";
import { agorotToShekelInput } from "@/lib/money";
import { projectPath } from "@/lib/projects/paths";
import { getProject } from "@/lib/projects/queries";
import { projectIdSchema } from "@/lib/projects/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { loadFormClients } from "../../projects/load-form-clients";
import { IncomeForm } from "../income-form";
import { loadIncomeChoices, loadOrNotFound } from "../load-income-form";

/**
 * INC-1 / INC-2 / MS-4: a new income. `?milestone=<id>` ("רשום תשלום" on the project card)
 * chooses the milestone, its project and client and fills the amount with the balance;
 * `?project=<id>` chooses a project and its client. `?from=project` returns to the project
 * card after saving. Owner decision (M2.1): a cancelled milestone gets no payment; the page
 * explains instead of showing the form.
 */
export default async function NewIncomePage({ searchParams }: PageProps<"/incomes/new">) {
  await requireAllowedUser();
  const params = await searchParams;
  const from = returnTargetFrom(params[FROM_PARAM]);
  const today = todayInJerusalem();
  const supabase = await createSupabaseServerClient();
  const initialValues: IncomeFormValues = { ...EMPTY_INCOME_FORM_VALUES, received_date: today };

  const milestoneParam = milestoneIdSchema.safeParse(params[MILESTONE_PARAM]);
  const projectParam = projectIdSchema.safeParse(params[PROJECT_PARAM]);
  if (milestoneParam.success) {
    const milestone = await loadOrNotFound("read milestone", () =>
      getMilestone(supabase, milestoneParam.data),
    );
    if (milestone.cancelled_at !== null) {
      return (
        <section className="space-y-6">
          <h1 className="text-2xl font-semibold">רישום תשלום</h1>
          <div className="max-w-xl space-y-3 rounded-lg border p-6">
            <p className="font-medium wrap-anywhere">
              אבן הדרך &quot;{milestone.description}&quot; בוטלה.
            </p>
            <p className="text-muted-foreground text-sm">
              אי אפשר לרשום תשלום לאבן דרך שבוטלה. אפשר להחזיר אותה מביטול בכרטיס הפרויקט.
            </p>
            <Link href={projectPath(milestone.project_id)} className={buttonClasses("primary")}>
              לכרטיס הפרויקט
            </Link>
          </div>
        </section>
      );
    }
    const project = await loadOrNotFound("read project", () =>
      getProject(supabase, milestone.project_id),
    );
    Object.assign(initialValues, {
      client_id: project.client_id,
      project_id: project.id,
      milestone_id: milestone.id,
      amount: milestone.balance > 0 ? agorotToShekelInput(milestone.balance) : "",
    });
  } else if (projectParam.success) {
    const project = await loadOrNotFound("read project", () =>
      getProject(supabase, projectParam.data),
    );
    Object.assign(initialValues, { client_id: project.client_id, project_id: project.id });
  }

  const clientId = initialValues.client_id || null;
  const projectId = initialValues.project_id || null;
  const [{ options, hasMore }, choices] = await Promise.all([
    loadFormClients(clientId),
    loadIncomeChoices(clientId, { projectId, milestoneId: initialValues.milestone_id || null }),
  ]);
  const isPayment = initialValues.milestone_id !== "";
  const title = isPayment ? "רישום תשלום" : "הכנסה חדשה";

  if (options.length === 0) {
    return (
      <section className="space-y-6">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <div className="max-w-xl space-y-3 rounded-lg border p-6">
          <p className="font-medium">אין עדיין לקוחות פעילים.</p>
          <p className="text-muted-foreground text-sm">
            כל הכנסה שייכת ללקוח. יש להוסיף לקוח קודם.
          </p>
          <Link href={NEW_CLIENT_PATH} className={buttonClasses("primary")}>
            הוספת לקוח
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <IncomeForm
        action={createIncomeAction.bind(null, from)}
        createKey={newCreateKey()}
        initialValues={initialValues}
        clientOptions={options}
        moreClientsExist={hasMore}
        initialChoices={choices}
        today={today}
        fillAmountFromMilestone
        submitLabel={isPayment ? "רישום התשלום" : "שמירת הכנסה"}
        cancelHref={from === "project" ? returnPath(from, projectId) : INCOMES_PATH}
      />
    </section>
  );
}
