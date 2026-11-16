import type { SupabaseClient } from "@supabase/supabase-js";

import type { ListView } from "@/lib/list-view";
import { agorotFromDb } from "@/lib/money";
import type { ListPage } from "@/lib/paged-list";

import type { ProjectInput } from "./schema";
import { statusesForFilter, type ProjectStatus, type ProjectStatusFilter } from "./status";

/**
 * Data access for projects. Every call runs with the caller's session, so RLS applies; the
 * callers (pages and Server Actions) check access with requireAllowedUser() first.
 */

const TABLE = "projects";
const DETAIL_COLUMNS =
  "id, client_id, name, property_address, status, contract_amount, start_date, end_date, notes, archived_at, client:clients(id, name, archived_at)";

/** Rows per list page. The list is never read without a limit. */
export const PROJECTS_PAGE_SIZE = 25;
/** Projects shown on a client card, most recently updated first. */
export const CLIENT_PROJECTS_LIMIT = 50;
/** Active clients offered in the project form's client list, by name. */
export const CLIENT_OPTIONS_LIMIT = 500;

/** Postgres foreign_key_violation. */
const FOREIGN_KEY_VIOLATION = "23503";
/** Raised by projects_require_active_client(): the client is archived (owner decision). */
const CLIENT_ARCHIVED = "HKA01";

export type ProjectClient = { id: string; name: string; archived_at: string | null };

export type Project = {
  id: string;
  client_id: string;
  name: string;
  property_address: string | null;
  status: ProjectStatus;
  /** Agorot. */
  contract_amount: number | null;
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
  archived_at: string | null;
  client: ProjectClient;
};

export type ProjectListItem = {
  id: string;
  name: string;
  status: ProjectStatus;
  contract_amount: number | null;
  client_name: string;
};

export type ProjectListPage = ListPage<ProjectListItem>;

export type ClientProject = Pick<
  Project,
  "id" | "name" | "status" | "contract_amount" | "archived_at"
>;

export type ClientOption = { id: string; name: string; archived: boolean };

type ListOptions = {
  view: ListView;
  status: ProjectStatusFilter;
  query: string;
  offset: number;
};

type ProjectListRow = Omit<ProjectListItem, "contract_amount"> & { contract_amount: unknown };

/** PRJ-1: one page of the list, newest update first, by status and project or client name. */
export async function listProjects(
  supabase: SupabaseClient,
  { view, status, query, offset }: ListOptions,
): Promise<ProjectListPage> {
  const { data, error } = await supabase.rpc("search_projects", {
    p_archived: view === "archived",
    p_statuses: statusesForFilter(status),
    p_query: query.trim(),
    // One extra row tells whether another page exists.
    p_limit: PROJECTS_PAGE_SIZE + 1,
    p_offset: offset,
  });
  if (error) {
    throw new Error("Could not list projects", { cause: error });
  }
  const rows = (data ?? []) as ProjectListRow[];
  return {
    items: rows.slice(0, PROJECTS_PAGE_SIZE).map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      contract_amount: agorotFromDb(row.contract_amount),
      client_name: row.client_name,
    })),
    hasMore: rows.length > PROJECTS_PAGE_SIZE,
  };
}

type ProjectRow = Omit<Project, "contract_amount"> & { contract_amount: unknown };

/** PRJ-3: one project with its client, or null when it does not exist (or is not visible). */
export async function getProject(supabase: SupabaseClient, id: string): Promise<Project | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select(DETAIL_COLUMNS)
    .eq("id", id)
    .maybeSingle<ProjectRow>();
  if (error) {
    throw new Error("Could not read the project", { cause: error });
  }
  return data ? { ...data, contract_amount: agorotFromDb(data.contract_amount) } : null;
}

