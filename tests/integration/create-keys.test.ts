import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { insertClient } from "@/lib/clients/queries";
import { saveIncome } from "@/lib/incomes/queries";
import { insertMilestone } from "@/lib/milestones/queries";
import { insertProject } from "@/lib/projects/queries";
import { insertTask } from "@/lib/tasks/queries";

import {
  createServiceRoleClient,
  createSignedInUser,
  deleteUser,
  testEmail,
  type TestUser,
} from "./support/local-supabase";

/** Every client this file creates has this marker in its notes; tasks in their title. */
const MARKER = `it-create-keys-${randomUUID()}`;
const INSUFFICIENT_PRIVILEGE = "42501";

let service: SupabaseClient;
let owner: TestUser;
const createdUserIds: string[] = [];

function clientInput() {
  return {
    name: `לקוח ${MARKER} ${randomUUID().slice(0, 8)}`,
    phone: null,
    email: null,
    address: null,
    notes: MARKER,
  };
}

async function countWhere(table: string, column: string, value: string): Promise<number> {
  const { count, error } = await service
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq(column, value);
  if (error) {
    throw new Error(`Could not count ${table}`, { cause: error });
  }
  return count ?? 0;
}

async function newClientId(): Promise<string> {
  return (await insertClient(owner.client, clientInput())).id;
}

async function newProjectId(clientId: string): Promise<string> {
  const result = await insertProject(owner.client, {
    client_id: clientId,
    name: `פרויקט ${MARKER}`,
    property_address: null,
    start_date: null,
    end_date: null,
    contract_amount: null,
    status: "active",
    notes: null,
  });
  if (result.status !== "created") {
    throw new Error(`Could not create a test project: ${result.status}`);
  }
  return result.id;
}

beforeAll(async () => {
  service = await createServiceRoleClient();
  owner = await createSignedInUser(service, testEmail("create-keys-owner"));
  createdUserIds.push(owner.id);
  const { error } = await service
    .from("allowed_users")
    .insert({ email: owner.email, role: "owner" });
  if (error) {
    throw new Error("Could not allowlist the test user", { cause: error });
  }
});

