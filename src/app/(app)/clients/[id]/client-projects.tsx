import Link from "next/link";

import { buttonClasses } from "@/components/button";
import { ProjectStatusBadge } from "@/components/project-status-badge";
import { formatAgorot } from "@/lib/money";
import type { ListPage } from "@/lib/paged-list";
import { newProjectPath, projectPath } from "@/lib/projects/paths";
import { CLIENT_PROJECTS_LIMIT, type ClientProject } from "@/lib/projects/queries";

type ClientProjectsProps = {
  clientId: string;
  isClientArchived: boolean;
  projects: ListPage<ClientProject>;
};

const HEADING_ID = "client-projects-heading";

/**
 * CLI-4: the client's projects on the client card (name, status, amount), with "פרויקט חדש"
 * for this client. Owner decision (M1.2): an archived client gets no new project; the card
 * says to restore the client first (the restore button is on the same card).
 */
export function ClientProjects({ clientId, isClientArchived, projects }: ClientProjectsProps) {
  return (
    <section aria-labelledby={HEADING_ID} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={HEADING_ID} className="text-xl font-semibold">
          פרויקטים
        </h2>
        {isClientArchived ? null : (
          <Link href={newProjectPath(clientId)} className={buttonClasses("secondary")}>
            פרויקט חדש
          </Link>
        )}
      </div>
      {isClientArchived ? (
        <p className="text-muted-foreground text-sm">
          הלקוח בארכיון. כדי לפתוח לו פרויקט חדש, יש לשחזר אותו קודם מהארכיון.
        </p>
      ) : null}

      {projects.items.length === 0 ? (
        <p className="text-muted-foreground">אין ללקוח פרויקטים.</p>
      ) : (
        <ul aria-labelledby={HEADING_ID} className="divide-y rounded-lg border">
          {projects.items.map((project) => (
            <li key={project.id}>
              <Link
                href={projectPath(project.id)}
                className="hover:bg-accent flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2"
              >
                <span className="min-w-0 font-medium wrap-anywhere">
                  {project.name}
                  {project.archived_at !== null ? (
                    <span className="text-muted-foreground font-normal"> (בארכיון)</span>
                  ) : null}
                </span>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {project.contract_amount !== null ? (
                    <span className="text-sm">{formatAgorot(project.contract_amount)}</span>
                  ) : null}
                  <ProjectStatusBadge status={project.status} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {projects.hasMore ? (
        <p className="text-muted-foreground text-sm">
          מוצגים {CLIENT_PROJECTS_LIMIT} הפרויקטים שעודכנו לאחרונה. את כל הפרויקטים אפשר למצוא
          בחיפוש ברשימת הפרויקטים.
        </p>
      ) : null}
    </section>
  );
}
