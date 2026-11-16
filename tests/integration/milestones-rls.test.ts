import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getOpenDebtsSummary, listOpenDebts } from "@/lib/debts/queries";
import { listProjectMilestones, moveMilestone } from "@/lib/milestones/queries";

import {
  createAnonClient,
  createServiceRoleClient,
  createSignedInUser,
  deleteUser,
  testEmail,
  type TestUser,
} from "./support/local-supabase";

const TABLE = "milestones";
const VIEW = "milestone_balances";
const INSUFFICIENT_PRIVILEGE = "42501";
const CHECK_VIOLATION = "23514";
const FOREIGN_KEY_VIOLATION = "23503";
const INVALID_PARAMETER = "22023";
/** Raised by milestones_assign_sort_order(): a project holds at most 100 milestones. */
const TOO_MANY_MILESTONES = "HKM01";
const MAX_AGOROT = 9_999_999_999;
/** Every client and project this file creates has this marker in its notes, for cleanup. */
const MARKER = `it-milestones-${randomUUID()}`;

type MilestoneRow = {
  id: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  project_id: string;
  description: string;
  amount: number;
  due_date: string;
  sort_order: number;
  cancelled_at: string | null;
};

let service: SupabaseClient;
let anon: SupabaseClient;
let outsider: TestUser;
let owner: TestUser;
let admin: TestUser;
let client: { id: string; name: string };
let project: { id: string };
let target: MilestoneRow;
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

async function insertProject(fields: Record<string, unknown> = {}) {
  const { data, error } = await service
    .from("projects")
    .insert({ client_id: client.id, name: uniqueName("פרויקט"), notes: MARKER, ...fields })
    .select("id, name")
    .single<{ id: string; name: string }>();
  if (error) {
    throw new Error("Could not insert a test project", { cause: error });
  }
  return data;
}

async function insertMilestone(
  projectId: string,
  fields: Partial<MilestoneRow> = {},
): Promise<MilestoneRow> {
  const { data, error } = await service
    .from(TABLE)
    .insert({
      project_id: projectId,
      description: uniqueName("אבן דרך"),
      amount: 100_000,
      due_date: "2026-12-01",
      ...fields,
    })
    .select()
    .single<MilestoneRow>();
  if (error) {
    throw new Error("Could not insert a test milestone", { cause: error });
  }
  return data;
}

async function readMilestone(id: string): Promise<MilestoneRow | null> {
  const { data, error } = await service
    .from(TABLE)
    .select()
    .eq("id", id)
    .maybeSingle<MilestoneRow>();
  if (error) {
    throw new Error(`Could not read milestone ${id}`, { cause: error });
  }
  return data;
}

/** The project's milestone ids in their order, and their places. */
async function order(projectId: string) {
  const { data, error } = await service
    .from(TABLE)
    .select("id, sort_order")
    .eq("project_id", projectId)
    .order("sort_order");
  if (error) {
    throw new Error("Could not read the order", { cause: error });
  }
  const rows = data as { id: string; sort_order: number }[];
  return { ids: rows.map((row) => row.id), places: rows.map((row) => row.sort_order) };
}

beforeAll(async () => {
  service = await createServiceRoleClient();
  anon = await createAnonClient();

  outsider = await createSignedInUser(service, testEmail("milestones-outsider"));
  createdUserIds.push(outsider.id);
  owner = await createSignedInUser(service, testEmail("milestones-owner"));
  createdUserIds.push(owner.id);
  admin = await createSignedInUser(service, testEmail("milestones-admin"));
  createdUserIds.push(admin.id);

  const { error } = await service.from("allowed_users").insert([
    { email: owner.email, role: "owner" },
    { email: admin.email, role: "admin" },
  ]);
  if (error) {
    throw new Error("Could not allowlist the test users", { cause: error });
  }
  client = await insertClient();
  project = await insertProject();
  target = await insertMilestone(project.id, { amount: 1_250_050 });
});

