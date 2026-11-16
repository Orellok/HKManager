import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { todayInJerusalem } from "@/lib/dates";
import {
  getClientPaymentSummary,
  getIncomesMonthSummary,
  getProjectPaidTotal,
  listIncomes,
  saveIncome,
  softDeleteIncome,
} from "@/lib/incomes/queries";
import type { IncomeInput } from "@/lib/incomes/schema";
import { getMilestone, listProjectMilestones } from "@/lib/milestones/queries";

import {
  createAnonClient,
  createServiceRoleClient,
  createSignedInUser,
  deleteUser,
  testEmail,
  type TestUser,
} from "./support/local-supabase";
import { runPsqlSession } from "./support/psql-session";

const TABLE = "incomes";
const AUDIT = "audit_log";
const INSUFFICIENT_PRIVILEGE = "42501";
const CHECK_VIOLATION = "23514";
const FOREIGN_KEY_VIOLATION = "23503";
/** Raised by incomes_check_references(). */
const REFERENCES_MISMATCH = "HKI01";
const MILESTONE_CANCELLED = "HKI02";
const DATE_IN_FUTURE = "HKI03";
/** Raised by projects_keep_income_clients(). */
const PROJECT_HAS_INCOMES = "HKI04";
/** Every client this file creates has this marker in its notes, for cleanup. */
const MARKER = `it-incomes-${randomUUID()}`;

type IncomeRow = {
  id: string;
  created_by: string | null;
  client_id: string;
  project_id: string | null;
  milestone_id: string | null;
  received_date: string;
  amount: number;
  payment_method: string;
  notes: string | null;
  deleted_at: string | null;
};

type AuditRow = {
  actor: string | null;
  entity: string;
  entity_id: string;
  action: string;
  diff: Record<string, unknown>;
};

let service: SupabaseClient;
let anon: SupabaseClient;
let outsider: TestUser;
let owner: TestUser;
let admin: TestUser;
const createdUserIds: string[] = [];

function uniqueName(label: string): string {
  return `${label} ${randomUUID()}`;
}

