import { randomUUID } from "node:crypto";

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

const TABLE = "clients";
const INSUFFICIENT_PRIVILEGE = "42501";
const CHECK_VIOLATION = "23514";
/** Every client this file creates has this marker in its notes, for cleanup. */
const MARKER = `it-clients-${randomUUID()}`;

type ClientRow = {
  id: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  archived_at: string | null;
  phone_digits: string;
};

let service: SupabaseClient;
let anon: SupabaseClient;
let outsider: TestUser;
let owner: TestUser;
let admin: TestUser;
let target: ClientRow;
const createdUserIds: string[] = [];

/** A unique name, so tests do not see each other's rows or leftovers. */
function uniqueName(label: string): string {
  return `${label} ${randomUUID()}`;
}

async function insertAsService(fields: Partial<ClientRow>): Promise<ClientRow> {
  const { data, error } = await service
    .from(TABLE)
    .insert({ name: uniqueName("לקוח"), notes: MARKER, ...fields })
    .select()
    .single<ClientRow>();
  if (error) {
    throw new Error("Could not insert a test client", { cause: error });
  }
  return data;
}

async function readAsService(id: string): Promise<ClientRow | null> {
  const { data, error } = await service.from(TABLE).select().eq("id", id).maybeSingle<ClientRow>();
  if (error) {
    throw new Error(`Could not read client ${id}`, { cause: error });
  }
  return data;
}

beforeAll(async () => {
  service = await createServiceRoleClient();
  anon = await createAnonClient();

  outsider = await createSignedInUser(service, testEmail("clients-outsider"));
  createdUserIds.push(outsider.id);
  owner = await createSignedInUser(service, testEmail("clients-owner"));
  createdUserIds.push(owner.id);
  admin = await createSignedInUser(service, testEmail("clients-admin"));
  createdUserIds.push(admin.id);

  const { error } = await service.from("allowed_users").insert([
    { email: owner.email, role: "owner" },
    { email: admin.email, role: "admin" },
  ]);
  if (error) {
    throw new Error("Could not allowlist the test users", { cause: error });
  }
  target = await insertAsService({ phone: "050-111-2222" });
});

