"use server";

import { requireAllowedUser } from "@/lib/auth/guards";
import { isIsoDate } from "@/lib/dates";
import { logDbFailure } from "@/lib/log";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { z } from "@/lib/zod";

import { listOpenDebts, type OpenDebtsPage } from "./queries";

export type LoadOpenDebtsResult = { ok: true; page: OpenDebtsPage } | { ok: false };

const loadInputSchema = z.object({
  today: z.string().refine(isIsoDate),
  offset: z.number().int().min(0),
});

/**
 * MS-6: the next page of open debts ("load more"). The list keeps the date it was first
 * loaded with, so its pages agree even if midnight passes in between; the date only narrows
 * what RLS already allows.
 */
export async function loadOpenDebtsAction(input: {
  today: string;
  offset: number;
}): Promise<LoadOpenDebtsResult> {
  await requireAllowedUser();
  const parsed = loadInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false };
  }
  try {
    return {
      ok: true,
      page: await listOpenDebts(
        await createSupabaseServerClient(),
        parsed.data.today,
        parsed.data.offset,
      ),
    };
  } catch (error) {
    logDbFailure("debts", "list", error);
    return { ok: false };
  }
}