afterAll(async () => {
  if (!service) {
    return;
  }
  const cleanupErrors: unknown[] = [];
  const { data: clients } = await service.from("clients").select("id").eq("notes", MARKER);
  const clientIds = (clients ?? []).map((row) => row.id as string);
  const tasks = await service.from("tasks").delete().like("title", `%${MARKER}%`);
  cleanupErrors.push(...[tasks.error].filter(Boolean));
  if (clientIds.length > 0) {
    const { data: incomes } = await service.from("incomes").select("id").in("client_id", clientIds);
    const incomeIds = (incomes ?? []).map((row) => row.id as string);
    if (incomeIds.length > 0) {
      const audit = await service.from("audit_log").delete().in("entity_id", incomeIds);
      const removed = await service.from("incomes").delete().in("id", incomeIds);
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
    cleanupErrors.push(...[removedClients.error].filter(Boolean));
  }
  const allowlist = await service
    .from("allowed_users")
    .delete()
    .eq("email", owner?.email ?? "");
  cleanupErrors.push(...[allowlist.error].filter(Boolean));
  for (const userId of createdUserIds) {
    try {
      await deleteUser(service, userId);
    } catch (deleteError) {
      cleanupErrors.push(deleteError);
    }
  }
  if (cleanupErrors.length > 0) {
    throw new Error("Cleanup failed", { cause: cleanupErrors });
  }
});

describe("M7.1-8: a create sent again with the same key creates one row", () => {
  it("M7.1-8: clients – the repeat returns the first client, also when both run at once", async () => {
    const key = randomUUID();
    const input = clientInput();
    const first = await insertClient(owner.client, input, key);
    const again = await insertClient(owner.client, input, key);
    expect(again.id).toBe(first.id);
    expect(await countWhere("clients", "name", input.name)).toBe(1);

    const raceKey = randomUUID();
    const raceInput = clientInput();
    const [a, b] = await Promise.all([
      insertClient(owner.client, raceInput, raceKey),
      insertClient(owner.client, raceInput, raceKey),
    ]);
    expect(a.id).toBe(b.id);
    expect(await countWhere("clients", "name", raceInput.name)).toBe(1);
  });

  it("M7.1-8: clients – without a key every insert creates a row", async () => {
    const input = clientInput();
    await insertClient(owner.client, input);
    await insertClient(owner.client, input, null);
    expect(await countWhere("clients", "name", input.name)).toBe(2);
  });

  it("M7.1-8: projects", async () => {
    const clientId = await newClientId();
    const key = randomUUID();
    const input = {
      client_id: clientId,
      name: `פרויקט ${MARKER}`,
      property_address: null,
      start_date: null,
      end_date: null,
      contract_amount: null,
      status: "active" as const,
      notes: null,
    };
    const first = await insertProject(owner.client, input, key);
    const again = await insertProject(owner.client, input, key);
    expect(again).toEqual(first);
    expect(await countWhere("projects", "client_id", clientId)).toBe(1);
  });

  it("M7.1-8: milestones", async () => {
    const projectId = await newProjectId(await newClientId());
    const key = randomUUID();
    const input = { description: "מקדמה", amount: 100_000, due_date: "2026-05-01" };
    expect(await insertMilestone(owner.client, projectId, input, key)).toBe("created");
    expect(await insertMilestone(owner.client, projectId, input, key)).toBe("created");
    expect(await countWhere("milestones", "project_id", projectId)).toBe(1);
  });

  it("M7.1-8: incomes (save_income) – the repeat returns the first income; edits ignore the key", async () => {
    const clientId = await newClientId();
    const key = randomUUID();
    const input = {
      client_id: clientId,
      project_id: null,
      milestone_id: null,
      received_date: "2026-03-15",
      amount: 10_000,
      payment_method: "bank_transfer" as const,
      notes: null,
    };
    const first = await saveIncome(owner.client, null, input, null, key);
    const again = await saveIncome(owner.client, null, input, null, key);
    expect(first.status).toBe("saved");
    expect(again).toEqual(first);
    const [a, b] = await Promise.all([
      saveIncome(owner.client, null, input, null, randomUUID()),
      saveIncome(owner.client, null, input, null, null),
    ]);
    expect(a.status).toBe("saved");
    expect(b.status).toBe("saved");
    expect(await countWhere("incomes", "client_id", clientId)).toBe(3);
    if (first.status === "saved") {
      const edited = await saveIncome(
        owner.client,
        first.id,
        { ...input, amount: 20_000 },
        null,
        key,
      );
      expect(edited).toEqual({ status: "saved", id: first.id });
    }
    expect(await countWhere("incomes", "client_id", clientId)).toBe(3);
  });

  it("M7.1-8: incomes – a concurrent repeat of the same key creates one income", async () => {
    const clientId = await newClientId();
    const key = randomUUID();
    const input = {
      client_id: clientId,
      project_id: null,
      milestone_id: null,
      received_date: "2026-03-16",
      amount: 5_000,
      payment_method: "cash" as const,
      notes: null,
    };
    const [a, b] = await Promise.all([
      saveIncome(owner.client, null, input, null, key),
      saveIncome(owner.client, null, input, null, key),
    ]);
    expect(a).toEqual(b);
    expect(await countWhere("incomes", "client_id", clientId)).toBe(1);
  });

  it("M7.1-8: tasks", async () => {
    const key = randomUUID();
    const title = `משימה ${MARKER} ${randomUUID().slice(0, 8)}`;
    const input = {
      title,
      due_date: null,
      priority: "normal" as const,
      client_id: null,
      project_id: null,
      description: null,
      status: "open" as const,
    };
    const first = await insertTask(owner.client, input, key);
    const again = await insertTask(owner.client, input, key);
    expect(again).toEqual(first);
    expect(await countWhere("tasks", "title", title)).toBe(1);
  });

  it("M7.1-8: the key is per table: the same key may create a client and a task", async () => {
    const key = randomUUID();
    await insertClient(owner.client, clientInput(), key);
    const title = `משימה ${MARKER} ${randomUUID().slice(0, 8)}`;
    const result = await insertTask(
      owner.client,
      {
        title,
        due_date: null,
        priority: "low",
        client_id: null,
        project_id: null,
        description: null,
        status: "open",
      },
      key,
    );
    expect(result.status).toBe("saved");
  });

  it("M7.1-8: users cannot change a create key afterwards (no UPDATE grant)", async () => {
    const { id } = await insertClient(owner.client, clientInput(), randomUUID());
    for (const table of ["clients", "projects", "milestones", "incomes", "tasks"]) {
      const { error } = await owner.client
        .from(table)
        .update({ create_key: randomUUID() })
        .eq("id", id);
      expect(error?.code, table).toBe(INSUFFICIENT_PRIVILEGE);
    }
  });
});
