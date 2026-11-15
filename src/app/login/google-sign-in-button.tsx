"use client";

import { useState } from "react";

import { Button } from "@/components/button";
import { AUTH_CALLBACK_PATH } from "@/lib/auth/access";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

/** AUTH-1: starts the Google OAuth flow through Supabase Auth (PKCE). */
export function GoogleSignInButton() {
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [hasFailed, setHasFailed] = useState(false);

  async function signIn() {
    setIsRedirecting(true);
    setHasFailed(false);
    const { error } = await createSupabaseBrowserClient().auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: new URL(AUTH_CALLBACK_PATH, window.location.origin).toString(),
        // Always show Google's account chooser, so another account can be picked.
        queryParams: { prompt: "select_account" },
      },
    });
    if (error) {
      setIsRedirecting(false);
      setHasFailed(true);
    }
  }

  return (
    <div className="space-y-3">
      <Button
        onClick={signIn}
        disabled={isRedirecting}
        aria-busy={isRedirecting}
        className="w-full"
      >
        כניסה עם Google
      </Button>
      <p role="alert" className="text-destructive text-sm">
        {hasFailed ? "לא ניתן להתחיל את הכניסה. נסו שוב." : null}
      </p>
    </div>
  );
}