/** CLI-4: the client's projects for the client card, archived ones included. */
export async function listClientProjects(
  supabase: SupabaseClient,
  clientId: string,
): Promise<ListPage<ClientProject>> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("id, name, status, contract_amount, archived_at")
    .eq("client_id", clientId)
    .order("updated_at", { ascending: false })
    .order("id")
    .limit(CLIENT_PROJECTS_LIMIT + 1);
  if (error) {
    throw new Error("Could not list the client's projects", { cause: error });
  }
  const rows = data as (Omit<ClientProject, "contract_amount"> & { contract_amount: unknown })[];
  return {
    items: rows.slice(0, CLIENT_PROJECTS_LIMIT).map((row) => ({
      ...row,
      contract_amount: agorotFromDb(row.contract_amount),
    })),
    hasMore: rows.length > CLIENT_PROJECTS_LIMIT,
  };
}

/** Active clients for the project form, by name (at most CLIENT_OPTIONS_LIMIT). */
export async function listActiveClientOptions(supabase: SupabaseClient): Promise<ClientOption[]> {
  const { data, error } = await supabase
    .from("clients")
    .select("id, name")
    .is("archived_at", null)
    .order("name")
    .order("id")
    .limit(CLIENT_OPTIONS_LIMIT);
  if (error) {
    throw new Error("Could not list clients for the project form", { cause: error });
  }
  return (data as { id: string; name: string }[]).map(({ id, name }) => ({
    id,
    name,
    archived: false,
  }));
}

/** One client for the project form (archived or not), or null when it does not exist. */
export async function getClientOption(
  supabase: SupabaseClient,
  id: string,
): Promise<ClientOption | null> {
  const { data, error } = await supabase
    .from("clients")
    .select("id, name, archived_at")
    .eq("id", id)
    .maybeSingle<ProjectClient>();
  if (error) {
    throw new Error("Could not read the client for the project form", { cause: error });
  }
  return data ? { id: data.id, name: data.name, archived: data.archived_at !== null } : null;
}

/** Why the database refused to save a project for its client. */
export type ClientRefusal = "client_archived" | "client_missing";

function clientRefusal(code: string | undefined): ClientRefusal | null {
  if (code === CLIENT_ARCHIVED) {
    return "client_archived";
  }
  return code === FOREIGN_KEY_VIOLATION ? "client_missing" : null;
}

export type InsertProjectResult = { status: "created"; id: string } | { status: ClientRefusal };

export async function insertProject(
  supabase: SupabaseClient,
  input: ProjectInput,
): Promise<InsertProjectResult> {
  const { data, error } = await supabase
    .from(TABLE)
    .insert(input)
    .select("id")
    .single<{ id: string }>();
  if (error) {
    const refusal = clientRefusal(error.code);
    if (refusal) {
      return { status: refusal };
    }
    throw new Error("Could not create the project", { cause: error });
  }
  return { status: "created", id: data.id };
}

export type UpdateProjectResult = "updated" | "not_found" | ClientRefusal;

export async function updateProject(
  supabase: SupabaseClient,
  id: string,
  changes: Partial<ProjectInput> & { archived_at?: string | null },
): Promise<UpdateProjectResult> {
  const { data, error } = await supabase.from(TABLE).update(changes).eq("id", id).select("id");
  if (error) {
    const refusal = clientRefusal(error.code);
    if (refusal) {
      return refusal;
    }
    throw new Error("Could not update the project", { cause: error });
  }
  return data.length > 0 ? "updated" : "not_found";
}

export type DeleteProjectResult = "deleted" | "not_found" | "referenced";

/**
 * Permanently deletes a project (owner decision: only one without milestones or incomes).
 * Those tables (M1.3, M2) reference projects, so the database refuses a referenced project.
 */
export async function deleteProject(
  supabase: SupabaseClient,
  id: string,
): Promise<DeleteProjectResult> {
  const { data, error } = await supabase.from(TABLE).delete().eq("id", id).select("id");
  if (error) {
    if (error.code === FOREIGN_KEY_VIOLATION) {
      return "referenced";
    }
    throw new Error("Could not delete the project", { cause: error });
  }
  return data.length > 0 ? "deleted" : "not_found";
}
