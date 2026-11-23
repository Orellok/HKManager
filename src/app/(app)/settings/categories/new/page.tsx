import { requireAllowedUser } from "@/lib/auth/guards";
import { createCategoryAction } from "@/lib/expense-categories/actions";

import { CategoryForm } from "../category-form";

/** EXP-3 / owner decision (M3): adds an expense category at the end of the list. */
export default async function NewCategoryPage() {
  await requireAllowedUser();
  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">קטגוריית הוצאה חדשה</h1>
      <CategoryForm
        action={createCategoryAction}
        initialValues={{ name: "" }}
        submitLabel="הוספת הקטגוריה"
      />
    </section>
  );
}
