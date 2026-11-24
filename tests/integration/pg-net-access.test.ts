import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createAnonClient,
  createServiceRoleClient,
  createSignedInUser,
  deleteUser,
  queryLocalDatabase,
  testEmail,
  type TestUser,
} from "./support/local-supabase";

/**
 * M7.3-12(c): pg_net's `net` grants to anon / authenticated come from supabase_admin and
 * cannot be revoked by a migration (role postgres). These tests prove neither role can make
 * the database send an HTTP request: `net` is not exposed by the Data API, and every function
 * that calls pg_net is closed to them.
 */
let service: SupabaseClient;
let anon: SupabaseClient;
let member: TestUser;

beforeAll(async () => {
  service = await createServiceRoleClient();
  anon = await createAnonClient();
  member = await createSignedInUser(service, testEmail("pg-net-member"));
});

afterAll(async () => {
  if (member) {
    await deleteUser(service, member.id);
  }
});

describe("M7.3-12: pg_net is out of reach for anon and authenticated", () => {
  it("M7.3-12: the Data API refuses the net schema for anon and a signed-in user", async () => {
    for (const client of [anon, member.client]) {
      const { error } = await client
        .schema("net")
        .rpc("http_post", { url: "https://example.com/", body: {} });
      // PGRST106: the schema is not one of the exposed schemas.
      expect(error?.code).toBe("PGRST106");
      const read = await client.schema("net").from("http_request_queue").select("id");
      expect(read.error?.code).toBe("PGRST106");
    }
  });

  it("M7.3-12: no function that calls pg_net is executable by anon or authenticated", async () => {
    const rows = await queryLocalDatabase<{ fn: string; anon: boolean; authenticated: boolean }>(`
      select p.oid::regprocedure::text as fn,
             has_function_privilege('anon', p.oid, 'execute') as anon,
             has_function_privilege('authenticated', p.oid, 'execute') as authenticated
      from pg_proc as p
      join pg_namespace as n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosrc ~ 'net\\.http_'
      order by 1`);
    expect(rows.map((row) => row.fn)).toContain("invoke_daily_reminders()");
    for (const row of rows) {
      expect(row, row.fn).toMatchObject({ anon: false, authenticated: false });
    }
  });
});
