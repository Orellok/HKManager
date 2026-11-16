import { Button } from "@/components/button";
import { signOut } from "@/lib/auth/actions";

type SignOutFormProps = {
  label: string;
  variant?: "primary" | "secondary";
};

/** A form posting to the signOut Server Function; works before hydration and without JS. */
export function SignOutForm({ label, variant = "secondary" }: SignOutFormProps) {
  return (
    <form action={signOut}>
      <Button type="submit" variant={variant}>
        {label}
      </Button>
    </form>
  );
}