afterAll(async () => {
  if (!service) {
    return;
  }
  const cleanupErrors: unknown[] = [];
  const clients = await service.from(TABLE).delete().eq("notes", MARKER);
  if (clients.error) {
    cleanupErrors.push(clients.error);
  }
  const allowlist = await service
    .from("allowed_users")
    .delete()
    .in("email", [owner?.email, admin?.email].filter(Boolean));
  if (allowlist.error) {
    cleanupErrors.push(allowlist.error);
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
});

describe("clients RLS: anon", () => {
  it("CLI-1: anon cannot select clients", async () => {
    const { data, error } = await anon.from(TABLE).select();

    expect(error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(data).toBeNull();
  });

  it("CLI-1: anon cannot insert a client", async () => {
    const { error } = await anon.from(TABLE).insert({ name: uniqueName("anon"), notes: MARKER });

    expect(error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it("CLI-1: anon cannot update a client", async () => {
    const { error } = await anon.from(TABLE).update({ name: "changed" }).eq("id", target.id);

    expect(error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await readAsService(target.id)).toEqual(target);
  });

  it("CLI-2: anon cannot delete a client", async () => {
    const { error } = await anon.from(TABLE).delete().eq("id", target.id);

    expect(error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await readAsService(target.id)).toEqual(target);
  });

  it("CLI-3: anon cannot call the search or duplicate functions", async () => {
    const search = await anon.rpc("search_clients", { p_archived: false });
    const duplicates = await anon.rpc("find_clients_by_name_key", { p_name_key: "x" });

    expect(search.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(duplicates.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });
});

describe("clients RLS: authenticated user not in the allowlist", () => {
  it("CLI-1: cannot select any client", async () => {
    const { data, error } = await outsider.client.from(TABLE).select();

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("CLI-1: cannot insert a client", async () => {
    const name = uniqueName("outsider");
    const { error } = await outsider.client.from(TABLE).insert({ name, notes: MARKER });

    expect(error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    const { data } = await service.from(TABLE).select("id").eq("name", name);
    expect(data).toEqual([]);
  });

  it("CLI-1: cannot update a client", async () => {
    const { data, error } = await outsider.client
      .from(TABLE)
      .update({ name: "changed" })
      .eq("id", target.id)
      .select();

    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect(await readAsService(target.id)).toEqual(target);
  });

  it("CLI-2: cannot delete a client", async () => {
    const { data, error } = await outsider.client.from(TABLE).delete().eq("id", target.id).select();

    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect(await readAsService(target.id)).toEqual(target);
  });

  it("CLI-3: search and duplicate lookup return nothing", async () => {
    const search = await outsider.client.rpc("search_clients", {
      p_archived: false,
      p_name_query: target.name,
    });
    const duplicates = await outsider.client.rpc("find_clients_by_name_key", {
      p_name_key: target.name.toLowerCase(),
    });

    expect(search.data).toEqual([]);
    expect(duplicates.data).toEqual([]);
  });
});

for (const role of ["owner", "admin"] as const) {
  const user = () => (role === "owner" ? owner : admin);

  describe(`clients RLS: ${role}`, () => {
    it(`CLI-1: ${role} can select a client`, async () => {
      const { data, error } = await user().client.from(TABLE).select().eq("id", target.id);

      expect(error).toBeNull();
      expect(data).toEqual([target]);
    });

    it(`CLI-1: ${role} can insert a client; the database sets created_by`, async () => {
      const name = uniqueName(role);
      const { data, error } = await user()
        .client.from(TABLE)
        .insert({ name, phone: "+972 50-123 4567", notes: MARKER })
        .select()
        .single<ClientRow>();

      expect(error).toBeNull();
      expect(data).toMatchObject({
        name,
        created_by: user().id,
        archived_at: null,
        phone_digits: "972501234567",
      });
    });

    it(`CLI-1: ${role} cannot choose created_by or id`, async () => {
      const spoofedBy = await user()
        .client.from(TABLE)
        .insert({ name: uniqueName(role), notes: MARKER, created_by: outsider.id });
      const spoofedId = await user()
        .client.from(TABLE)
        .insert({ name: uniqueName(role), notes: MARKER, id: randomUUID() });

      expect(spoofedBy.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
      expect(spoofedId.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    });

    it(`CLI-1: ${role} can update a client; updated_at is maintained`, async () => {
      const row = await insertAsService({});

      const { data, error } = await user()
        .client.from(TABLE)
        .update({ phone: "03-555-6666" })
        .eq("id", row.id)
        .select()
        .single<ClientRow>();

      expect(error).toBeNull();
      expect(data).toMatchObject({ phone: "03-555-6666", phone_digits: "035556666" });
      expect(data?.created_at).toBe(row.created_at);
      expect(Date.parse(data?.updated_at ?? "")).toBeGreaterThan(Date.parse(row.updated_at));
    });

    it(`CLI-2: ${role} can archive and restore a client`, async () => {
      const row = await insertAsService({});
      const archivedAt = new Date().toISOString();

      const archived = await user()
        .client.from(TABLE)
        .update({ archived_at: archivedAt })
        .eq("id", row.id)
        .select()
        .single<ClientRow>();
      const restored = await user()
        .client.from(TABLE)
        .update({ archived_at: null })
        .eq("id", row.id)
        .select()
        .single<ClientRow>();

      expect(Date.parse(archived.data?.archived_at ?? "")).toBe(Date.parse(archivedAt));
      expect(restored.data?.archived_at).toBeNull();
    });

    it(`CLI-2: ${role} can delete a client`, async () => {
      const row = await insertAsService({});

      const { data, error } = await user().client.from(TABLE).delete().eq("id", row.id).select();

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(await readAsService(row.id)).toBeNull();
    });
  });
}

describe("clients schema", () => {
  it.each([
    ["an empty name", { name: "" }],
    ["an untrimmed name", { name: " דנה " }],
    ["a name over 120 characters", { name: "א".repeat(121) }],
    ["an empty optional field", { phone: "" }],
    ["a phone with letters", { phone: "050-abc" }],
    ["an email without @", { email: "dana.example.com" }],
    ["notes over 2000 characters", { notes: "ג".repeat(2001) }],
  ])("CLI-1: the database rejects %s", async (_case, fields) => {
    const { error } = await owner.client
      .from(TABLE)
      .insert({ name: uniqueName("schema"), notes: MARKER, ...fields });

    expect(error?.code).toBe(CHECK_VIOLATION);
  });
});

describe("search_clients", () => {
  const searchKey = randomUUID().slice(0, 8);
  let active: ClientRow;
  let other: ClientRow;
  let archived: ClientRow;

  beforeAll(async () => {
    active = await insertAsService({ name: `Dana ${searchKey} לוי`, phone: "050-123-4567" });
    other = await insertAsService({ name: `Other ${searchKey}`, phone: "03 765 4321" });
    archived = await insertAsService({
      name: `Archived ${searchKey}`,
      phone: "052-999-8888",
      archived_at: new Date().toISOString(),
    });
  });

  async function search(args: Record<string, unknown>) {
    const { data, error } = await owner.client.rpc("search_clients", args);
    expect(error).toBeNull();
    return (data as ClientRow[]).map((row) => row.id);
  }

  it("CLI-3: finds clients by a case-insensitive name substring", async () => {
    expect(
      await search({ p_archived: false, p_name_query: `dana ${searchKey.toUpperCase()}` }),
    ).toEqual([active.id]);
  });

  it("CLI-3: phone search ignores separators (0501234567 finds 050-123-4567)", async () => {
    const ids = await search({ p_archived: false, p_name_query: "", p_phone_digits: "0501234567" });

    expect(ids).toContain(active.id);
    expect(ids).not.toContain(other.id);
  });

  it("CLI-3: phone search matches part of the number", async () => {
    expect(await search({ p_archived: false, p_phone_digits: "7654321" })).toContain(other.id);
  });

  it("CLI-3: LIKE wildcards in the name query match literally", async () => {
    expect(await search({ p_archived: false, p_name_query: `${searchKey}%` })).toEqual([]);
    expect(await search({ p_archived: false, p_name_query: `Dana_${searchKey}` })).toEqual([]);
  });

  it("CLI-3: non-digit phone input is ignored rather than used as a pattern", async () => {
    expect(
      await search({ p_archived: false, p_name_query: searchKey, p_phone_digits: "%" }),
    ).toEqual([active.id, other.id]);
  });

  it("CLI-2: archived clients appear only in the archive", async () => {
    expect(await search({ p_archived: false, p_name_query: searchKey })).not.toContain(archived.id);
    expect(await search({ p_archived: true, p_name_query: searchKey })).toEqual([archived.id]);
  });

  it("CLI-3: results are ordered by name and paged with limit and offset", async () => {
    const first = await search({ p_archived: false, p_name_query: searchKey, p_limit: 1 });
    const second = await search({
      p_archived: false,
      p_name_query: searchKey,
      p_limit: 1,
      p_offset: 1,
    });

    expect([...first, ...second]).toEqual([active.id, other.id]);
  });

  it("CLI-3: returns at most 100 rows even when more match", async () => {
    const bulkKey = `bulk-${randomUUID()}`;
    const { error: seedError } = await service.from(TABLE).insert(
      Array.from({ length: 101 }, (_, index) => ({
        name: `${bulkKey} ${String(index).padStart(3, "0")}`,
        notes: MARKER,
      })),
    );
    expect(seedError).toBeNull();

    const { data, error } = await owner.client.rpc("search_clients", {
      p_archived: false,
      p_name_query: bulkKey,
      p_limit: 1_000_000,
    });

    expect(error).toBeNull();
    expect((data as ClientRow[]).length).toBe(100);
  });
});

describe("find_clients_by_name_key", () => {
  it("CLI-1: finds clients with the same name regardless of case, archived ones included", async () => {
    const base = `Duplicate ${randomUUID()}`;
    const first = await insertAsService({ name: base });
    const second = await insertAsService({
      name: base.toUpperCase(),
      archived_at: new Date().toISOString(),
    });

    const { data, error } = await owner.client.rpc("find_clients_by_name_key", {
      p_name_key: base.toLowerCase(),
    });

    expect(error).toBeNull();
    expect((data as ClientRow[]).map((row) => row.id)).toEqual([first.id, second.id]);
  });

  it("CLI-1: excludes the client being edited", async () => {
    const row = await insertAsService({ name: `Single ${randomUUID()}` });

    const { data } = await owner.client.rpc("find_clients_by_name_key", {
      p_name_key: row.name.toLowerCase(),
      p_exclude_id: row.id,
    });

    expect(data).toEqual([]);
  });
});
