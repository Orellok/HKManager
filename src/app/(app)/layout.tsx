import { requireAllowedUser } from "@/lib/auth/guards";

/**
 * AUTH-3: every screen in this group needs a verified, allowlisted session. src/proxy.ts
 * checks first; this server-side check also covers requests the proxy does not see
 * (e.g. prefetches) so no data renders without a valid session.
 */
export default async function ProtectedLayout({ children }: LayoutProps<"/">) {
  await requireAllowedUser();
  return children;
}
