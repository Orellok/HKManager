import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createServiceRoleClient, testEmail } from "./support/local-supabase";
import { runSqlAsRole } from "./support/sql-as-role";

const TABLE = "allowed_users";
const TEST_DOMAIN_PATTERN = "%@hkmanager.test";
const INSUFFICIENT_PRIVILEGE = "42501";
const SUBJECT = "00000000-0000-4000-8000-0000000000aa";

let service: SupabaseClient;
let adminEmail: string;

function authenticatedClaims(extra: Record<string, unknown>) {
  return { sub: SUBJECT, role: "authenticated", aud: "authenticated", ...extra };
}

type Probe = { is_allowed: boolean; is_admin: boolean; visible_rows: number };

async function probe(claims: Record<string, unknown>): Promise<Probe> {
  const result = await runSqlAsRole<Probe>({
    role: "authenticated",
    claims,
    sql: `select public.is_allowed_user() as is_allowed,
                 public.is_admin() as is_admin,
                 (select count(*)::int from public.allowed_users) as visible_rows`,
  });
  if (!result.ok) {
    throw new Error(`Probe failed: ${result.sqlState} ${result.message}`);
  }
  return result.rows[0];
}

beforeAll(async () => {
  service = await createServiceRoleClient();
  adminEmail = testEmail("claims-admin");
  const { error } = await service.from(TABLE).insert({ email: adminEmail, role: "admin" });
  if (error) {
    throw new Error("Could not insert the admin allowlist row", { cause: error });
  }
});

afterAll(async () => {
  if (service) {
    const { error } = await service.from(TABLE).delete().ilike("email", TEST_DOMAIN_PATTERN);
    if (error) {
      throw new Error("Could not clean up integration test data", { cause: error });
    }
  }
});

describe("JWT email claim", () => {
  it("AUTH-4: control – an admin's email claim grants access, so the probe can see rows", async () => {
    const result = await probe(authenticatedClaims({ email: adminEmail.toUpperCase() }));

    expect(result.is_allowed).toBe(true);
    expect(result.is_admin).toBe(true);
    expect(result.visible_rows).toBeGreaterThan(0);
  });

  it.each([
    ["missing", {}],
    ["null", { email: null }],
    ["empty", { email: "" }],
    ["blank", { email: " " }],
  ])("AUTH-4: a JWT with a %s email claim gets no access", async (_case, extra) => {
    const result = await probe(authenticatedClaims(extra));

    expect(result).toEqual({ is_allowed: false, is_admin: false, visible_rows: 0 });
  });

  it.each([
    ["missing", {}],
    ["empty", { email: "" }],
  ])("AUTH-4: a JWT with a %s email claim cannot write the allowlist", async (_case, extra) => {
    const result = await runSqlAsRole({
      role: "authenticated",
      claims: authenticatedClaims(extra),
      sql: `insert into public.allowed_users (email, role)
            values ('${testEmail("claims-insert")}', 'admin') returning id`,
    });

    expect(result).toMatchObject({ ok: false, sqlState: INSUFFICIENT_PRIVILEGE });
  });
});
