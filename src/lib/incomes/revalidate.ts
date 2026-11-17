import { revalidatePath } from "next/cache";

import { CLIENTS_PATH } from "@/lib/clients/paths";
import { DEBTS_PATH } from "@/lib/debts/paths";
import { PROJECTS_PATH } from "@/lib/projects/paths";

import { INCOMES_PATH } from "./paths";

/**
 * After an income or its receipt changed: incomes appear on the incomes list (with their
 * receipt status), the project and client cards, in open debts and, while waiting for a
 * receipt, on the home page (DOC-5). Call from Server Actions only.
 */
export function revalidateIncomeScreens(): void {
  revalidatePath("/");
  revalidatePath(INCOMES_PATH, "layout");
  revalidatePath(PROJECTS_PATH, "layout");
  revalidatePath(CLIENTS_PATH, "layout");
  revalidatePath(DEBTS_PATH);
}
