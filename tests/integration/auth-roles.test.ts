import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { decideAdminAccess, decideUserAccess } from "@/lib/auth/access";
import { fetchIsAdmin, fetchIsAllowedUser } from "@/lib/auth/roles";

import {
  createAnonClient,
  createServiceRoleClient,
  createSignedInUser,
  deleteUser,
  testEmail,
  type TestUser,
} from "./support/local-supabase";

const TABLE = "allowed_users";
const TEST_DOMAIN_PATTERN = "%@hkmanager.test";

let service: SupabaseClient;
let owner: TestUser;
let admin: TestUser;
let outsider: TestUser;
const createdUserIds: string[] = [];

/** The facts requireAllowedUser()/requireAdmin() gather, from a real session. */
async function factsFor(client: SupabaseClient) {
  const [isAllowed, isAdmin] = await Promise.all([
    fetchIsAllowedUser(client),
    fetchIsAdmin(client),
  ]);
  return { hasUser: true, isAllowed, isAdmin };
}

beforeAll(async () => {
  service = await createServiceRoleClient();
  owner = await createSignedInUser(service, testEmail("roles-owner"));
  createdUserIds.push(owner.id);
  admin = await createSignedInUser(service, testEmail("roles-admin"));
  createdUserIds.push(admin.id);
  outsider = await createSignedInUser(service, testEmail("roles-outsider"));
  createdUserIds.push(outsider.id);

  const { error } = await service.from(TABLE).insert([
    { email: owner.email, role: "owner" },
    { email: admin.email.toUpperCase(), role: "admin" },
  ]);
  if (error) {
    throw new Error("Could not insert allowlist rows", { cause: error });
  }
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

describe("server access checks against real sessions", () => {
  it("AUTH-5: requireAdmin's checks forbid the owner", async () => {
    const facts = await factsFor(owner.client);

    expect(facts).toMatchObject({ isAllowed: true, isAdmin: false });
    expect(decideUserAccess(facts)).toBe("allow");
    expect(decideAdminAccess(facts)).toBe("forbidden");
  });

  it("AUTH-5: requireAdmin's checks allow the admin (allowlist matched case-insensitively)", async () => {
    const facts = await factsFor(admin.client);

    expect(facts).toMatchObject({ isAllowed: true, isAdmin: true });
    expect(decideAdminAccess(facts)).toBe("allow");
  });

  it("AUTH-2: an account outside the allowlist is unauthorized", async () => {
    const facts = await factsFor(outsider.client);

    expect(facts).toMatchObject({ isAllowed: false, isAdmin: false });
    expect(decideUserAccess(facts)).toBe("unauthorized");
    expect(decideAdminAccess(facts)).toBe("unauthorized");
  });

  it("AUTH-2: the role checks throw instead of answering when the call fails", async () => {
    // anon has no EXECUTE on the helpers (M0.2), so the RPC returns an error.
    const anon = await createAnonClient();

    await expect(fetchIsAllowedUser(anon)).rejects.toThrow("Could not check is_allowed_user");
    await expect(fetchIsAdmin(anon)).rejects.toThrow("Could not check is_admin");
  });
});
