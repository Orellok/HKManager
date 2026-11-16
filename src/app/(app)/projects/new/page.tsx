import Link from "next/link";

import { buttonClasses } from "@/components/button";
import { requireAllowedUser } from "@/lib/auth/guards";
import { NEW_CLIENT_PATH, clientPath } from "@/lib/clients/paths";
import { createProjectAction } from "@/lib/projects/actions";
import { CLIENT_PARAM, PROJECTS_PATH } from "@/lib/projects/paths";
import { EMPTY_PROJECT_FORM_VALUES } from "@/lib/projects/schema";

import { loadFormClients } from "../load-form-clients";
import { ProjectForm } from "../project-form";

/**
 * PRJ-1: new project. `?client=<id>` (from a client card, CLI-4) chooses the client. Owner
 * decision (M1.2): an archived client cannot get a new project; the page explains and links
 * to the client card, where the client can be restored.
 */
export default async function NewProjectPage({ searchParams }: PageProps<"/projects/new">) {
  await requireAllowedUser();
  const { options, selected } = await loadFormClients((await searchParams)[CLIENT_PARAM]);

  if (selected?.archived) {
    return (
      <section className="space-y-6">
        <h1 className="text-2xl font-semibold">פרויקט חדש</h1>
        <div className="max-w-xl space-y-3 rounded-lg border p-6">
          <p className="font-medium wrap-anywhere">הלקוח &quot;{selected.name}&quot; בארכיון.</p>
          <p className="text-muted-foreground text-sm">
            כדי לפתוח לו פרויקט חדש, יש לשחזר אותו קודם מהארכיון בכרטיס הלקוח.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href={clientPath(selected.id)} className={buttonClasses("primary")}>
              לכרטיס הלקוח
            </Link>
            <Link href={PROJECTS_PATH} className={buttonClasses("secondary")}>
              חזרה לרשימת הפרויקטים
            </Link>
          </div>
        </div>
      </section>
    );
  }

  if (options.length === 0) {
    return (
      <section className="space-y-6">
        <h1 className="text-2xl font-semibold">פרויקט חדש</h1>
        <div className="max-w-xl space-y-3 rounded-lg border p-6">
          <p className="font-medium">אין עדיין לקוחות פעילים.</p>
          <p className="text-muted-foreground text-sm">
            כל פרויקט שייך ללקוח. יש להוסיף לקוח קודם.
          </p>
          <Link href={NEW_CLIENT_PATH} className={buttonClasses("primary")}>
            הוספת לקוח
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">פרויקט חדש</h1>
      <ProjectForm
        action={createProjectAction}
        initialValues={{ ...EMPTY_PROJECT_FORM_VALUES, client_id: selected?.id ?? "" }}
        clientOptions={options}
        submitLabel="שמירת פרויקט"
        cancelHref={selected ? clientPath(selected.id) : PROJECTS_PATH}
      />
    </section>
  );
}
