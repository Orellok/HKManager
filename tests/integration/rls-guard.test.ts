import { describe, expect, it } from "vitest";

import { queryLocalDatabase } from "./support/local-supabase";

type TableRow = { table_name: string; rls_enabled: boolean };

const PUBLIC_TABLES_SQL = `
  select c.relname as table_name, c.relrowsecurity as rls_enabled
  from pg_catalog.pg_class as c
  join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
  order by c.relname
`;

describe("RLS guard", () => {
  it("AUTH-4: every table in the public schema has row level security enabled", async () => {
    const tables = await queryLocalDatabase<TableRow>(PUBLIC_TABLES_SQL);

    // Guards against a vacuous pass if the query stopped seeing the schema.
    expect(tables.map((table) => table.table_name)).toEqual(
      expect.arrayContaining(["allowed_users", "clients"]),
    );

    const tablesWithoutRls = tables
      .filter((table) => !table.rls_enabled)
      .map((table) => table.table_name);
    expect(tablesWithoutRls).toEqual([]);
  });
});
