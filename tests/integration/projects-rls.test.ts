import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CLIENT_OPTIONS_LIMIT, listActiveClientOptions } from "@/lib/projects/queries";

import {
  createAnonClient,
  createServiceRoleClient,
  createSignedInUser,
  deleteUser,
  testEmail,
  type TestUser,
} from "./support/local-supabase";

const TABLE = "projects";
const INSUFFICIENT_PRIVILEGE = "42501";
const CHECK_VIOLATION = "23514";
const FOREIGN_KEY_VIOLATION = "23503";
/** Raised by projects_require_active_client() (owner decision: no project for an archived client). */
const CLIENT_ARCHIVED = "HKA01";
const MAX_AGOROT = 9_999_999_999;
/** Every client and project this file creates has this marker in its notes, for cleanup. */
const MARKER = `it-projects-${randomUUID()}`;

type ProjectRow = {
  id: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  client_id: string;
  name: string;
  property_address: string | null;
  status: string;
  contract_amount: number | null;
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
  archived_at: string | null;
};

type SearchRow = {
  id: string;
  name: string;
  status: string;
  contract_amount: number | null;
  updated_at: string;
  client_id: string;
  client_name: string;
};

let service: SupabaseClient;
let anon: SupabaseClient;
let outsider: TestUser;
let owner: TestUser;
let admin: TestUser;
let client: { id: string; name: string };
let target: ProjectRow;
const createdUserIds: string[] = [];

function uniqueName(label: string): string {
  return `${label} ${randomUUID()}`;
}

async function insertClient(fields: Record<string, unknown> = {}) {
  const { data, error } = await service
    .from("clients")
    .insert({ name: uniqueName("לקוח"), notes: MARKER, ...fields })
    .select("id, name")
    .single<{ id: string; name: string }>();
  if (error) {
    throw new Error("Could not insert a test client", { cause: error });
  }
  return data;
}

async function insertProject(fields: Partial<ProjectRow> = {}): Promise<ProjectRow> {
  const { data, error } = await service
    .from(TABLE)
    .insert({ client_id: client.id, name: uniqueName("פרויקט"), notes: MARKER, ...fields })
    .select()
    .single<ProjectRow>();
  if (error) {
    throw new Error("Could not insert a test project", { cause: error });
  }
  return data;
}

async function readProject(id: string): Promise<ProjectRow | null> {
  const { data, error } = await service.from(TABLE).select().eq("id", id).maybeSingle<ProjectRow>();
  if (error) {
    throw new Error(`Could not read project ${id}`, { cause: error });
  }
  return data;
}

beforeAll(async () => {
  service = await createServiceRoleClient();
  anon = await createAnonClient();

  outsider = await createSignedInUser(service, testEmail("projects-outsider"));
  createdUserIds.push(outsider.id);
  owner = await createSignedInUser(service, testEmail("projects-owner"));
  createdUserIds.push(owner.id);
  admin = await createSignedInUser(service, testEmail("projects-admin"));
  createdUserIds.push(admin.id);

  const { error } = await service.from("allowed_users").insert([
    { email: owner.email, role: "owner" },
    { email: admin.email, role: "admin" },
  ]);
  if (error) {
    throw new Error("Could not allowlist the test users", { cause: error });
  }
  client = await insertClient();
  target = await insertProject({ contract_amount: 1_250_050 });
});

