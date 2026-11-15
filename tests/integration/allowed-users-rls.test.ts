import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
const INSUFFICIENT_PRIVILEGE = "42501";
const UNIQUE_VIOLATION = "23505";

type AllowedUserRow = {
  id: string;
  email: string;
  role: "owner" | "admin";
  created_at: string;
  updated_at: string;
  created_by: string | null;
};

let service: SupabaseClient;
let anon: SupabaseClient;
let outsider: TestUser;
let owner: TestUser;
let admin: TestUser;
let target: AllowedUserRow;
const createdUserIds: string[] = [];

async function insertAllowlistRow(email: string, role: AllowedUserRow["role"]) {
  const { data, error } = await service
    .from(TABLE)
    .insert({ email, role })
    .select()
    .single<AllowedUserRow>();
  if (error) {
    throw new Error(`Could not insert allowlist row for ${email}`, { cause: error });
  }
  return data;
}

async function readRowAsService(id: string): Promise<AllowedUserRow | null> {
  const { data, error } = await service
    .from(TABLE)
    .select()
    .eq("id", id)
    .maybeSingle<AllowedUserRow>();
  if (error) {
    throw new Error(`Could not read allowlist row ${id}`, { cause: error });
  }
  return data;
}

async function callHelper(client: SupabaseClient, name: "is_allowed_user" | "is_admin") {
  return client.rpc(name);
}

beforeAll(async () => {
  service = await createServiceRoleClient();
  anon = await createAnonClient();

  outsider = await createSignedInUser(service, testEmail("outsider"));
  owner = await createSignedInUser(service, testEmail("owner"));
  admin = await createSignedInUser(service, testEmail("admin"));
  createdUserIds.push(outsider.id, owner.id, admin.id);

  // Stored in a different case from the auth email to prove the match is case-insensitive.
  await insertAllowlistRow(owner.email.toUpperCase(), "owner");
  await insertAllowlistRow(admin.email, "admin");
  target = await insertAllowlistRow(testEmail("target"), "owner");
});

afterAll(async () => {
  if (service) {
    const { error } = await service.from(TABLE).delete().ilike("email", TEST_DOMAIN_PATTERN);
    for (const userId of createdUserIds) {
      await deleteUser(service, userId);
    }
    if (error) {
      throw new Error("Could not clean up allowlist test rows", { cause: error });
    }
  }
});

describe("allowed_users schema", () => {
  it("AUTH-4: rejects an email that differs from an existing one only by case", async () => {
    const { error } = await service
      .from(TABLE)
      .insert({ email: target.email.toUpperCase(), role: "admin" });

    expect(error?.code).toBe(UNIQUE_VIOLATION);
  });

  it("AUTH-4: rejects a role outside app_role", async () => {
    const { error } = await service
      .from(TABLE)
      .insert({ email: testEmail("bad-role"), role: "viewer" });

    expect(error).not.toBeNull();
  });
});

