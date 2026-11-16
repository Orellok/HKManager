"use client";

import { LoadError } from "@/components/load-error";

/** Shown when a projects screen (list, card, form) could not load its data. */
export default function ProjectsError({ retry }: { error: unknown; retry: () => void }) {
  return <LoadError retry={retry} />;
}
