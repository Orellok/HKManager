import { randomUUID } from "node:crypto";

import { test as base, type BrowserContext } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getLocalSupabaseEnv } from "../../support/local-supabase-env";

/**
 * Test-only sessions for E2E, without Google: a user is created through the local admin API
 * (which bypasses the before-user-created hook), signed in with a password, and the session
 * cookies are written by @supabase/ssr itself, so they have exactly the format the app reads.
 * Nothing here ships in the app.
 */

type AllowlistRole = "owner" | "admin";

export type TestAccount = { id: string; email: string };

type SessionOptions = {
  /** Allowlist role of the new account, or null for an account outside the allowlist. */
  role: AllowlistRole | null;
};

type AuthFixtures = {
  /** Creates a local test account and signs the page's browser context in as it. */
  signIn: (options: SessionOptions) => Promise<TestAccount>;
};

const NON_PERSISTENT_AUTH = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
} as const;

export function createServiceRoleClient(): SupabaseClient {
  const { url, serviceRoleKey } = getLocalSupabaseEnv();
  return createClient(url, serviceRoleKey, NON_PERSISTENT_AUTH);
}

/** Signs in with a password and returns the auth cookies @supabase/ssr would set. */
async function sessionCookies(email: string, password: string) {
  const { url, anonKey } = getLocalSupabaseEnv();
  const jar = new Map<string, { value: string; maxAge?: number }>();
  const client = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => [...jar].map(([name, { value }]) => ({ name, value })),
      setAll: (cookiesToSet) => {
        for (const { name, value, options } of cookiesToSet) {
          if (options.maxAge === 0) {
            jar.delete(name);
          } else {
            jar.set(name, { value, maxAge: options.maxAge });
          }
        }
      },
    },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(`Could not sign in test user ${email}`, { cause: error });
  }
  if (jar.size === 0) {
    throw new Error("Signing in did not produce any auth cookie");
  }
  return [...jar].map(([name, { value, maxAge }]) => ({ name, value, maxAge }));
}

async function addSessionToContext(
  context: BrowserContext,
  baseURL: string,
  cookies: Awaited<ReturnType<typeof sessionCookies>>,
) {
  const nowInSeconds = Math.floor(Date.now() / 1000);
  await context.addCookies(
    cookies.map(({ name, value, maxAge }) => ({
      name,
      value,
      url: baseURL,
      sameSite: "Lax" as const,
      expires: maxAge ? nowInSeconds + maxAge : -1,
    })),
  );
}

export const test = base.extend<AuthFixtures>({
  signIn: async ({ context, baseURL }, provide) => {
    if (!baseURL) {
      throw new Error("baseURL must be configured for the signIn fixture");
    }
    const service = createServiceRoleClient();
    const accounts: TestAccount[] = [];

    await provide(async ({ role }) => {
      const email = `e2e-${randomUUID()}@hkmanager.test`;
      const password = randomUUID();
      const { data, error } = await service.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error) {
        throw new Error(`Could not create test user ${email}`, { cause: error });
      }
      const account = { id: data.user.id, email };
      accounts.push(account);

      if (role) {
        const { error: insertError } = await service.from("allowed_users").insert({ email, role });
        if (insertError) {
          throw new Error(`Could not allowlist ${email}`, { cause: insertError });
        }
      }

      await addSessionToContext(context, baseURL, await sessionCookies(email, password));
      return account;
    });

    const cleanupErrors: unknown[] = [];
    for (const account of accounts) {
      const { error } = await service.from("allowed_users").delete().eq("email", account.email);
      if (error) {
        cleanupErrors.push(error);
      }
      const { error: deleteError } = await service.auth.admin.deleteUser(account.id);
      if (deleteError) {
        cleanupErrors.push(deleteError);
      }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, "Could not clean up E2E test accounts");
    }
  },
});

export { expect } from "@playwright/test";
