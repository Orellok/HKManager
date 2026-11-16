"use client";

import { useCallback, useRef, useTransition } from "react";

/**
 * A transition that runs at most one task at a time. The `pending` state of a transition is
 * only updated on the next render, so several clicks or submits dispatched in the same tick
 * (a double click, a scripted burst) would all see `pending === false`; the ref is updated
 * synchronously and turns them away. `start` returns false when a task was already running.
 *
 * The guard is released when the task ends normally. A task that throws (a Next.js redirect
 * after a successful save) keeps it until the page navigates away, so the save cannot be
 * sent again in between.
 */
export function useGuardedTransition(): [
  pending: boolean,
  start: (task: () => Promise<void>) => boolean,
] {
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);

  const start = useCallback((task: () => Promise<void>) => {
    if (inFlight.current) {
      return false;
    }
    inFlight.current = true;
    startTransition(async () => {
      await task();
      inFlight.current = false;
    });
    return true;
  }, []);

  return [pending, start];
}
