"use client";

import { useSyncExternalStore } from "react";

function subscribe(): () => void {
  return () => {};
}

/**
 * False in the server render and while React hydrates it, true from then on. A controlled
 * field that the user changes before hydration would be reset to its state by hydration,
 * silently dropping the choice; such fields stay disabled until this is true.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
