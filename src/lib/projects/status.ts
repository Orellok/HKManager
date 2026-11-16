/** PRJ-2: project statuses, in workflow order, with their Hebrew labels. */
export const PROJECT_STATUSES = ["lead", "active", "on_hold", "completed", "cancelled"] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  lead: "ליד",
  active: "פעיל",
  on_hold: "מושהה",
  completed: "הושלם",
  cancelled: "בוטל",
};

export function isProjectStatus(value: unknown): value is ProjectStatus {
  return typeof value === "string" && (PROJECT_STATUSES as readonly string[]).includes(value);
}

/**
 * The list's status filter. Owner decision (M1.2): by default the list shows open projects
 * (lead, active, on_hold); completed and cancelled ones are a filter away.
 */
export const PROJECT_STATUS_FILTERS = ["open", "all", ...PROJECT_STATUSES] as const;

export type ProjectStatusFilter = (typeof PROJECT_STATUS_FILTERS)[number];

export const DEFAULT_STATUS_FILTER: ProjectStatusFilter = "open";

const OPEN_STATUSES: readonly ProjectStatus[] = ["lead", "active", "on_hold"];

export const STATUS_FILTER_LABELS: Record<ProjectStatusFilter, string> = {
  open: "פתוחים (ליד, פעיל, מושהה)",
  all: "כל הסטטוסים",
  ...PROJECT_STATUS_LABELS,
};

/** The statuses a filter shows, or null for all of them. */
export function statusesForFilter(filter: ProjectStatusFilter): readonly ProjectStatus[] | null {
  if (filter === "all") {
    return null;
  }
  return filter === "open" ? OPEN_STATUSES : [filter];
}
