import { notFound } from "next/navigation";

import { requireAdmin } from "@/lib/auth/guards";
import { updateCeilingAction } from "@/lib/ceiling/actions";
import { getTaxYearCeiling } from "@/lib/ceiling/queries";
import { yearSchema } from "@/lib/ceiling/schema";
import { agorotToShekelInput } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { loadRecordOrNotFound } from "../../../../load-or-not-found";
import { CeilingForm } from "../../ceiling-form";

/** CEIL-1 (admin only; an owner gets the 404 screen): changes the ceiling of a tax year. */
export default async function EditCeilingPage({
  params,
}: PageProps<"/settings/ceilings/[year]/edit">) {
  await requireAdmin();
  const year = yearSchema.safeParse((await params).year);
  if (!year.success) {
    notFound();
  }
  const ceiling = await loadRecordOrNotFound("tax_year_settings", "read", async () =>
    getTaxYearCeiling(await createSupabaseServerClient(), year.data),
  );
  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">עדכון התקרה לשנת {ceiling.year}</h1>
      <CeilingForm
        action={updateCeilingAction.bind(null, ceiling.year)}
        initialValues={{
          year: String(ceiling.year),
          exempt_ceiling: agorotToShekelInput(ceiling.ceiling),
        }}
        fixedYear={ceiling.year}
        submitLabel="שמירת התקרה"
      />
    </section>
  );
}
