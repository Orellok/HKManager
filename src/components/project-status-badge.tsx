import { PROJECT_STATUS_LABELS, type ProjectStatus } from "@/lib/projects/status";

/** PRJ-2: a project's status as text in a neutral pill (never color alone). */
export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <span className="bg-muted inline-flex shrink-0 items-center rounded-full border px-3 py-0.5 text-sm">
      {PROJECT_STATUS_LABELS[status]}
    </span>
  );
}
