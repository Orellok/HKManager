"use server";

import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";

import { LOGIN_PATH } from "./access";

/**
 * Signs the current browser out and returns to the login screen. Used by the "יציאה" button
 * and by "כניסה עם חשבון אחר" on the "אין הרשאה" screen. Scope "local" ends this browser's
 * session only, so signing out on one device does not sign the user out everywhere.
 */
export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) {
    throw new Error("Could not sign out", { cause: error });
  }
  redirect(LOGIN_PATH);
}