afterAll(async () => {
  if (!service) {
    return;
  }
  const cleanupErrors: unknown[] = [];
  const { data: projects, error: projectsError } = await service
    .from("projects")
    .select("id")
    .eq("notes", MARKER);
  if (projectsError) {
    cleanupErrors.push(projectsError);
  }
  const projectIds = (projects ?? []).map((row) => row.id as string);
  // Milestones, then projects, then clients: each is ON DELETE RESTRICT.
  if (projectIds.length > 0) {
    const milestones = await service.from(TABLE).delete().in("project_id", projectIds);
    if (milestones.error) {
      cleanupErrors.push(milestones.error);
    }
  }
  const removedProjects = await service.from("projects").delete().eq("notes", MARKER);
  if (removedProjects.error) {
    cleanupErrors.push(removedProjects.error);
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

describe("milestones RLS: anon", () => {
  it("MS-1: anon cannot select, insert, update or delete milestones, nor read the view", async () => {
    const select = await anon.from(TABLE).select();
    const view = await anon.from(VIEW).select();
    const insert = await anon
      .from(TABLE)
      .insert({ project_id: project.id, description: "anon", amount: 1, due_date: "2026-12-01" });
    const update = await anon.from(TABLE).update({ description: "changed" }).eq("id", target.id);
    const remove = await anon.from(TABLE).delete().eq("id", target.id);

    expect(select.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(view.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(insert.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(update.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(remove.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await readMilestone(target.id)).toEqual(target);
  });

  it("MS-1 / MS-6: anon cannot call move_milestone, list_open_debts or open_debts_summary", async () => {
    const move = await anon.rpc("move_milestone", {
      p_milestone_id: target.id,
      p_direction: "up",
    });
    const list = await anon.rpc("list_open_debts", { p_today: "2100-01-01" });
    const summary = await anon.rpc("open_debts_summary", { p_today: "2100-01-01" });

    expect(move.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(list.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(summary.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });
});

describe("milestones RLS: authenticated user not in the allowlist", () => {
  it("MS-1: cannot select any milestone, from the table or the view", async () => {
    const table = await outsider.client.from(TABLE).select();
    const view = await outsider.client.from(VIEW).select();

    expect(table).toMatchObject({ error: null, data: [] });
    expect(view).toMatchObject({ error: null, data: [] });
  });

  it("MS-1: cannot insert a milestone", async () => {
    const description = uniqueName("outsider");
    const { error } = await outsider.client
      .from(TABLE)
      .insert({ project_id: project.id, description, amount: 1, due_date: "2026-12-01" });

    expect(error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    const { data } = await service.from(TABLE).select("id").eq("description", description);
    expect(data).toEqual([]);
  });

  it("MS-1: cannot update, cancel, move or delete a milestone", async () => {
    const update = await outsider.client
      .from(TABLE)
      .update({ description: "changed", cancelled_at: new Date().toISOString() })
      .eq("id", target.id)
      .select();
    const move = await outsider.client.rpc("move_milestone", {
      p_milestone_id: target.id,
      p_direction: "down",
    });
    const remove = await outsider.client.from(TABLE).delete().eq("id", target.id).select();

    expect(update.data).toEqual([]);
    expect(move.data).toEqual([{ result: "not_found", place: null, total: null }]);
    expect(remove.data).toEqual([]);
    expect(await readMilestone(target.id)).toEqual(target);
  });

  it("MS-6: sees no open debts", async () => {
    const list = await outsider.client.rpc("list_open_debts", { p_today: "2100-12-31" });
    const summary = await outsider.client
      .rpc("open_debts_summary", { p_today: "2100-12-31" })
      .single();

    expect(list.data).toEqual([]);
    expect(summary.data).toEqual({ debt_count: 0, total_balance: 0 });
  });
});

for (const role of ["owner", "admin"] as const) {
  const user = () => (role === "owner" ? owner : admin);

  describe(`milestones RLS: ${role}`, () => {
    it(`MS-1: ${role} can read a milestone; the amount arrives as an exact integer`, async () => {
      const { data, error } = await user().client.from(TABLE).select().eq("id", target.id);

      expect(error).toBeNull();
      expect(data).toEqual([target]);
      expect(data?.[0].amount).toBe(1_250_050);
    });

    it(`MS-1: ${role} can add a milestone; place and created_by come from the database`, async () => {
      const own = await insertProject();
      const { data, error } = await user()
        .client.from(TABLE)
        .insert({ project_id: own.id, description: "מקדמה", amount: 0, due_date: "2026-12-31" })
        .select()
        .single<MilestoneRow>();

      expect(error).toBeNull();
      expect(data).toMatchObject({
        description: "מקדמה",
        amount: 0,
        due_date: "2026-12-31",
        sort_order: 1,
        created_by: user().id,
        cancelled_at: null,
      });
    });

    it.each([
      ["sort_order", () => 7],
      ["created_by", () => outsider.id],
      ["id", () => randomUUID()],
      ["created_at", () => "2000-01-01T00:00:00Z"],
      ["updated_at", () => "2000-01-01T00:00:00Z"],
    ])(`MS-1: ${role} cannot set %s on insert`, async (column, value) => {
      const { error } = await user()
        .client.from(TABLE)
        .insert({
          project_id: project.id,
          description: "x",
          amount: 1,
          due_date: "2026-12-01",
          [column]: value(),
        });

      expect(error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    });

    it(`MS-1: ${role} cannot move a milestone to another project`, async () => {
      const other = await insertProject();
      const { error } = await user()
        .client.from(TABLE)
        .update({ project_id: other.id })
        .eq("id", target.id);

      expect(error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    });

    it(`MS-1: ${role} can edit, cancel, un-cancel and delete a milestone`, async () => {
      const row = await insertMilestone(project.id);

      const edited = await user()
        .client.from(TABLE)
        .update({ description: "שלב ב", amount: 5, due_date: "2027-01-01" })
        .eq("id", row.id)
        .select()
        .single<MilestoneRow>();
      const cancelled = await user()
        .client.from(TABLE)
        .update({ cancelled_at: new Date().toISOString() })
        .eq("id", row.id)
        .select()
        .single<MilestoneRow>();
      const restored = await user()
        .client.from(TABLE)
        .update({ cancelled_at: null })
        .eq("id", row.id)
        .select()
        .single<MilestoneRow>();
      const removed = await user().client.from(TABLE).delete().eq("id", row.id).select();

      expect(edited.data).toMatchObject({
        description: "שלב ב",
        amount: 5,
        due_date: "2027-01-01",
      });
      expect(Date.parse(edited.data?.updated_at ?? "")).toBeGreaterThan(Date.parse(row.updated_at));
      expect(cancelled.data?.cancelled_at).not.toBeNull();
      expect(restored.data?.cancelled_at).toBeNull();
      expect(removed.data).toHaveLength(1);
      expect(await readMilestone(row.id)).toBeNull();
    });
  });
}

describe("milestones schema", () => {
  it.each([
    ["an empty description", { description: "" }],
    ["an untrimmed description", { description: " מקדמה " }],
    ["a description over 200 characters", { description: "א".repeat(201) }],
    ["a negative amount", { amount: -1 }],
    ["an amount over the maximum", { amount: MAX_AGOROT + 1 }],
    ["a due date before 1900", { due_date: "1899-12-31" }],
    ["a due date after 2100", { due_date: "2101-01-01" }],
  ])("MS-1: the database rejects %s", async (_case, fields) => {
    const { error } = await owner.client.from(TABLE).insert({
      project_id: project.id,
      description: "x",
      amount: 1,
      due_date: "2026-12-01",
      ...fields,
    });

    expect(error?.code).toBe(CHECK_VIOLATION);
  });

  it.each([
    ["description", { amount: 1, due_date: "2026-12-01" }],
    ["amount", { description: "x", due_date: "2026-12-01" }],
    ["due date", { description: "x", amount: 1 }],
  ])("MS-1: the %s is required", async (_case, fields) => {
    const { error } = await owner.client.from(TABLE).insert({ project_id: project.id, ...fields });

    expect(error?.code).toBe("23502");
  });

  it("MS-1: accepts amount 0 and the maximum; the due date comes back unshifted", async () => {
    const zero = await insertMilestone(project.id, { amount: 0, due_date: "2026-12-31" });
    const max = await insertMilestone(project.id, { amount: MAX_AGOROT, due_date: "2027-01-01" });

    expect(zero).toMatchObject({ amount: 0, due_date: "2026-12-31" });
    expect(max).toMatchObject({ amount: MAX_AGOROT, due_date: "2027-01-01" });
  });

  it("MS-1: a milestone needs an existing project", async () => {
    const { error } = await owner.client
      .from(TABLE)
      .insert({ project_id: randomUUID(), description: "x", amount: 1, due_date: "2026-12-01" });

    expect(error?.code).toBe(FOREIGN_KEY_VIOLATION);
  });

  it("MS-1: a project holds at most 100 milestones", async () => {
    const full = await insertProject();
    const rows = Array.from({ length: 100 }, (_, index) => ({
      project_id: full.id,
      description: `אבן ${index + 1}`,
      amount: 1,
      due_date: "2026-12-01",
    }));
    const { error: fillError } = await service.from(TABLE).insert(rows);
    expect(fillError).toBeNull();

    const { error } = await owner.client
      .from(TABLE)
      .insert({ project_id: full.id, description: "101", amount: 1, due_date: "2026-12-01" });

    expect(error?.code).toBe(TOO_MANY_MILESTONES);
    expect((await order(full.id)).places).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
  });
});

describe("PRJ-1 / MS-1: a project with milestones cannot be deleted", () => {
  it("MS-1: deleting a project with a milestone fails with a foreign key violation", async () => {
    const owned = await insertProject();
    const milestone = await insertMilestone(owned.id);

    const { error } = await owner.client.from("projects").delete().eq("id", owned.id);

    expect(error?.code).toBe(FOREIGN_KEY_VIOLATION);
    expect(await readMilestone(milestone.id)).not.toBeNull();
  });

  it("MS-1: a cancelled milestone still keeps the project from being deleted", async () => {
    const owned = await insertProject();
    await insertMilestone(owned.id, { cancelled_at: new Date().toISOString() });

    const { error } = await owner.client.from("projects").delete().eq("id", owned.id);

    expect(error?.code).toBe(FOREIGN_KEY_VIOLATION);
  });

  it("MS-1: the project can be deleted once its milestones are gone", async () => {
    const owned = await insertProject();
    const milestone = await insertMilestone(owned.id);
    await owner.client.from(TABLE).delete().eq("id", milestone.id);

    const { data, error } = await owner.client
      .from("projects")
      .delete()
      .eq("id", owned.id)
      .select("id");

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });
});

describe("MS-1: order", () => {
  it("MS-1: new milestones go last, also after a deleted one left a gap", async () => {
    const own = await insertProject();
    const first = await insertMilestone(own.id);
    const second = await insertMilestone(own.id);
    const third = await insertMilestone(own.id);
    await service.from(TABLE).delete().eq("id", third.id);
    const fourth = await insertMilestone(own.id);

    expect([first.sort_order, second.sort_order, fourth.sort_order]).toEqual([1, 2, 3]);
    await service.from(TABLE).delete().eq("id", second.id);
    const fifth = await insertMilestone(own.id);
    expect(await order(own.id)).toEqual({
      ids: [first.id, fourth.id, fifth.id],
      places: [1, 3, 4],
    });
  });

  it("MS-1: moving up and down swaps with the neighbour, across a gap", async () => {
    const own = await insertProject();
    const a = await insertMilestone(own.id);
    const gap = await insertMilestone(own.id);
    const b = await insertMilestone(own.id);
    const c = await insertMilestone(own.id);
    await service.from(TABLE).delete().eq("id", gap.id);

    expect(await moveMilestone(owner.client, b.id, "up")).toEqual({
      status: "moved",
      place: 1,
      total: 3,
    });
    expect((await order(own.id)).ids).toEqual([b.id, a.id, c.id]);
    expect(await moveMilestone(owner.client, b.id, "down")).toEqual({
      status: "moved",
      place: 2,
      total: 3,
    });
    expect(await moveMilestone(owner.client, b.id, "down")).toEqual({
      status: "moved",
      place: 3,
      total: 3,
    });
    expect((await order(own.id)).ids).toEqual([a.id, c.id, b.id]);
  });

  it("MS-1: moving the first up or the last down changes nothing", async () => {
    const own = await insertProject();
    const a = await insertMilestone(own.id);
    const b = await insertMilestone(own.id);
    const before = await order(own.id);

    expect(await moveMilestone(owner.client, a.id, "up")).toEqual({
      status: "edge",
      place: 1,
      total: 2,
    });
    expect(await moveMilestone(owner.client, b.id, "down")).toEqual({
      status: "edge",
      place: 2,
      total: 2,
    });
    expect(await order(own.id)).toEqual(before);
  });

  it("MS-1: moving an unknown milestone reports not_found", async () => {
    expect(await moveMilestone(owner.client, randomUUID(), "up")).toEqual({ status: "not_found" });
  });

  it("MS-1: an unknown direction is refused", async () => {
    const { error } = await owner.client.rpc("move_milestone", {
      p_milestone_id: target.id,
      p_direction: "left",
    });

    expect(error?.code).toBe(INVALID_PARAMETER);
  });

  it("MS-1: moves only affect the moved milestone's project", async () => {
    const one = await insertProject();
    const two = await insertProject();
    const a1 = await insertMilestone(one.id);
    const b1 = await insertMilestone(one.id);
    const a2 = await insertMilestone(two.id);
    const b2 = await insertMilestone(two.id);

    await moveMilestone(owner.client, b1.id, "up");

    expect((await order(one.id)).ids).toEqual([b1.id, a1.id]);
    expect((await order(two.id)).ids).toEqual([a2.id, b2.id]);
  });

  it("MS-1: concurrent moves keep every milestone in one distinct place", async () => {
    const own = await insertProject();
    const milestones = [];
    for (let index = 0; index < 6; index += 1) {
      milestones.push(await insertMilestone(own.id));
    }
    const ids = milestones.map((milestone) => milestone.id);

    // 30 moves at once, from both allowlisted users, in both directions.
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, index) =>
        moveMilestone(
          index % 2 === 0 ? owner.client : admin.client,
          ids[index % ids.length],
          index % 3 === 0 ? "down" : "up",
        ),
      ),
    );

    expect(results.every((result) => result.status === "moved" || result.status === "edge")).toBe(
      true,
    );
    const after = await order(own.id);
    expect([...after.ids].sort()).toEqual([...ids].sort());
    expect(new Set(after.places).size).toBe(ids.length);
  });

  it("MS-1: concurrent inserts get distinct places at the end", async () => {
    const own = await insertProject();
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        owner.client.from(TABLE).insert({
          project_id: own.id,
          description: `במקביל ${index}`,
          amount: 1,
          due_date: "2026-12-01",
        }),
      ),
    );

    expect(results.map((result) => result.error)).toEqual(Array(12).fill(null));
    expect((await order(own.id)).places).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  });

  it("MS-1: a duplicate place is refused even when written directly", async () => {
    const own = await insertProject();
    const a = await insertMilestone(own.id);
    const b = await insertMilestone(own.id);

    const { error } = await owner.client
      .from(TABLE)
      .update({ sort_order: a.sort_order })
      .eq("id", b.id);

    expect(error?.code).toBe("23505");
  });
});

describe("MS-1: sort_order bounds", () => {
  it("MS-1: the database refuses a place above 1,000,000 or below 1", async () => {
    const own = await insertProject();
    const milestone = await insertMilestone(own.id);

    const tooHigh = await owner.client
      .from(TABLE)
      .update({ sort_order: 2_147_483_647 })
      .eq("id", milestone.id);
    const zero = await owner.client.from(TABLE).update({ sort_order: 0 }).eq("id", milestone.id);

    expect(tooHigh.error?.code).toBe(CHECK_VIOLATION);
    expect(zero.error?.code).toBe(CHECK_VIOLATION);
    expect((await readMilestone(milestone.id))?.sort_order).toBe(1);
  });

  it("MS-1: after a place at the bound, a new milestone still goes last (the list is renumbered)", async () => {
    const own = await insertProject();
    const a = await insertMilestone(own.id);
    const b = await insertMilestone(own.id);
    const c = await insertMilestone(own.id);
    // a goes to the very end with a direct write at the bound.
    const { error } = await owner.client
      .from(TABLE)
      .update({ sort_order: 1_000_000 })
      .eq("id", a.id);
    expect(error).toBeNull();

    const { data, error: insertError } = await owner.client
      .from(TABLE)
      .insert({ project_id: own.id, description: "אחרונה", amount: 1, due_date: "2026-12-01" })
      .select("id")
      .single<{ id: string }>();

    expect(insertError).toBeNull();
    expect(await order(own.id)).toEqual({
      ids: [b.id, c.id, a.id, data?.id],
      places: [1, 2, 3, 4],
    });
  });
});

describe("milestone_balances", () => {
  it("MS-2: in M1.3 paid is 0 and the balance is the amount; the list is in order", async () => {
    const own = await insertProject();
    const a = await insertMilestone(own.id, { amount: 300_000 });
    const b = await insertMilestone(own.id, {
      amount: 700_050,
      cancelled_at: "2026-11-16T10:00:00+00:00",
    });

    const milestones = await listProjectMilestones(owner.client, own.id);

    expect(milestones).toEqual([
      expect.objectContaining({
        id: a.id,
        amount: 300_000,
        paid: 0,
        balance: 300_000,
        sort_order: 1,
      }),
      expect.objectContaining({
        id: b.id,
        amount: 700_050,
        paid: 0,
        balance: 700_050,
        sort_order: 2,
      }),
    ]);
    expect(milestones[1].cancelled_at).not.toBeNull();
  });

  it("MS-2: the view runs with the caller's rights (security_invoker), so RLS applies", async () => {
    const own = await insertProject();
    const milestone = await insertMilestone(own.id);

    const asOutsider = await outsider.client.from(VIEW).select("id").eq("id", milestone.id);
    const asOwner = await owner.client.from(VIEW).select("id").eq("id", milestone.id);

    expect(asOutsider.data).toEqual([]);
    expect(asOwner.data).toEqual([{ id: milestone.id }]);
  });
});

describe("MS-6: open debts", () => {
  // Due dates in 1901–1902 keep this file's debts apart from other data in the database. The
  // assertions still only look at this block's own client, and totals are compared with a
  // baseline taken before seeding, so leftovers of an interrupted run cannot break them.
  const TODAY = "1902-01-10";
  let debtClient: { id: string; name: string };
  let ids: Record<string, string>;
  let baseline: { count: number; total: number };

  /** This block's debts, in list order. */
  async function ownDebts(today: string) {
    const page = await listOpenDebts(owner.client, today, 0);
    return page.items.filter((debt) => debt.client_id === debtClient.id);
  }

  beforeAll(async () => {
    baseline = await getOpenDebtsSummary(owner.client, TODAY);
    debtClient = await insertClient({ name: uniqueName("חייב") });
    const active = await insertProject({ client_id: debtClient.id, status: "active" });
    const completed = await insertProject({ client_id: debtClient.id, status: "completed" });
    const archived = await insertProject({
      client_id: debtClient.id,
      status: "cancelled",
      archived_at: new Date().toISOString(),
    });
    // Inserted out of date order; the list is oldest due date first.
    const middle = await insertMilestone(active.id, { due_date: "1901-06-01", amount: 200_000 });
    const oldest = await insertMilestone(completed.id, { due_date: "1901-01-01", amount: 100_000 });
    const yesterday = await insertMilestone(archived.id, {
      due_date: "1902-01-09",
      amount: 300_050,
    });
    const today = await insertMilestone(active.id, { due_date: TODAY });
    const future = await insertMilestone(active.id, { due_date: "1902-02-01" });
    const cancelled = await insertMilestone(active.id, {
      due_date: "1901-03-01",
      cancelled_at: new Date().toISOString(),
    });
    const zero = await insertMilestone(active.id, { due_date: "1901-03-01", amount: 0 });
    ids = {
      middle: middle.id,
      oldest: oldest.id,
      yesterday: yesterday.id,
      today: today.id,
      future: future.id,
      cancelled: cancelled.id,
      zero: zero.id,
      archivedProject: archived.id,
    };
  });

  it("MS-6: lists overdue milestones with a balance, oldest first, whatever the project's status or archive state", async () => {
    const debts = await ownDebts(TODAY);

    expect(debts.map((debt) => debt.id)).toEqual([ids.oldest, ids.middle, ids.yesterday]);
    expect(debts[0]).toMatchObject({
      due_date: "1901-01-01",
      balance: 100_000,
      days_overdue: 374,
      client_id: debtClient.id,
      client_name: debtClient.name,
      project_archived: false,
    });
    expect(debts[2]).toMatchObject({
      days_overdue: 1,
      balance: 300_050,
      project_id: ids.archivedProject,
      project_archived: true,
    });
  });

  it("MS-6: the whole list is sorted by due date, oldest first", async () => {
    const page = await listOpenDebts(owner.client, TODAY, 0);
    const dates = page.items.map((debt) => debt.due_date);

    expect(dates).toEqual([...dates].sort());
  });

  it("MS-6: due today, in the future, cancelled or with nothing to pay is not an open debt", async () => {
    const listed = (await ownDebts(TODAY)).map((debt) => debt.id);

    for (const id of [ids.today, ids.future, ids.cancelled, ids.zero]) {
      expect(listed).not.toContain(id);
    }
  });

  it("MS-6: the next day, the milestone due today becomes an open debt", async () => {
    expect((await ownDebts("1902-01-11")).map((debt) => debt.id)).toEqual([
      ids.oldest,
      ids.middle,
      ids.yesterday,
      ids.today,
    ]);
  });

  it("MS-6: the summary counts and sums the same debts", async () => {
    expect(await getOpenDebtsSummary(owner.client, TODAY)).toEqual({
      count: baseline.count + 3,
      total: baseline.total + 600_050,
    });
  });

  it("MS-6: pages are bounded to 100 rows and paged with an offset", async () => {
    const all = await owner.client.rpc("list_open_debts", { p_today: TODAY, p_limit: 1000 });
    const second = await owner.client.rpc("list_open_debts", {
      p_today: TODAY,
      p_limit: 1,
      p_offset: 1,
    });
    const allIds = (all.data as { id: string }[]).map((row) => row.id);

    expect(allIds.length).toBeLessThanOrEqual(100);
    expect((second.data as { id: string }[]).map((row) => row.id)).toEqual([allIds[1]]);
  });

  it("MS-6: a large page is capped at 100 rows", async () => {
    const big = await insertProject({ client_id: debtClient.id });
    try {
      const rows = Array.from({ length: 100 }, (_, index) => ({
        project_id: big.id,
        description: `ישן ${index}`,
        amount: 1,
        due_date: "1900-06-01",
      }));
      const { error } = await service.from(TABLE).insert(rows);
      expect(error).toBeNull();

      const { data } = await owner.client.rpc("list_open_debts", {
        p_today: TODAY,
        p_limit: 1000,
      });

      expect((data as unknown[]).length).toBe(100);
    } finally {
      // Removed right away (afterAll also would) so the other tests see no extra debts.
      await service.from(TABLE).delete().eq("project_id", big.id);
    }
  });
});
