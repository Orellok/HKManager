"use client";

import { LoadError } from "@/components/load-error";

/** Shown when a settings screen could not load its data. */
export default function SettingsError({ retry }: { error: unknown; retry: () => void }) {
  return <LoadError retry={retry} />;
}
