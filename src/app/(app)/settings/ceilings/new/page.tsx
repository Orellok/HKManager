import { requireAdmin } from "@/lib/auth/guards";
import { createCeilingAction } from "@/lib/ceiling/actions";
import { yearSchema } from "@/lib/ceiling/schema";

import { CeilingForm } from "../ceiling-form";

/**
 * CEIL-1 / CEIL-6 (admin only; an owner gets the 404 screen): adds the ceiling of a tax
 * year. `?year=` fills the year in (the dashboard's "set the ceiling" link).
 */
export default async function NewCeilingPage({
  searchParams,
}: PageProps<"/settings/ceilings/new">) {
  await requireAdmin();
  const requested = (await searchParams).year;
  const year = yearSchema.safeParse(typeof requested === "string" ? requested : "");
  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">תקרה שנתית חדשה</h1>
      <CeilingForm
        action={createCeilingAction}
        initialValues={{ year: year.success ? String(year.data) : "", exempt_ceiling: "" }}
        fixedYear={null}
        submitLabel="שמירת התקרה"
      />
    </section>
  );
}
