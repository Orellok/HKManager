import { NextResponse } from "next/server";

import { requireAllowedUser } from "@/lib/auth/guards";
import { getExpense } from "@/lib/expenses/queries";
import { expenseIdSchema } from "@/lib/expenses/schema";
import { createExpenseFileViewUrl } from "@/lib/expenses/storage";
import { logDbFailure } from "@/lib/log";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const TEXT_HEADERS = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" };

/**
 * EXP-2: opens an expense's file. The file stays in the private bucket; this answers with a
 * redirect to a signed URL that expires after VIEW_URL_SECONDS, created for the signed-in,
 * allowlisted user. Never cached.
 */
export async function GET(_request: Request, { params }: RouteContext<"/expenses/[id]/file">) {
  await requireAllowedUser();
  const id = expenseIdSchema.safeParse((await params).id);
  if (!id.success) {
    return notFound();
  }
  try {
    const supabase = await createSupabaseServerClient();
    const path = (await getExpense(supabase, id.data))?.file_path;
    if (!path) {
      return notFound();
    }
    const response = NextResponse.redirect(await createExpenseFileViewUrl(supabase, path), 303);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    logDbFailure("expenses", "open file", error);
    return new NextResponse("הקובץ לא נפתח. אפשר לנסות שוב.", {
      status: 503,
      headers: TEXT_HEADERS,
    });
  }
}

function notFound() {
  return new NextResponse("הקובץ לא נמצא.", { status: 404, headers: TEXT_HEADERS });
}
