import { notFound } from "next/navigation";

import { logDbFailure } from "@/lib/log";
import { getProject, type Project } from "@/lib/projects/queries";
import { projectIdSchema } from "@/lib/projects/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** The project named by the route, or the 404 screen. Call after requireAllowedUser(). */
export async function loadProjectOrNotFound(params: Promise<{ id: string }>): Promise<Project> {
  const parsed = projectIdSchema.safeParse((await params).id);
  if (!parsed.success) {
    notFound();
  }
  let project: Project | null;
  try {
    project = await getProject(await createSupabaseServerClient(), parsed.data);
  } catch (error) {
    // Logged by code only; the error boundary gets no database details (SPEC 8).
    logDbFailure("projects", "read", error);
    throw new Error("Could not load the project");
  }
  if (!project) {
    notFound();
  }
  return project;
}
