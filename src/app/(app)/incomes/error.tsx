"use client";

import { LoadError } from "@/components/load-error";

/** Shown when an incomes screen (list, form) could not load its data. */
export default function IncomesError({ retry }: { error: unknown; retry: () => void }) {
  return <LoadError retry={retry} />;
}
