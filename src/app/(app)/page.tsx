import { requireAllowedUser } from "@/lib/auth/guards";

export default async function HomePage() {
  // AUTH-3: every page checks the session itself (see the (app) layout).
  await requireAllowedUser();

  return <h1 className="text-2xl font-semibold">דף הבית</h1>;
}