afterAll(async () => {
  if (!service) {
    return;
  }
  const cleanupErrors: unknown[] = [];
  // Projects first: clients are ON DELETE RESTRICT.
  const projects = await service.from(TABLE).delete().eq("notes", MARKER);
  if (projects.error) {
    cleanupErrors.push(projects.error);
  }
  const clients = await service.from("clients").delete().eq("notes", MARKER);
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

describe("projects RLS: anon", () => {
  it("PRJ-1: anon cannot select, insert, update or delete projects", async () => {
    const select = await anon.from(TABLE).select();
    const insert = await anon
      .from(TABLE)
      .insert({ client_id: client.id, name: uniqueName("anon"), notes: MARKER });
    const update = await anon.from(TABLE).update({ name: "changed" }).eq("id", target.id);
    const remove = await anon.from(TABLE).delete().eq("id", target.id);

    expect(select.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(insert.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(update.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(remove.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await readProject(target.id)).toEqual(target);
  });

  it("PRJ-1: anon cannot call search_projects", async () => {
    const { error } = await anon.rpc("search_projects", { p_archived: false });

    expect(error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });
});

describe("projects RLS: authenticated user not in the allowlist", () => {
  it("PRJ-1: cannot select any project", async () => {
    const { data, error } = await outsider.client.from(TABLE).select();

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("PRJ-1: cannot insert a project", async () => {
    const name = uniqueName("outsider");
    const { error } = await outsider.client
      .from(TABLE)
      .insert({ client_id: client.id, name, notes: MARKER });

    expect(error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    const { data } = await service.from(TABLE).select("id").eq("name", name);
    expect(data).toEqual([]);
  });

  it("PRJ-1: cannot update or delete a project", async () => {
    const update = await outsider.client
      .from(TABLE)
      .update({ name: "changed" })
      .eq("id", target.id)
      .select();
    const remove = await outsider.client.from(TABLE).delete().eq("id", target.id).select();

    expect(update.data).toEqual([]);
    expect(remove.data).toEqual([]);
    expect(await readProject(target.id)).toEqual(target);
  });

  it("PRJ-1: search_projects returns nothing", async () => {
    const { data } = await outsider.client.rpc("search_projects", {
      p_archived: false,
      p_query: target.name,
    });

    expect(data).toEqual([]);
  });
});

for (const role of ["owner", "admin"] as const) {
  const user = () => (role === "owner" ? owner : admin);

  describe(`projects RLS: ${role}`, () => {
    it(`PRJ-1: ${role} can select a project; the amount arrives as an exact integer`, async () => {
      const { data, error } = await user().client.from(TABLE).select().eq("id", target.id);

      expect(error).toBeNull();
      expect(data).toEqual([target]);
      expect(data?.[0].contract_amount).toBe(1_250_050);
    });

    it(`PRJ-1: ${role} can insert a project; defaults and created_by come from the database`, async () => {
      const name = uniqueName(role);
      const { data, error } = await user()
        .client.from(TABLE)
        .insert({ client_id: client.id, name, notes: MARKER })
        .select()
        .single<ProjectRow>();

      expect(error).toBeNull();
      expect(data).toMatchObject({
        name,
        status: "lead",
        contract_amount: null,
        created_by: user().id,
        archived_at: null,
      });
    });

    it.each([
      ["created_by", () => outsider.id],
      ["id", () => randomUUID()],
      ["created_at", () => "2000-01-01T00:00:00Z"],
      ["updated_at", () => "2000-01-01T00:00:00Z"],
    ])(`PRJ-1: ${role} cannot set %s`, async (column, value) => {
      const { error } = await user()
        .client.from(TABLE)
        .insert({ client_id: client.id, name: uniqueName(role), notes: MARKER, [column]: value() });

      expect(error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    });

    it(`PRJ-2: ${role} can change the status; updated_at is maintained`, async () => {
      const row = await insertProject({});

      const { data, error } = await user()
        .client.from(TABLE)
        .update({ status: "completed" })
        .eq("id", row.id)
        .select()
        .single<ProjectRow>();

      expect(error).toBeNull();
      expect(data?.status).toBe("completed");
      expect(Date.parse(data?.updated_at ?? "")).toBeGreaterThan(Date.parse(row.updated_at));
    });

    it(`PRJ-1: ${role} can archive, restore and delete a project`, async () => {
      const row = await insertProject({});

      const archived = await user()
        .client.from(TABLE)
        .update({ archived_at: new Date().toISOString() })
        .eq("id", row.id)
        .select()
        .single<ProjectRow>();
      const restored = await user()
        .client.from(TABLE)
        .update({ archived_at: null })
        .eq("id", row.id)
        .select()
        .single<ProjectRow>();
      const removed = await user().client.from(TABLE).delete().eq("id", row.id).select();

      expect(archived.data?.archived_at).not.toBeNull();
      expect(restored.data?.archived_at).toBeNull();
      expect(removed.data).toHaveLength(1);
      expect(await readProject(row.id)).toBeNull();
    });
  });
}

describe("projects schema", () => {
  it.each([
    ["an empty name", { name: "" }],
    ["an untrimmed name", { name: " מטבח " }],
    ["a name over 120 characters", { name: "א".repeat(121) }],
    ["an empty optional field", { property_address: "" }],
    ["an unknown status", { status: "open" }],
    ["a negative amount", { contract_amount: -1 }],
    ["an amount over the maximum", { contract_amount: MAX_AGOROT + 1 }],
    ["an end date before the start date", { start_date: "2027-01-01", end_date: "2026-12-31" }],
    ["a date out of range", { start_date: "1899-12-31" }],
    ["notes over 2000 characters", { notes: "ג".repeat(2001) }],
  ])("PRJ-1: the database rejects %s", async (_case, fields) => {
    const { error } = await owner.client
      .from(TABLE)
      .insert({ client_id: client.id, name: uniqueName("schema"), notes: MARKER, ...fields });

    expect(error?.code).toBe(CHECK_VIOLATION);
  });

  it("PRJ-1: accepts amount 0, the maximum amount and equal dates; dates come back unshifted", async () => {
    const zero = await insertProject({ contract_amount: 0 });
    const max = await insertProject({
      contract_amount: MAX_AGOROT,
      start_date: "2026-12-31",
      end_date: "2026-12-31",
    });

    expect(zero.contract_amount).toBe(0);
    expect(max.contract_amount).toBe(MAX_AGOROT);
    expect(max.start_date).toBe("2026-12-31");
    expect(max.end_date).toBe("2026-12-31");
  });

  it("PRJ-1: a project needs an existing client", async () => {
    const { error } = await owner.client
      .from(TABLE)
      .insert({ client_id: randomUUID(), name: uniqueName("orphan"), notes: MARKER });

    expect(error?.code).toBe(FOREIGN_KEY_VIOLATION);
  });
});

describe("CLI-2: a client with projects cannot be deleted", () => {
  it("CLI-2: deleting a client with a project fails with a foreign key violation", async () => {
    const owned = await insertClient();
    const project = await insertProject({ client_id: owned.id });

    const { error } = await owner.client.from("clients").delete().eq("id", owned.id);

    expect(error?.code).toBe(FOREIGN_KEY_VIOLATION);
    expect(await readProject(project.id)).not.toBeNull();
  });

  it("CLI-2: the client can be deleted once its projects are gone", async () => {
    const owned = await insertClient();
    const project = await insertProject({ client_id: owned.id });
    await owner.client.from(TABLE).delete().eq("id", project.id);

    const { data, error } = await owner.client
      .from("clients")
      .delete()
      .eq("id", owned.id)
      .select("id");

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });
});

describe("owner decision: no new project for an archived client", () => {
  it("PRJ-1: inserting a project for an archived client is refused", async () => {
    const archived = await insertClient({ archived_at: new Date().toISOString() });

    const { error } = await owner.client
      .from(TABLE)
      .insert({ client_id: archived.id, name: uniqueName("archived"), notes: MARKER });

    expect(error?.code).toBe(CLIENT_ARCHIVED);
  });

  it("PRJ-1: the service role is refused too (the rule is in the database)", async () => {
    const archived = await insertClient({ archived_at: new Date().toISOString() });

    const { error } = await service
      .from(TABLE)
      .insert({ client_id: archived.id, name: uniqueName("archived"), notes: MARKER });

    expect(error?.code).toBe(CLIENT_ARCHIVED);
  });

  it("PRJ-1: moving a project to an archived client is refused", async () => {
    const archived = await insertClient({ archived_at: new Date().toISOString() });
    const project = await insertProject({});

    const { error } = await owner.client
      .from(TABLE)
      .update({ client_id: archived.id })
      .eq("id", project.id);

    expect(error?.code).toBe(CLIENT_ARCHIVED);
    expect((await readProject(project.id))?.client_id).toBe(client.id);
  });

  it("PRJ-1: a project of a client archived later can still be edited and archived", async () => {
    const later = await insertClient();
    const project = await insertProject({ client_id: later.id });
    await service
      .from("clients")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", later.id);

    const { data, error } = await owner.client
      .from(TABLE)
      .update({ status: "active", archived_at: new Date().toISOString() })
      .eq("id", project.id)
      .select()
      .single<ProjectRow>();

    expect(error).toBeNull();
    expect(data?.status).toBe("active");
  });

  it("PRJ-1: after restoring the client a project can be created", async () => {
    const restored = await insertClient({ archived_at: new Date().toISOString() });
    await owner.client.from("clients").update({ archived_at: null }).eq("id", restored.id);

    const { error } = await owner.client
      .from(TABLE)
      .insert({ client_id: restored.id, name: uniqueName("restored"), notes: MARKER });

    expect(error).toBeNull();
  });
});

describe("search_projects", () => {
  const searchKey = randomUUID().slice(0, 8);
  let searchClient: { id: string; name: string };
  let lead: ProjectRow;
  let active: ProjectRow;
  let completed: ProjectRow;
  let archivedProject: ProjectRow;

  async function search(args: Record<string, unknown>) {
    const { data, error } = await owner.client.rpc("search_projects", args);
    expect(error).toBeNull();
    return data as SearchRow[];
  }

  async function searchIds(args: Record<string, unknown>) {
    return (await search(args)).map((row) => row.id);
  }

  beforeAll(async () => {
    searchClient = await insertClient({ name: `Client ${searchKey} כהן` });
    // Inserted oldest first; the list is newest update first.
    lead = await insertProject({ client_id: searchClient.id, name: `Lead ${searchKey}` });
    active = await insertProject({
      client_id: searchClient.id,
      name: `Kitchen ${searchKey}`,
      status: "active",
      contract_amount: MAX_AGOROT,
    });
    completed = await insertProject({
      client_id: searchClient.id,
      name: `Done ${searchKey}`,
      status: "completed",
    });
    archivedProject = await insertProject({
      client_id: searchClient.id,
      name: `Old ${searchKey}`,
      archived_at: new Date().toISOString(),
    });
  });

  it("PRJ-1: finds projects by client name, newest update first, with the client name", async () => {
    const rows = await search({ p_archived: false, p_query: `client ${searchKey.toUpperCase()}` });

    expect(rows.map((row) => row.id)).toEqual([completed.id, active.id, lead.id]);
    expect(rows[0].client_name).toBe(searchClient.name);
    expect(rows[1].contract_amount).toBe(MAX_AGOROT);
  });

  it("PRJ-1: finds projects by part of the project name, case-insensitively", async () => {
    expect(await searchIds({ p_archived: false, p_query: `kitchen ${searchKey}` })).toEqual([
      active.id,
    ]);
  });

  it("PRJ-2: the open statuses filter hides completed projects", async () => {
    expect(
      await searchIds({
        p_archived: false,
        p_statuses: ["lead", "active", "on_hold"],
        p_query: searchKey,
      }),
    ).toEqual([active.id, lead.id]);
    expect(
      await searchIds({ p_archived: false, p_statuses: ["completed"], p_query: searchKey }),
    ).toEqual([completed.id]);
  });

  it("PRJ-1: archived projects appear only in the archive", async () => {
    expect(await searchIds({ p_archived: false, p_query: searchKey })).not.toContain(
      archivedProject.id,
    );
    expect(await searchIds({ p_archived: true, p_query: searchKey })).toEqual([archivedProject.id]);
  });

  it("PRJ-1: LIKE wildcards in the query match literally", async () => {
    expect(await searchIds({ p_archived: false, p_query: `${searchKey}%` })).toEqual([]);
    expect(await searchIds({ p_archived: false, p_query: `Lead_${searchKey}` })).toEqual([]);
  });

  it("PRJ-1: pages with limit and offset", async () => {
    const first = await searchIds({ p_archived: false, p_query: searchKey, p_limit: 2 });
    const second = await searchIds({
      p_archived: false,
      p_query: searchKey,
      p_limit: 2,
      p_offset: 2,
    });

    expect([...first, ...second]).toEqual([completed.id, active.id, lead.id]);
  });

  it("PRJ-1: returns at most 100 rows even when more match", async () => {
    const bulkKey = `bulk-${randomUUID()}`;
    const { error: seedError } = await service.from(TABLE).insert(
      Array.from({ length: 101 }, (_, index) => ({
        client_id: searchClient.id,
        name: `${bulkKey} ${index}`,
        notes: MARKER,
      })),
    );
    expect(seedError).toBeNull();

    const rows = await search({ p_archived: false, p_query: bulkKey, p_limit: 1_000_000 });

    expect(rows).toHaveLength(100);
  });
});

describe("project form client list", () => {
  it("PRJ-1: lists at most 500 active clients and says when more exist", async () => {
    const { count, error } = await service
      .from("clients")
      .select("id", { count: "exact", head: true })
      .is("archived_at", null);
    expect(error).toBeNull();
    const missing = Math.max(CLIENT_OPTIONS_LIMIT - (count ?? 0), 0);
    if (missing > 0) {
      const { error: seedError } = await service.from("clients").insert(
        Array.from({ length: missing }, (_, index) => ({
          name: `options ${randomUUID()} ${index}`,
          notes: MARKER,
        })),
      );
      expect(seedError).toBeNull();
    }

    const atLimit = await listActiveClientOptions(owner.client);
    await insertClient();
    const overLimit = await listActiveClientOptions(owner.client);

    expect(atLimit.options).toHaveLength(CLIENT_OPTIONS_LIMIT);
    if (missing > 0) {
      // Exactly CLIENT_OPTIONS_LIMIT active clients: nothing is left out.
      expect(atLimit.hasMore).toBe(false);
    }
    expect(overLimit.options).toHaveLength(CLIENT_OPTIONS_LIMIT);
    expect(overLimit.hasMore).toBe(true);
    expect(overLimit.options.every((option) => !option.archived)).toBe(true);
  });
});
