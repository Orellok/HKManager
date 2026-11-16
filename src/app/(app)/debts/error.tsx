"use client";

import { LoadError } from "@/components/load-error";

/** Shown when the open debts screen could not load its data. */
export default function DebtsError({ retry }: { error: unknown; retry: () => void }) {
  return <LoadError retry={retry} />;
}
