import { SignOutForm } from "@/components/sign-out-form";

/** AUTH-2: shown after the session of an account outside the allowlist was deleted. */
export default function UnauthorizedPage() {
  return (
    <section className="mx-auto w-full max-w-sm space-y-4 pt-8">
      <h1 className="text-2xl font-semibold">אין הרשאה</h1>
      <p className="text-muted-foreground">החשבון הזה אינו מורשה להיכנס למערכת.</p>
      <SignOutForm label="כניסה עם חשבון אחר" variant="primary" />
    </section>
  );
}
