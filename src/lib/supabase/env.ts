/**
 * Public Supabase settings (SPEC section 7). Both values are safe in the browser: access is
 * enforced by RLS. The service role key is never read here.
 *
 * `process.env.NEXT_PUBLIC_*` must be referenced literally so Next.js can inline the values
 * into the browser bundle.
 */
export type SupabasePublicEnv = { url: string; anonKey: string };

export function getSupabasePublicEnv(): SupabasePublicEnv {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set (see .env.example)",
    );
  }
  return { url, anonKey };
}
