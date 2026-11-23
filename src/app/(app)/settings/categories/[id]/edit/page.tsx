import { notFound } from "next/navigation";

import { requireAllowedUser } from "@/lib/auth/guards";
import { renameCategoryAction } from "@/lib/expense-categories/actions";
import { getExpenseCategory } from "@/lib/expense-categories/queries";
import { categoryIdSchema } from "@/lib/expense-categories/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { loadRecordOrNotFound } from "../../../../load-or-not-found";
import { CategoryForm } from "../../category-form";

/** EXP-3 / owner decision (M3): renames an expense category (active or archived). */
export default async function EditCategoryPage({
  params,
}: PageProps<"/settings/categories/[id]/edit">) {
  await requireAllowedUser();
  const id = categoryIdSchema.safeParse((await params).id);
  if (!id.success) {
    notFound();
  }
  const category = await loadRecordOrNotFound("expense_categories", "read", async () =>
    getExpenseCategory(await createSupabaseServerClient(), id.data),
  );
  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">שינוי שם קטגוריה</h1>
      <p className="text-muted-foreground max-w-xl text-sm">
        השם החדש יופיע גם בהוצאות שכבר נרשמו בקטגוריה הזו.
      </p>
      <CategoryForm
        action={renameCategoryAction.bind(null, category.id)}
        initialValues={{ name: category.name }}
        submitLabel="שמירת השם"
      />
    </section>
  );
}
