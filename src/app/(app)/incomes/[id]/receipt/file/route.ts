import { NextResponse } from "next/server";

import { requireAllowedUser } from "@/lib/auth/guards";
import { getIncomeWithReceipt } from "@/lib/documents/queries";
import { createReceiptViewUrl } from "@/lib/documents/storage";
import { incomeIdSchema } from "@/lib/incomes/schema";
import { logDbFailure } from "@/lib/log";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * DOC-2: opens an income's receipt PDF. The file stays in the private bucket; this answers
 * with a redirect to a signed URL that expires after RECEIPT_VIEW_URL_SECONDS, created for
 * the signed-in, allowlisted user. The browser navigates to Storage, so the app's CSP needs
 * no change (it governs the app's own pages, not where a link leads). Never cached.
 */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/incomes/[id]/receipt/file">,
) {
  await requireAllowedUser();
  const id = incomeIdSchema.safeParse((await params).id);
  if (!id.success) {
    return notFound();
  }
  try {
    const supabase = await createSupabaseServerClient();
    const income = await getIncomeWithReceipt(supabase, id.data);
    const path = income?.document?.file_path;
    if (!path) {
      return notFound();
    }
    const response = NextResponse.redirect(await createReceiptViewUrl(supabase, path), 303);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    logDbFailure("documents", "open file", error);
    return new NextResponse("הקובץ לא נפתח. אפשר לנסות שוב.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
}

function notFound() {
  return new NextResponse("הקבלה לא נמצאה.", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
