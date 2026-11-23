"use client";

import { LoadError } from "@/components/load-error";

/** Shown when an expenses screen (list, form) could not load its data. */
export default function ExpensesError({ retry }: { error: unknown; retry: () => void }) {
  return <LoadError retry={retry} />;
}
