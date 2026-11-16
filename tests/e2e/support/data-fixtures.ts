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

type DataFixtures = {
  token: string;
  seedClient: (client: SeedClient) => Promise<string>;
  seedProject: (project: SeedProject) => Promise<string>;
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
 * projects first (clients are ON DELETE RESTRICT), including any project of its clients.
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
    const byName = await service.from("projects").delete().ilike("name", `%${token}%`);
    const byClient =
      clientIds.length > 0
        ? await service.from("projects").delete().in("client_id", clientIds)
        : { error: null };
    const byClientName = await service.from("clients").delete().ilike("name", `%${token}%`);
    const error = byName.error ?? byClient.error ?? byClientName.error;
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
});

export { createServiceRoleClient, expect } from "./auth-fixtures";
