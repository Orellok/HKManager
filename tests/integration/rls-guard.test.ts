import { describe, expect, it } from "vitest";

import { queryLocalDatabase } from "./support/local-supabase";

type TableRow = { table_name: string; rls_enabled: boolean };
type ViewRow = { view_name: string; security_invoker: boolean };

const PUBLIC_TABLES_SQL = `
  select c.relname as table_name, c.relrowsecurity as rls_enabled
  from pg_catalog.pg_class as c
  join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
  order by c.relname
`;

const PUBLIC_VIEWS_SQL = `
  select c.relname as view_name,
    coalesce('security_invoker=true' = any (c.reloptions), false) as security_invoker
  from pg_catalog.pg_class as c
  join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'v'
  order by c.relname
`;

describe("RLS guard", () => {
  it("AUTH-4: every table in the public schema has row level security enabled", async () => {
    const tables = await queryLocalDatabase<TableRow>(PUBLIC_TABLES_SQL);

    // Guards against a vacuous pass if the query stopped seeing the schema.
    expect(tables.map((table) => table.table_name)).toEqual(
      expect.arrayContaining([
        "allowed_users",
        "clients",
        "projects",
        "milestones",
        "expense_categories",
        "expenses",
        "recorded_expense_files",
      ]),
    );

    const tablesWithoutRls = tables
      .filter((table) => !table.rls_enabled)
      .map((table) => table.table_name);
    expect(tablesWithoutRls).toEqual([]);
  });

  it("AUTH-4: every view in the public schema runs with the caller's rights, so RLS applies", async () => {
    const views = await queryLocalDatabase<ViewRow>(PUBLIC_VIEWS_SQL);

    expect(views.map((view) => view.view_name)).toEqual(
      expect.arrayContaining(["milestone_balances"]),
    );
    expect(views.filter((view) => !view.security_invoker).map((view) => view.view_name)).toEqual(
      [],
    );
  });
});
