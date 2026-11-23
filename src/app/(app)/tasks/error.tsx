"use client";

import { LoadError } from "@/components/load-error";

/** Shown when a tasks screen (list, form) could not load its data. */
export default function TasksError({ retry }: { error: unknown; retry: () => void }) {
  return <LoadError retry={retry} />;
}