describe("allowed_users RLS: anon", () => {
  it("AUTH-4: anon cannot read the allowlist", async () => {
    const { data, error } = await anon.from(TABLE).select();

    expect(error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(data).toBeNull();
  });

  it("AUTH-4: anon cannot insert into the allowlist", async () => {
    const email = testEmail("anon-insert");
    const { error } = await anon.from(TABLE).insert({ email, role: "admin" });

    expect(error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it("AUTH-4: anon cannot update or delete allowlist rows", async () => {
    const update = await anon.from(TABLE).update({ role: "admin" }).eq("id", target.id);
    const remove = await anon.from(TABLE).delete().eq("id", target.id);

    expect(update.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(remove.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await readRowAsService(target.id)).toEqual(target);
  });

  it("AUTH-4: anon cannot execute the authorization helpers", async () => {
    const isAllowed = await callHelper(anon, "is_allowed_user");
    const isAdmin = await callHelper(anon, "is_admin");

    expect(isAllowed.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(isAdmin.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });
});

describe("allowed_users RLS: authenticated user not in the allowlist", () => {
  it("AUTH-4: helpers report the user as neither allowed nor admin", async () => {
    expect((await callHelper(outsider.client, "is_allowed_user")).data).toBe(false);
    expect((await callHelper(outsider.client, "is_admin")).data).toBe(false);
  });

  it("AUTH-4: cannot read any allowlist row", async () => {
    const { data, error } = await outsider.client.from(TABLE).select();

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("AUTH-4: cannot add itself to the allowlist", async () => {
    const { error } = await outsider.client
      .from(TABLE)
      .insert({ email: outsider.email, role: "admin" });

    expect(error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it("AUTH-4: cannot update or delete allowlist rows", async () => {
    const update = await outsider.client
      .from(TABLE)
      .update({ role: "admin" })
      .eq("id", target.id)
      .select();
    const remove = await outsider.client.from(TABLE).delete().eq("id", target.id).select();

    expect(update.data).toEqual([]);
    expect(remove.data).toEqual([]);
    expect(await readRowAsService(target.id)).toEqual(target);
  });
});

describe("allowed_users RLS: owner", () => {
  it("AUTH-4: owner is allowed but not admin, matched case-insensitively", async () => {
    expect((await callHelper(owner.client, "is_allowed_user")).data).toBe(true);
    expect((await callHelper(owner.client, "is_admin")).data).toBe(false);
  });

  it("AUTH-4: owner can read the allowlist", async () => {
    const { data, error } = await owner.client.from(TABLE).select();

    expect(error).toBeNull();
    const emails = (data ?? []).map((row: AllowedUserRow) => row.email.toLowerCase());
    expect(emails).toEqual(expect.arrayContaining([owner.email, admin.email, target.email]));
  });

  it("AUTH-4: owner cannot insert into the allowlist", async () => {
    const { error } = await owner.client
      .from(TABLE)
      .insert({ email: testEmail("owner-insert"), role: "owner" });

    expect(error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it("AUTH-4: owner cannot update or delete allowlist rows", async () => {
    const update = await owner.client
      .from(TABLE)
      .update({ role: "admin" })
      .eq("id", target.id)
      .select();
    const remove = await owner.client.from(TABLE).delete().eq("id", target.id).select();

    expect(update.error).toBeNull();
    expect(update.data).toEqual([]);
    expect(remove.error).toBeNull();
    expect(remove.data).toEqual([]);
    expect(await readRowAsService(target.id)).toEqual(target);
  });
});

describe("allowed_users RLS: admin", () => {
  it("AUTH-4: admin is allowed and admin", async () => {
    expect((await callHelper(admin.client, "is_allowed_user")).data).toBe(true);
    expect((await callHelper(admin.client, "is_admin")).data).toBe(true);
  });

  it("AUTH-4: admin can read the allowlist", async () => {
    const { data, error } = await admin.client.from(TABLE).select().eq("id", target.id);

    expect(error).toBeNull();
    expect(data).toEqual([target]);
  });

  it("AUTH-4: admin can insert, and created_by records the admin", async () => {
    const email = testEmail("admin-insert");
    const { data, error } = await admin.client
      .from(TABLE)
      .insert({ email, role: "owner" })
      .select()
      .single<AllowedUserRow>();

    expect(error).toBeNull();
    expect(data).toMatchObject({ email, role: "owner", created_by: admin.id });
  });

  it("AUTH-4: admin can update, and updated_at is maintained", async () => {
    const row = await insertAllowlistRow(testEmail("admin-update"), "owner");

    const { data, error } = await admin.client
      .from(TABLE)
      .update({ role: "admin" })
      .eq("id", row.id)
      .select()
      .single<AllowedUserRow>();

    expect(error).toBeNull();
    expect(data?.role).toBe("admin");
    expect(data?.created_at).toBe(row.created_at);
    expect(Date.parse(data?.updated_at ?? "")).toBeGreaterThan(Date.parse(row.updated_at));
  });

  it("AUTH-4: admin can delete", async () => {
    const row = await insertAllowlistRow(testEmail("admin-delete"), "owner");

    const { data, error } = await admin.client.from(TABLE).delete().eq("id", row.id).select();

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(await readRowAsService(row.id)).toBeNull();
  });
});
