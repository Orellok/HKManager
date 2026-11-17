import { requireAllowedUser } from "@/lib/auth/guards";
import { todayInJerusalem } from "@/lib/dates";
import { updateIncomeAction } from "@/lib/incomes/actions";
import { FROM_PARAM, returnPath, returnTargetFrom } from "@/lib/incomes/paths";
import { getIncome } from "@/lib/incomes/queries";
import { incomeIdSchema, type IncomeFormValues } from "@/lib/incomes/schema";
import { agorotToShekelInput } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";

import { loadFormClients } from "../../../projects/load-form-clients";
import { IncomeDelete } from "../../income-delete";
import { IncomeForm } from "../../income-form";
import { loadIncomeChoices, loadOrNotFound } from "../../load-income-form";

/** INC-1: edit an income, or soft-delete it (SPEC 6). M2.1: no receipt blocks either yet. */
export default async function EditIncomePage({
  params,
  searchParams,
}: PageProps<"/incomes/[id]/edit">) {
  await requireAllowedUser();
  const id = incomeIdSchema.safeParse((await params).id);
  if (!id.success) {
    notFound();
  }
  const from = returnTargetFrom((await searchParams)[FROM_PARAM]);
  const income = await loadOrNotFound("read", async () =>
    getIncome(await createSupabaseServerClient(), id.data),
  );
  const [{ options, hasMore }, choices] = await Promise.all([
    loadFormClients(income.client_id),
    loadIncomeChoices(income.client_id, {
      projectId: income.project_id,
      milestoneId: income.milestone_id,
    }),
  ]);
  const initialValues: IncomeFormValues = {
    client_id: income.client_id,
    project_id: income.project_id ?? "",
    milestone_id: income.milestone_id ?? "",
    received_date: income.received_date,
    amount: agorotToShekelInput(income.amount),
    payment_method: income.payment_method,
    notes: income.notes ?? "",
  };

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">עריכת הכנסה</h1>
      <IncomeForm
        action={updateIncomeAction.bind(null, income.id, from)}
        initialValues={initialValues}
        clientOptions={options}
        moreClientsExist={hasMore}
        initialChoices={choices}
        today={todayInJerusalem()}
        fillAmountFromMilestone={false}
        submitLabel="שמירת שינויים"
        cancelHref={returnPath(from, income.project_id)}
      />
      <div className="max-w-xl border-t pt-6">
        <IncomeDelete incomeId={income.id} from={from} />
      </div>
    </section>
  );
}
