"use client";

import { LoadError } from "@/components/load-error";

/** Shown when the calendar could not load its tasks. */
export default function CalendarError({ retry }: { error: unknown; retry: () => void }) {
  return <LoadError retry={retry} />;
}
