import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createAnonClient,
  createServiceRoleClient,
  deleteUser,
  queryLocalDatabase,
  testEmail,
} from "./support/local-supabase";
import { runSqlAsRole, type DatabaseRole } from "./support/sql-as-role";

const TABLE = "allowed_users";
const TEST_DOMAIN_PATTERN = "%@hkmanager.test";
const INSUFFICIENT_PRIVILEGE = "42501";
const HOOK_REJECTED_STATUS = 403;
const NOT_ALLOWED_MESSAGE = "This account is not allowed to access the app.";
const GOOGLE_ONLY_MESSAGE = "Sign-up is available with Google only.";

type HookResponse = { error?: { http_code: number; message: string } };

let service: SupabaseClient;
let anon: SupabaseClient;
let allowlistedEmail: string;
const createdUserIds: string[] = [];

function userCreatedEvent(user: Record<string, unknown>) {
  return {
    metadata: {
      uuid: "00000000-0000-4000-8000-000000000000",
      time: "2026-11-15T00:00:00Z",
      name: "before-user-created",
      ip_address: "127.0.0.1",
    },
    user: { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", ...user },
  };
}

function googleUser(email: unknown) {
  return userCreatedEvent({
    email,
    app_metadata: { provider: "google", providers: ["google"] },
  });
}

/** Calls the hook the way Supabase Auth does: as supabase_auth_admin. */
async function callHook(event: unknown, role: DatabaseRole = "supabase_auth_admin") {
  const literal = JSON.stringify(event).replaceAll("'", "''");
  return runSqlAsRole<{ response: HookResponse }>({
    role,
    sql: `select public.hook_before_user_created('${literal}'::jsonb) as response`,
  });
}

async function expectHookResponse(event: unknown): Promise<HookResponse> {
  const result = await callHook(event);
  if (!result.ok) {
    throw new Error(`Hook call failed: ${result.sqlState} ${result.message}`);
  }
  return result.rows[0].response;
}

async function insertAllowlistRow(email: string) {
  const { error } = await service.from(TABLE).insert({ email, role: "owner" });
  if (error) {
    throw new Error(`Could not insert allowlist row for ${email}`, { cause: error });
  }
}

async function countAuthUsers(email: string): Promise<number> {
  const rows = await queryLocalDatabase<{ count: number }>(
    `select count(*)::int as count from auth.users where lower(email) = lower('${email}')`,
  );
  return rows[0].count;
}

beforeAll(async () => {
  service = await createServiceRoleClient();
  anon = await createAnonClient();
  allowlistedEmail = testEmail("hook-allowed");
  await insertAllowlistRow(allowlistedEmail);
});

afterAll(async () => {
  if (service) {
    const cleanupErrors: unknown[] = [];
    const { error } = await service.from(TABLE).delete().ilike("email", TEST_DOMAIN_PATTERN);
    if (error) {
      cleanupErrors.push(error);
    }
    for (const userId of createdUserIds) {
      try {
        await deleteUser(service, userId);
      } catch (deleteError) {
        cleanupErrors.push(deleteError);
      }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, "Could not clean up integration test data");
    }
  }
});

describe("before-user-created hook: decision", () => {
  it("AUTH-2: allows an allowlisted Google account", async () => {
    expect(await expectHookResponse(googleUser(allowlistedEmail))).toEqual({});
  });

  it("AUTH-2: matches the allowlist case-insensitively", async () => {
    expect(await expectHookResponse(googleUser(allowlistedEmail.toUpperCase()))).toEqual({});
  });

  it("AUTH-2: rejects a Google account outside the allowlist with a 403 hook error", async () => {
    expect(await expectHookResponse(googleUser(testEmail("hook-outsider")))).toEqual({
      error: { http_code: HOOK_REJECTED_STATUS, message: NOT_ALLOWED_MESSAGE },
    });
  });

  it.each([
    ["a missing email", undefined],
    ["a null email", null],
    ["an empty email", ""],
    ["a blank email", "   "],
  ])("AUTH-2: rejects a Google account with %s", async (_case, email) => {
    expect(await expectHookResponse(googleUser(email))).toEqual({
      error: { http_code: HOOK_REJECTED_STATUS, message: NOT_ALLOWED_MESSAGE },
    });
  });

  it.each([
    ["email/password", { provider: "email", providers: ["email"] }],
    ["another OAuth provider", { provider: "github", providers: ["github"] }],
    ["no provider", {}],
  ])("AUTH-2: rejects an allowlisted address signing up with %s", async (_case, appMetadata) => {
    const event = userCreatedEvent({ email: allowlistedEmail, app_metadata: appMetadata });

    expect(await expectHookResponse(event)).toEqual({
      error: { http_code: HOOK_REJECTED_STATUS, message: GOOGLE_ONLY_MESSAGE },
    });
  });

  it.each([
    ["plus-addressing", "first.last+tag-{id}@hkmanager.test"],
    ["a subdomain", "first.last-{id}@mail.sub.hkmanager.test"],
  ])("AUTH-2: allowlist accepts and the hook allows an address with %s", async (_case, pattern) => {
    const email = pattern.replace("{id}", crypto.randomUUID());
    const domainPattern = `%${email.slice(email.indexOf("@"))}`;
    try {
      await insertAllowlistRow(email);

      expect(await expectHookResponse(googleUser(email.toUpperCase()))).toEqual({});
    } finally {
      await service.from(TABLE).delete().ilike("email", domainPattern);
    }
  });
});

describe("before-user-created hook: privileges", () => {
  it.each(["anon", "authenticated", "service_role"] as const)(
    "AUTH-2: %s cannot execute the hook function",
    async (role) => {
      const result = await callHook(googleUser(allowlistedEmail), role);

      expect(result).toMatchObject({ ok: false, sqlState: INSUFFICIENT_PRIVILEGE });
    },
  );
});

describe("before-user-created hook: wired into local Supabase Auth", () => {
  it("AUTH-2: self sign-up of an address outside the allowlist is rejected and no user is created", async () => {
    const email = testEmail("signup-outsider");

    const { data, error } = await anon.auth.signUp({ email, password: crypto.randomUUID() });

    expect(error?.status).toBe(HOOK_REJECTED_STATUS);
    expect(error?.message).toBe(GOOGLE_ONLY_MESSAGE);
    expect(data.user).toBeNull();
    expect(await countAuthUsers(email)).toBe(0);
  });

  it("AUTH-2: email/password sign-up is rejected even for an allowlisted address", async () => {
    const { error } = await anon.auth.signUp({
      email: allowlistedEmail.toUpperCase(),
      password: crypto.randomUUID(),
    });

    expect(error?.status).toBe(HOOK_REJECTED_STATUS);
    expect(error?.message).toBe(GOOGLE_ONLY_MESSAGE);
    expect(await countAuthUsers(allowlistedEmail)).toBe(0);
  });

  it("AUTH-2: the admin API (service role, server-side only) can still create local test users", async () => {
    const email = testEmail("admin-created");

    const { data, error } = await service.auth.admin.createUser({
      email,
      password: crypto.randomUUID(),
      email_confirm: true,
    });
    if (data.user) {
      createdUserIds.push(data.user.id);
    }

    expect(error).toBeNull();
    expect(await countAuthUsers(email)).toBe(1);
  });
});
