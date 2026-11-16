"use client";

import { LoadError } from "@/components/load-error";

/** Shown when a clients screen (list, card, form) could not load its data. */
export default function ClientsError({ retry }: { error: unknown; retry: () => void }) {
  return <LoadError retry={retry} />;
}
