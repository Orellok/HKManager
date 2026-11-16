import { projectPath } from "@/lib/projects/paths";

/** Routes of the milestone forms, under their project. Only ids go into a URL (SPEC 8). */

export function newMilestonePath(projectId: string): string {
  return `${projectPath(projectId)}/milestones/new`;
}

export function editMilestonePath(projectId: string, milestoneId: string): string {
  return `${projectPath(projectId)}/milestones/${encodeURIComponent(milestoneId)}/edit`;
}
