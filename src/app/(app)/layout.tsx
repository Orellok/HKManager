import { requireAllowedUser } from "@/lib/auth/guards";

/**
 * Keeps the shell of protected screens from rendering without a verified, allowlisted
 * session. This is NOT a page guard: in the App Router a layout and its pages render in
 * parallel, so a redirect here does not stop a page from rendering. Every page, Server
 * Function and Route Handler that loads or changes data must call requireAllowedUser()
 * (or requireAdmin()) itself. src/proxy.ts is the first check on every request.
 */
export default async function ProtectedLayout({ children }: LayoutProps<"/">) {
  await requireAllowedUser();
  return children;
}
