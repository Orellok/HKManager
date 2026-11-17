import { randomUUID } from "node:crypto";

import { createServiceRoleClient, test } from "./auth-fixtures";

export type SeedClient = {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
  archived_at?: string;
};

export type SeedProject = {
  client_id: string;
  name: string;
  property_address?: string;
  status?: "lead" | "active" | "on_hold" | "completed" | "cancelled";
  contract_amount?: number;
  start_date?: string;
  end_date?: string;
  notes?: string;
  archived_at?: string;
};

export type SeedMilestone = {
  project_id: string;
  description: string;
  /** Agorot. */
  amount: number;
  due_date: string;
  cancelled_at?: string;
};

export type SeedIncome = {
  client_id: string;
  project_id?: string;
  milestone_id?: string;
  received_date: string;
  /** Agorot. */
  amount: number;
  payment_method?: "bank_transfer" | "bit_paybox" | "cash" | "check" | "credit_card" | "other";
  notes?: string;
};

type DataFixtures = {
  token: string;
  seedClient: (client: SeedClient) => Promise<string>;
  seedProject: (project: SeedProject) => Promise<string>;
  /** Milestones go last in their project's list, in the order they are seeded. */
  seedMilestone: (milestone: SeedMilestone) => Promise<string>;
  seedIncome: (income: SeedIncome) => Promise<string>;
};

async function insertRow(table: string, row: object): Promise<string> {
  const { data, error } = await createServiceRoleClient()
    .from(table)
    .insert(row)
    .select("id")
    .single();
  if (error) {
    throw new Error(`Could not seed a row in ${table}`, { cause: error });
  }
  return data.id as string;
}

/**
 * Each test gets a unique token to put inside every client and project name it creates, so
 * parallel tests and leftovers never collide, and cleanup deletes exactly its own rows:
 * incomes of its clients and projects first (with their audit log rows), then milestones of
 * its projects, then projects (all are ON DELETE RESTRICT), including any project of its
 * clients, then clients. Users cannot delete incomes; the service role can.
 */
export const test_ = test.extend<DataFixtures>({
  token: async ({}, provide) => {
    const token = `e2e${randomUUID().slice(0, 8)}`;
    await provide(token);
    const service = createServiceRoleClient();
    const { data: clients, error: clientsError } = await service
      .from("clients")
      .select("id")
      .ilike("name", `%${token}%`);
    if (clientsError) {
      throw new Error("Could not find E2E clients to clean up", { cause: clientsError });
    }
    const clientIds = (clients ?? []).map((client) => client.id as string);
    const { data: projects, error: projectsError } = await service
      .from("projects")
      .select("id")
      .or(
        [
          `name.ilike.%${token}%`,
          ...(clientIds.length > 0 ? [`client_id.in.(${clientIds})`] : []),
        ].join(","),
      );
    if (projectsError) {
      throw new Error("Could not find E2E projects to clean up", { cause: projectsError });
    }
    const projectIds = (projects ?? []).map((project) => project.id as string);
    const owners = [
      ...(clientIds.length > 0 ? [`client_id.in.(${clientIds})`] : []),
      ...(projectIds.length > 0 ? [`project_id.in.(${projectIds})`] : []),
    ];
    if (owners.length > 0) {
      const { data: incomes, error: incomesError } = await service
        .from("incomes")
        .select("id")
        .or(owners.join(","));
      if (incomesError) {
        throw new Error("Could not find E2E incomes to clean up", { cause: incomesError });
      }
      const incomeIds = (incomes ?? []).map((income) => income.id as string);
      if (incomeIds.length > 0) {
        const audit = await service.from("audit_log").delete().in("entity_id", incomeIds);
        const removed = await service.from("incomes").delete().in("id", incomeIds);
        const incomeError = audit.error ?? removed.error;
        if (incomeError) {
          throw new Error("Could not clean up E2E incomes", { cause: incomeError });
        }
      }
    }
    const milestones =
      projectIds.length > 0
        ? await service.from("milestones").delete().in("project_id", projectIds)
        : { error: null };
    const byProject =
      projectIds.length > 0
        ? await service.from("projects").delete().in("id", projectIds)
        : { error: null };
    const byClientName = await service.from("clients").delete().ilike("name", `%${token}%`);
    const error = milestones.error ?? byProject.error ?? byClientName.error;
    if (error) {
      throw new Error("Could not clean up E2E rows", { cause: error });
    }
  },
  seedClient: async ({}, provide) => {
    await provide((client) => insertRow("clients", client));
  },
  seedProject: async ({}, provide) => {
    await provide((project) => insertRow("projects", project));
  },
  seedMilestone: async ({}, provide) => {
    await provide((milestone) => insertRow("milestones", milestone));
  },
  seedIncome: async ({}, provide) => {
    await provide((income) => insertRow("incomes", { payment_method: "cash", ...income }));
  },
});

export { createServiceRoleClient, expect } from "./auth-fixtures";
