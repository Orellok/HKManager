import { redirect } from "next/navigation";

import { HOME_PATH } from "@/lib/auth/access";
import { getUserAccess } from "@/lib/auth/guards";
import { SIGN_IN_ERROR_PARAM, SIGN_IN_ERROR_VALUE } from "@/lib/auth/sign-in-error";

import { GoogleSignInButton } from "./google-sign-in-button";

/** AUTH-1: the only way in. Reveals nothing about the business (SPEC section 8). */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  // A signed-in, allowlisted user has nothing to do here. Anyone else (no session, or a
  // session outside the allowlist) sees the login screen.
  if ((await getUserAccess()).decision === "allow") {
    redirect(HOME_PATH);
  }
  const signInFailed = (await searchParams)[SIGN_IN_ERROR_PARAM] === SIGN_IN_ERROR_VALUE;

  return (
    <section className="mx-auto w-full max-w-sm space-y-6 pt-8">
      <h1 className="text-2xl font-semibold">כניסה</h1>
      {signInFailed ? (
        <p role="alert" className="text-destructive text-sm">
          הכניסה לא הושלמה. ייתכן שהחשבון אינו מורשה להיכנס למערכת.
        </p>
      ) : null}
      <GoogleSignInButton />
    </section>
  );
}