/** An ISO date `days` from today in Asia/Jerusalem. */
function isoDaysFromToday(days: number): string {
  const [year, month, day] = todayInJerusalem().split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

async function insertClient() {
  const { data, error } = await service
    .from("clients")
    .insert({ name: uniqueName("לקוח"), notes: MARKER })
    .select("id, name")
    .single<{ id: string; name: string }>();
  if (error) {
    throw new Error("Could not insert a test client", { cause: error });
  }
  return data;
}

async function insertProject(clientId: string, fields: Record<string, unknown> = {}) {
  const { data, error } = await service
    .from("projects")
    .insert({ client_id: clientId, name: uniqueName("פרויקט"), ...fields })
    .select("id")
    .single<{ id: string }>();
  if (error) {
    throw new Error("Could not insert a test project", { cause: error });
  }
  return data;
}

async function insertMilestone(projectId: string, fields: Record<string, unknown> = {}) {
  const { data, error } = await service
    .from("milestones")
    .insert({
      project_id: projectId,
      description: uniqueName("אבן דרך"),
      amount: 100_000,
      due_date: "2026-01-01",
      ...fields,
    })
    .select("id")
    .single<{ id: string }>();
  if (error) {
    throw new Error("Could not insert a test milestone", { cause: error });
  }
  return data;
}

/** A client with a project and a milestone of ₪1,000. */
async function setup(milestoneFields: Record<string, unknown> = {}) {
  const client = await insertClient();
  const project = await insertProject(client.id);
  const milestone = await insertMilestone(project.id, milestoneFields);
  return { client, project, milestone };
}

function incomeInput(fields: Partial<IncomeInput> & { client_id: string }): IncomeInput {
  return {
    project_id: null,
    milestone_id: null,
    received_date: "2026-03-15",
    amount: 10_000,
    payment_method: "bank_transfer",
    notes: null,
    ...fields,
  };
}

/** Inserts an income directly as `client` (no overpayment check). */
async function insertIncome(client: SupabaseClient, row: Record<string, unknown>) {
  return client
    .from(TABLE)
    .insert({ received_date: "2026-03-15", amount: 10_000, payment_method: "cash", ...row })
    .select()
    .single<IncomeRow>();
}

async function readIncome(id: string): Promise<IncomeRow | null> {
  const { data, error } = await service.from(TABLE).select().eq("id", id).maybeSingle<IncomeRow>();
  if (error) {
    throw new Error(`Could not read income ${id}`, { cause: error });
  }
  return data;
}

async function auditOf(id: string): Promise<AuditRow[]> {
  const { data, error } = await service
    .from(AUDIT)
    .select("actor, entity, entity_id, action, diff")
    .eq("entity_id", id)
    .order("created_at");
  if (error) {
    throw new Error("Could not read the audit log", { cause: error });
  }
  return data as AuditRow[];
}

async function savedId(result: Awaited<ReturnType<typeof saveIncome>>): Promise<string> {
  if (result.status !== "saved") {
    throw new Error(`Expected the income to be saved, got ${JSON.stringify(result)}`);
  }
  return result.id;
}

beforeAll(async () => {
  service = await createServiceRoleClient();
  anon = await createAnonClient();
  outsider = await createSignedInUser(service, testEmail("incomes-outsider"));
  createdUserIds.push(outsider.id);
  owner = await createSignedInUser(service, testEmail("incomes-owner"));
  createdUserIds.push(owner.id);
  admin = await createSignedInUser(service, testEmail("incomes-admin"));
  createdUserIds.push(admin.id);
  const { error } = await service.from("allowed_users").insert([
    { email: owner.email, role: "owner" },
    { email: admin.email, role: "admin" },
  ]);
  if (error) {
    throw new Error("Could not allowlist the test users", { cause: error });
  }
});

afterAll(async () => {
  if (!service) {
    return;
  }
  const cleanupErrors: unknown[] = [];
  const { data: clients } = await service.from("clients").select("id").eq("notes", MARKER);
  const clientIds = (clients ?? []).map((row) => row.id as string);
  if (clientIds.length > 0) {
    const { data: incomes } = await service.from(TABLE).select("id").in("client_id", clientIds);
    const incomeIds = (incomes ?? []).map((row) => row.id as string);
    // Incomes, then milestones, projects and clients: each is ON DELETE RESTRICT.
    if (incomeIds.length > 0) {
      const audit = await service.from(AUDIT).delete().in("entity_id", incomeIds);
      const removed = await service.from(TABLE).delete().in("id", incomeIds);
      cleanupErrors.push(...[audit.error, removed.error].filter(Boolean));
    }
    const { data: projects } = await service
      .from("projects")
      .select("id")
      .in("client_id", clientIds);
    const projectIds = (projects ?? []).map((row) => row.id as string);
    if (projectIds.length > 0) {
      const milestones = await service.from("milestones").delete().in("project_id", projectIds);
      const removedProjects = await service.from("projects").delete().in("id", projectIds);
      cleanupErrors.push(...[milestones.error, removedProjects.error].filter(Boolean));
    }
    const removedClients = await service.from("clients").delete().in("id", clientIds);
    if (removedClients.error) {
      cleanupErrors.push(removedClients.error);
    }
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

describe("incomes RLS: anon and users outside the allowlist", () => {
  it("INC-1: anon cannot read or write incomes or the audit log, nor call the functions", async () => {
    const { client } = await setup();
    const select = await anon.from(TABLE).select();
    const insert = await anon.from(TABLE).insert({
      client_id: client.id,
      received_date: "2026-01-01",
      amount: 1,
      payment_method: "cash",
    });
    const audit = await anon.from(AUDIT).select();
    const rpcs = await Promise.all([
      anon.rpc("list_incomes", { p_month: "2026-01-01" }),
      anon.rpc("incomes_month_summary", { p_month: "2026-01-01" }),
      anon.rpc("project_paid_total", { p_project_id: randomUUID() }),
      anon.rpc("client_payment_summary", { p_client_id: client.id }),
      anon.rpc("save_income", {
        p_income_id: null,
        p_client_id: client.id,
        p_project_id: null,
        p_milestone_id: null,
        p_received_date: "2026-01-01",
        p_amount: 1,
        p_payment_method: "cash",
        p_notes: null,
      }),
    ]);

    expect(select.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(insert.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(audit.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(rpcs.map((result) => result.error?.code)).toEqual(Array(5).fill(INSUFFICIENT_PRIVILEGE));
  });

  it("INC-1: a signed-in user outside the allowlist sees nothing and cannot record or change incomes", async () => {
    const { client, project, milestone } = await setup();
    const existing = await insertIncome(service, { client_id: client.id });
    const select = await outsider.client.from(TABLE).select().eq("id", existing.data!.id);
    const insert = await insertIncome(outsider.client, { client_id: client.id });
    const save = await outsider.client.rpc("save_income", {
      p_income_id: null,
      p_client_id: client.id,
      p_project_id: project.id,
      p_milestone_id: milestone.id,
      p_received_date: "2026-01-01",
      p_amount: 1,
      p_payment_method: "cash",
      p_notes: null,
    });
    const update = await outsider.client
      .from(TABLE)
      .update({ amount: 1, deleted_at: new Date().toISOString() })
      .eq("id", existing.data!.id)
      .select();
    const audit = await outsider.client.from(AUDIT).select().eq("entity_id", existing.data!.id);
    const list = await outsider.client.rpc("list_incomes", { p_month: "2026-03-01" });

    expect(select.data).toEqual([]);
    expect(insert.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(save.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(update.data).toEqual([]);
    expect(audit.data).toEqual([]);
    expect(list.data).toEqual([]);
    expect(await readIncome(existing.data!.id)).toMatchObject({ amount: 10_000, deleted_at: null });
  });
});

for (const role of ["owner", "admin"] as const) {
  const user = () => (role === "owner" ? owner : admin);

  describe(`incomes RLS: ${role}`, () => {
    it(`INC-1 / MS-4: ${role} records a payment; the amount is an exact integer and created_by is the user`, async () => {
      const { client, project, milestone } = await setup();

      const id = await savedId(
        await saveIncome(
          user().client,
          null,
          incomeInput({
            client_id: client.id,
            project_id: project.id,
            milestone_id: milestone.id,
            amount: 99_999,
          }),
          null,
        ),
      );

      const { data } = await user().client.from(TABLE).select().eq("id", id).single<IncomeRow>();
      expect(data).toMatchObject({
        created_by: user().id,
        client_id: client.id,
        project_id: project.id,
        milestone_id: milestone.id,
        amount: 99_999,
        received_date: "2026-03-15",
        deleted_at: null,
      });
    });

    it(`INC-2: ${role} records an income without a project`, async () => {
      const client = await insertClient();
      const id = await savedId(
        await saveIncome(user().client, null, incomeInput({ client_id: client.id }), null),
      );
      expect(await readIncome(id)).toMatchObject({ project_id: null, milestone_id: null });
    });

    it(`SPEC 6: ${role} has no DELETE privilege on incomes; a soft delete keeps the row`, async () => {
      const client = await insertClient();
      const { data: income } = await insertIncome(user().client, { client_id: client.id });

      const remove = await user().client.from(TABLE).delete().eq("id", income!.id);
      expect(remove.error?.code).toBe(INSUFFICIENT_PRIVILEGE);

      expect(await softDeleteIncome(user().client, income!.id)).toEqual({
        status: "deleted",
        projectId: null,
      });
      expect((await readIncome(income!.id))?.deleted_at).not.toBeNull();
      // A deleted income can no longer be changed or deleted again.
      const update = await user()
        .client.from(TABLE)
        .update({ amount: 1, deleted_at: null })
        .eq("id", income!.id)
        .select();
      expect(update.data).toEqual([]);
      expect(await softDeleteIncome(user().client, income!.id)).toEqual({ status: "not_found" });
      expect(await readIncome(income!.id)).toMatchObject({ amount: 10_000 });
    });

    it(`audit_log: ${role} can read the audit log but never write it`, async () => {
      const client = await insertClient();
      const { data: income } = await insertIncome(user().client, { client_id: client.id });

      const read = await user().client.from(AUDIT).select("entity_id").eq("entity_id", income!.id);
      const insert = await user().client.from(AUDIT).insert({
        entity: "incomes",
        entity_id: income!.id,
        action: "update",
        diff: {},
      });
      const update = await user()
        .client.from(AUDIT)
        .update({ diff: {} })
        .eq("entity_id", income!.id);
      const remove = await user().client.from(AUDIT).delete().eq("entity_id", income!.id);

      expect(read.data).toEqual([{ entity_id: income!.id }]);
      expect(insert.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
      expect(update.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
      expect(remove.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
      expect(await auditOf(income!.id)).toHaveLength(1);
    });
  });
}

describe("incomes schema and owner decisions", () => {
  it("owner decision: the amount must be more than 0 and at most the maximum", async () => {
    const client = await insertClient();
    const zero = await insertIncome(owner.client, { client_id: client.id, amount: 0 });
    const negative = await insertIncome(owner.client, { client_id: client.id, amount: -1 });
    const tooLarge = await insertIncome(owner.client, {
      client_id: client.id,
      amount: 10_000_000_000,
    });
    const max = await insertIncome(owner.client, { client_id: client.id, amount: 9_999_999_999 });

    expect(zero.error?.code).toBe(CHECK_VIOLATION);
    expect(negative.error?.code).toBe(CHECK_VIOLATION);
    expect(tooLarge.error?.code).toBe(CHECK_VIOLATION);
    expect(max.data?.amount).toBe(9_999_999_999);
  });

  it("INC-5: only the listed payment methods are stored", async () => {
    const client = await insertClient();
    const invalid = await insertIncome(owner.client, {
      client_id: client.id,
      payment_method: "paypal",
    });
    expect(invalid.error?.code).toBe(CHECK_VIOLATION);
    for (const method of ["bank_transfer", "bit_paybox", "cash", "check", "credit_card", "other"]) {
      const { error } = await insertIncome(owner.client, {
        client_id: client.id,
        payment_method: method,
      });
      expect(error).toBeNull();
    }
  });

  it("owner decision: a received date in the future (Asia/Jerusalem) is refused, today is accepted", async () => {
    const client = await insertClient();
    const future = await insertIncome(owner.client, {
      client_id: client.id,
      received_date: isoDaysFromToday(2),
    });
    const today = await insertIncome(owner.client, {
      client_id: client.id,
      received_date: isoDaysFromToday(-1),
    });
    const outOfRange = await insertIncome(owner.client, {
      client_id: client.id,
      received_date: "1899-12-31",
    });

    expect(future.error?.code).toBe(DATE_IN_FUTURE);
    expect(today.error).toBeNull();
    expect(outOfRange.error?.code).toBe(CHECK_VIOLATION);
    // Moving an existing income's date into the future is refused too.
    const moved = await owner.client
      .from(TABLE)
      .update({ received_date: isoDaysFromToday(3) })
      .eq("id", today.data!.id);
    expect(moved.error?.code).toBe(DATE_IN_FUTURE);
  });

  it("INC-1: the date comes back unshifted across a year change; untrimmed notes are refused", async () => {
    const client = await insertClient();
    const untrimmed = await insertIncome(owner.client, { client_id: client.id, notes: " רווח " });
    const yearEnd = await insertIncome(owner.client, {
      client_id: client.id,
      received_date: "2025-12-31",
    });
    const yearStart = await insertIncome(owner.client, {
      client_id: client.id,
      received_date: "2026-01-01",
    });

    expect(untrimmed.error?.code).toBe(CHECK_VIOLATION);
    expect(yearEnd.data?.received_date).toBe("2025-12-31");
    expect(yearStart.data?.received_date).toBe("2026-01-01");
  });
});

describe("incomes consistency (criterion 1)", () => {
  it("INC-1: a milestone of another project is refused", async () => {
    const { client, project } = await setup();
    const other = await insertProject(client.id);
    const otherMilestone = await insertMilestone(other.id);

    const { error } = await insertIncome(owner.client, {
      client_id: client.id,
      project_id: project.id,
      milestone_id: otherMilestone.id,
    });

    expect(error?.code).toBe(REFERENCES_MISMATCH);
  });

  it("INC-1: a project of another client is refused", async () => {
    const { project } = await setup();
    const otherClient = await insertClient();

    const { error } = await insertIncome(owner.client, {
      client_id: otherClient.id,
      project_id: project.id,
    });

    expect(error?.code).toBe(REFERENCES_MISMATCH);
  });

  it("INC-1: a milestone without its project is refused", async () => {
    const { client, milestone } = await setup();
    const { error } = await insertIncome(owner.client, {
      client_id: client.id,
      milestone_id: milestone.id,
    });
    expect(error?.code).toBe(REFERENCES_MISMATCH);
  });

  it("INC-1: an edit that breaks the consistency is refused; the service role is refused too", async () => {
    const { client, project, milestone } = await setup();
    const { data: income } = await insertIncome(owner.client, {
      client_id: client.id,
      project_id: project.id,
      milestone_id: milestone.id,
    });
    const otherClient = await insertClient();

    const asOwner = await owner.client
      .from(TABLE)
      .update({ client_id: otherClient.id })
      .eq("id", income!.id);
    const asService = await service.from(TABLE).update({ project_id: null }).eq("id", income!.id);

    expect(asOwner.error?.code).toBe(REFERENCES_MISMATCH);
    expect(asService.error?.code).toBe(REFERENCES_MISMATCH);
  });

  it("INC-1: a project whose incomes name its client cannot move to another client", async () => {
    const { client, project } = await setup();
    await insertIncome(owner.client, { client_id: client.id, project_id: project.id });
    const otherClient = await insertClient();
    const withoutIncomes = await insertProject(client.id);

    const moved = await owner.client
      .from("projects")
      .update({ client_id: otherClient.id })
      .eq("id", project.id);
    const movedFree = await owner.client
      .from("projects")
      .update({ client_id: otherClient.id })
      .eq("id", withoutIncomes.id)
      .select("client_id");

    expect(moved.error?.code).toBe(PROJECT_HAS_INCOMES);
    expect(movedFree.data).toEqual([{ client_id: otherClient.id }]);
  });

  it("INC-1: a payment waits for a concurrent move of its project and is then refused", async () => {
    const { client, project } = await setup();
    const otherClient = await insertClient();

    const move = runPsqlSession(`
      begin;
      update public.projects set client_id = '${otherClient.id}' where id = '${project.id}';
      select pg_sleep(1.5);
      commit;
    `);
    await sleep(500);
    const income = runPsqlSession(`
      insert into public.incomes (client_id, project_id, received_date, amount, payment_method)
      values ('${client.id}', '${project.id}', '2026-03-01', 100, 'cash');
    `);

    expect(await move).toEqual({ ok: true });
    expect(await income).toMatchObject({ ok: false, sqlState: REFERENCES_MISMATCH });
  });

  it("INC-1: a move of a project waits for a concurrent payment and is then refused", async () => {
    const { client, project } = await setup();
    const otherClient = await insertClient();

    const income = runPsqlSession(`
      begin;
      insert into public.incomes (client_id, project_id, received_date, amount, payment_method)
      values ('${client.id}', '${project.id}', '2026-03-01', 100, 'cash');
      select pg_sleep(1.5);
      commit;
    `);
    await sleep(500);
    const move = runPsqlSession(`
      update public.projects set client_id = '${otherClient.id}' where id = '${project.id}';
    `);

    expect(await income).toEqual({ ok: true });
    expect(await move).toMatchObject({ ok: false, sqlState: PROJECT_HAS_INCOMES });
  });
});

describe("owner decision: no payment for a cancelled milestone", () => {
  it("MS-4: recording a payment for a cancelled milestone is refused, also for the service role", async () => {
    const { client, project, milestone } = await setup({
      cancelled_at: "2026-11-10T10:00:00Z",
    });
    const row = { client_id: client.id, project_id: project.id, milestone_id: milestone.id };

    const direct = await insertIncome(owner.client, row);
    const asService = await insertIncome(service, row);
    const viaSave = await saveIncome(owner.client, null, incomeInput(row), null);

    expect(direct.error?.code).toBe(MILESTONE_CANCELLED);
    expect(asService.error?.code).toBe(MILESTONE_CANCELLED);
    expect(viaSave).toEqual({ status: "refused", refusal: "milestone_cancelled" });
  });

  it("MS-4: moving an income to a cancelled milestone is refused; editing one recorded before the cancel is allowed", async () => {
    const { client, project, milestone } = await setup();
    const cancelled = await insertMilestone(project.id, { cancelled_at: "2026-11-10T10:00:00Z" });
    const { data: income } = await insertIncome(owner.client, {
      client_id: client.id,
      project_id: project.id,
      milestone_id: milestone.id,
    });

    const toCancelled = await owner.client
      .from(TABLE)
      .update({ milestone_id: cancelled.id })
      .eq("id", income!.id);
    expect(toCancelled.error?.code).toBe(MILESTONE_CANCELLED);

    await service
      .from("milestones")
      .update({ cancelled_at: new Date().toISOString() })
      .eq("id", milestone.id);
    const edited = await saveIncome(
      owner.client,
      income!.id,
      incomeInput({
        client_id: client.id,
        project_id: project.id,
        milestone_id: milestone.id,
        amount: 5_000,
      }),
      null,
    );
    expect(edited).toEqual({ status: "saved", id: income!.id });
  });

  it("MS-4: a payment waits for a concurrent cancel of its milestone and is then refused", async () => {
    const { client, project, milestone } = await setup();

    const cancel = runPsqlSession(`
      begin;
      update public.milestones set cancelled_at = now() where id = '${milestone.id}';
      select pg_sleep(1.5);
      commit;
    `);
    await sleep(500);
    const payment = runPsqlSession(`
      insert into public.incomes (client_id, project_id, milestone_id, received_date, amount, payment_method)
      values ('${client.id}', '${project.id}', '${milestone.id}', '2026-03-01', 100, 'cash');
    `);

    expect(await cancel).toEqual({ ok: true });
    expect(await payment).toMatchObject({ ok: false, sqlState: MILESTONE_CANCELLED });
  });

  it("MS-4: a cancel waits for a concurrent payment and then succeeds (the payment stays)", async () => {
    const { client, project, milestone } = await setup();

    const payment = runPsqlSession(`
      begin;
      insert into public.incomes (client_id, project_id, milestone_id, received_date, amount, payment_method)
      values ('${client.id}', '${project.id}', '${milestone.id}', '2026-03-01', 100, 'cash');
      select pg_sleep(1.5);
      commit;
    `);
    await sleep(500);
    const cancel = runPsqlSession(
      `update public.milestones set cancelled_at = now() where id = '${milestone.id}';`,
    );

    expect(await payment).toEqual({ ok: true });
    expect(await cancel).toEqual({ ok: true });
    const balance = await getMilestone(owner.client, milestone.id);
    expect(balance).toMatchObject({ paid: 100 });
    expect(balance?.cancelled_at).not.toBeNull();
  });
});

describe("MS-2: milestone_balances and statuses from incomes", () => {
  it("MS-2: paid sums the milestone's incomes that are not deleted; the balance can go negative", async () => {
    const { client, project, milestone } = await setup();
    const row = { client_id: client.id, project_id: project.id, milestone_id: milestone.id };
    await insertIncome(owner.client, { ...row, amount: 30_000 });
    const { data: deleted } = await insertIncome(owner.client, { ...row, amount: 50_000 });
    await softDeleteIncome(owner.client, deleted!.id);

    expect(await getMilestone(owner.client, milestone.id)).toMatchObject({
      amount: 100_000,
      paid: 30_000,
      balance: 70_000,
    });

    await insertIncome(owner.client, { ...row, amount: 90_000 });
    const [overpaid] = await listProjectMilestones(owner.client, project.id);
    expect(overpaid).toMatchObject({ paid: 120_000, balance: -20_000 });
  });

  it("MS-6: open debts reflect payments: a fully paid milestone leaves the list", async () => {
    const { client, project, milestone } = await setup({ due_date: "1903-01-01" });
    const row = { client_id: client.id, project_id: project.id, milestone_id: milestone.id };
    const debts = async () =>
      (
        (await owner.client.rpc("list_open_debts", { p_today: "1903-06-01", p_limit: 100 })).data ??
        []
      )
        .filter((debt: { id: string }) => debt.id === milestone.id)
        .map((debt: { balance: number }) => debt.balance);

    expect(await debts()).toEqual([100_000]);
    await insertIncome(owner.client, { ...row, amount: 40_000 });
    expect(await debts()).toEqual([60_000]);
    await insertIncome(owner.client, { ...row, amount: 60_000 });
    expect(await debts()).toEqual([]);
  });

  it("MS-2: a milestone with payments cannot be deleted, even after the payment was deleted", async () => {
    const { client, project, milestone } = await setup();
    const { data: income } = await insertIncome(owner.client, {
      client_id: client.id,
      project_id: project.id,
      milestone_id: milestone.id,
    });
    await softDeleteIncome(owner.client, income!.id);

    const milestoneDelete = await owner.client.from("milestones").delete().eq("id", milestone.id);
    const projectDelete = await owner.client.from("projects").delete().eq("id", project.id);
    const clientDelete = await owner.client.from("clients").delete().eq("id", client.id);

    expect(milestoneDelete.error?.code).toBe(FOREIGN_KEY_VIOLATION);
    expect(projectDelete.error?.code).toBe(FOREIGN_KEY_VIOLATION);
    expect(clientDelete.error?.code).toBe(FOREIGN_KEY_VIOLATION);
  });
});

describe("MS-5: overpayment needs a confirmation that matches the current balance", () => {
  it("MS-5: a payment above the balance is not saved without confirmation", async () => {
    const { client, project, milestone } = await setup();
    const input = incomeInput({
      client_id: client.id,
      project_id: project.id,
      milestone_id: milestone.id,
      amount: 100_001,
    });

    expect(await saveIncome(owner.client, null, input, null)).toEqual({
      status: "needs_confirmation",
      balance: 100_000,
    });
    expect((await getMilestone(owner.client, milestone.id))?.paid).toBe(0);

    const saved = await saveIncome(owner.client, null, input, 100_000);
    expect(saved.status).toBe("saved");
    expect(await getMilestone(owner.client, milestone.id)).toMatchObject({
      paid: 100_001,
      balance: -1,
    });
  });

  it("MS-5: paying exactly the balance needs no confirmation", async () => {
    const { client, project, milestone } = await setup();
    const result = await saveIncome(
      owner.client,
      null,
      incomeInput({
        client_id: client.id,
        project_id: project.id,
        milestone_id: milestone.id,
        amount: 100_000,
      }),
      null,
    );
    expect(result.status).toBe("saved");
  });

  it("MS-5: a confirmation for a balance that changed meanwhile asks again with the new balance", async () => {
    const { client, project, milestone } = await setup();
    const row = { client_id: client.id, project_id: project.id, milestone_id: milestone.id };
    const input = incomeInput({ ...row, amount: 120_000 });
    expect(await saveIncome(owner.client, null, input, null)).toEqual({
      status: "needs_confirmation",
      balance: 100_000,
    });
    // Another payment is recorded before the user confirms.
    await insertIncome(admin.client, { ...row, amount: 30_000 });

    expect(await saveIncome(owner.client, null, input, 100_000)).toEqual({
      status: "needs_confirmation",
      balance: 70_000,
    });
    expect((await saveIncome(owner.client, null, input, 70_000)).status).toBe("saved");
  });

  it("MS-5: editing a payment checks the balance without the payment itself", async () => {
    const { client, project, milestone } = await setup();
    const row = { client_id: client.id, project_id: project.id, milestone_id: milestone.id };
    const id = await savedId(
      await saveIncome(owner.client, null, incomeInput({ ...row, amount: 60_000 }), null),
    );

    expect(
      await saveIncome(owner.client, id, incomeInput({ ...row, amount: 100_000 }), null),
    ).toEqual({ status: "saved", id });
    expect(
      await saveIncome(owner.client, id, incomeInput({ ...row, amount: 100_050 }), null),
    ).toEqual({ status: "needs_confirmation", balance: 100_000 });
  });

  it("MS-5: two full payments recorded at once: one is saved, the other must be confirmed", async () => {
    const { client, project, milestone } = await setup();
    const input = incomeInput({
      client_id: client.id,
      project_id: project.id,
      milestone_id: milestone.id,
      amount: 100_000,
    });

    const results = await Promise.all([
      saveIncome(owner.client, null, input, null),
      saveIncome(admin.client, null, input, null),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual(["needs_confirmation", "saved"]);
    expect(results.find((result) => result.status === "needs_confirmation")).toEqual({
      status: "needs_confirmation",
      balance: 0,
    });
    expect((await getMilestone(owner.client, milestone.id))?.paid).toBe(100_000);
  });

  it("INC-1: editing a deleted or unknown income reports not_found", async () => {
    const client = await insertClient();
    const id = await savedId(
      await saveIncome(owner.client, null, incomeInput({ client_id: client.id }), null),
    );
    await softDeleteIncome(owner.client, id);

    const input = incomeInput({ client_id: client.id });
    expect(await saveIncome(owner.client, id, input, null)).toEqual({ status: "not_found" });
    expect(await saveIncome(owner.client, randomUUID(), input, null)).toEqual({
      status: "not_found",
    });
  });

  it("INC-1: a missing client is reported as a missing reference", async () => {
    expect(
      await saveIncome(owner.client, null, incomeInput({ client_id: randomUUID() }), null),
    ).toEqual({ status: "refused", refusal: "reference_missing" });
  });
});

describe("audit_log contents (criterion 2)", () => {
  it("audit_log: insert, update and soft delete are recorded with the actor and only the changed fields", async () => {
    const { client, project, milestone } = await setup();
    const id = await savedId(
      await saveIncome(
        owner.client,
        null,
        incomeInput({
          client_id: client.id,
          project_id: project.id,
          milestone_id: milestone.id,
          amount: 25_000,
          notes: "שולם ע״י דנה, 050-1234567",
        }),
        null,
      ),
    );
    await saveIncome(
      admin.client,
      id,
      incomeInput({
        client_id: client.id,
        project_id: project.id,
        milestone_id: milestone.id,
        amount: 26_000,
        payment_method: "cash",
        notes: "הערה אחרת",
      }),
      null,
    );
    // Saving without changes adds nothing.
    await saveIncome(
      admin.client,
      id,
      incomeInput({
        client_id: client.id,
        project_id: project.id,
        milestone_id: milestone.id,
        amount: 26_000,
        payment_method: "cash",
        notes: "הערה אחרת",
      }),
      null,
    );
    await softDeleteIncome(owner.client, id);

    const rows = await auditOf(id);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      actor: owner.id,
      entity: "incomes",
      entity_id: id,
      action: "insert",
      diff: {
        client_id: { new: client.id },
        project_id: { new: project.id },
        milestone_id: { new: milestone.id },
        received_date: { new: "2026-03-15" },
        amount: { new: 25_000 },
        payment_method: { new: "bank_transfer" },
        notes: { changed: true },
      },
    });
    expect(rows[1]).toEqual({
      actor: admin.id,
      entity: "incomes",
      entity_id: id,
      action: "update",
      diff: {
        amount: { old: 25_000, new: 26_000 },
        payment_method: { old: "bank_transfer", new: "cash" },
        notes: { changed: true },
      },
    });
    expect(rows[2]).toMatchObject({ actor: owner.id, action: "delete" });
    expect(Object.keys(rows[2].diff)).toEqual(["deleted_at"]);
    // No personal data: neither the notes nor the client's name are in the log.
    const text = JSON.stringify(rows);
    expect(text).not.toContain("דנה");
    expect(text).not.toContain("050-1234567");
    expect(text).not.toContain(client.name);
  });
});

describe("INC-1 / PRJ-3 / CLI-4: lists and totals", () => {
  // Received dates in 1904 keep this block's incomes apart from other data in the database;
  // the assertions filter by this block's own client.
  it("INC-1: lists a month's incomes newest first, with the total, optionally for one client", async () => {
    const { client, project, milestone } = await setup();
    const other = await insertClient();
    const row = { client_id: client.id, project_id: project.id, milestone_id: milestone.id };
    await insertIncome(owner.client, { ...row, received_date: "1904-02-01", amount: 1_000 });
    await insertIncome(owner.client, { ...row, received_date: "1904-02-29", amount: 2_050 });
    await insertIncome(owner.client, {
      client_id: client.id,
      received_date: "1904-02-15",
      amount: 3_000,
    });
    await insertIncome(owner.client, {
      client_id: client.id,
      received_date: "1904-03-01",
      amount: 9_000,
    });
    await insertIncome(owner.client, {
      client_id: client.id,
      received_date: "1904-01-31",
      amount: 9_000,
    });
    const { data: deleted } = await insertIncome(owner.client, {
      client_id: client.id,
      received_date: "1904-02-10",
      amount: 9_000,
    });
    await softDeleteIncome(owner.client, deleted!.id);
    await insertIncome(owner.client, {
      client_id: other.id,
      received_date: "1904-02-20",
      amount: 500,
    });

    const filter = { month: "1904-02", clientId: client.id };
    const page = await listIncomes(owner.client, filter, 0);
    expect(page.hasMore).toBe(false);
    expect(page.items.map((item) => [item.received_date, item.amount])).toEqual([
      ["1904-02-29", 2_050],
      ["1904-02-15", 3_000],
      ["1904-02-01", 1_000],
    ]);
    expect(page.items[0]).toMatchObject({
      client_name: client.name,
      project_id: project.id,
      milestone_id: milestone.id,
      payment_method: "cash",
    });
    expect(page.items[1]).toMatchObject({ project_id: null, project_name: null });
    expect(await getIncomesMonthSummary(owner.client, filter)).toEqual({ count: 3, total: 6_050 });

    const allClients = await getIncomesMonthSummary(owner.client, {
      month: "1904-02",
      clientId: null,
    });
    expect(allClients.count).toBeGreaterThanOrEqual(4);
    expect(allClients.total).toBeGreaterThanOrEqual(6_550);
  });

  it("INC-1: pages are bounded to 100 rows", async () => {
    const client = await insertClient();
    const rows = Array.from({ length: 105 }, () => ({
      client_id: client.id,
      received_date: "1905-05-05",
      amount: 1,
      payment_method: "cash",
    }));
    expect((await service.from(TABLE).insert(rows)).error).toBeNull();

    const { data } = await owner.client.rpc("list_incomes", {
      p_month: "1905-05-01",
      p_client_id: client.id,
      p_limit: 1000,
    });
    const page = await listIncomes(owner.client, { month: "1905-05", clientId: client.id }, 50);

    expect(data).toHaveLength(100);
    expect(page.items).toHaveLength(50);
    expect(page.hasMore).toBe(true);
  });

  it("PRJ-3 / CLI-4: project paid total and client paid total and open balance", async () => {
    const { client, project, milestone } = await setup();
    const second = await insertMilestone(project.id, { amount: 50_000 });
    await insertMilestone(project.id, { amount: 70_000, cancelled_at: "2026-11-10T10:00:00Z" });
    const archived = await insertProject(client.id, { archived_at: "2026-11-10T10:00:00Z" });
    await insertMilestone(archived.id, { amount: 999_000 });
    const row = { client_id: client.id, project_id: project.id };
    await insertIncome(owner.client, { ...row, milestone_id: milestone.id, amount: 130_000 });
    await insertIncome(owner.client, { ...row, milestone_id: second.id, amount: 20_000 });
    await insertIncome(owner.client, { ...row, amount: 5_000 });
    await insertIncome(owner.client, { client_id: client.id, amount: 1_000 });
    const { data: deleted } = await insertIncome(owner.client, { ...row, amount: 77_000 });
    await softDeleteIncome(owner.client, deleted!.id);

    expect(await getProjectPaidTotal(owner.client, project.id)).toBe(155_000);
    expect(await getClientPaymentSummary(owner.client, client.id)).toEqual({
      totalPaid: 156_000,
      // Only the second milestone still has a balance: the first is overpaid (it does not
      // reduce the others), the third is cancelled and the archived project is left out.
      openBalance: 30_000,
    });
    expect(await getProjectPaidTotal(outsider.client, project.id)).toBe(0);
  });
});
