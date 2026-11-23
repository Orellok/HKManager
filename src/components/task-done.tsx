"use client";

import { useCallback, useRef, useState } from "react";

import { REQUEST_FAILED_MESSAGE } from "@/components/archive-delete-actions";
import { callServerAction } from "@/lib/auth/action-failure";
import { setTaskDoneAction } from "@/lib/tasks/actions";
import type { TaskStatus } from "@/lib/tasks/status";
import { cn } from "@/lib/utils";

type ToggleableTask = { id: string; title: string; status: TaskStatus };

type Announcement = { text: string; error: boolean } | null;

/**
 * TASK-4: the one-tap "בוצע" toggle of a list of tasks (the tasks list, the dashboard card,
 * the calendar, the client and project cards). A task marked done stays where it is, shown as
 * done with the button pressed, so the same button undoes it ("ביטול סימון") and keyboard
 * focus never jumps; the task leaves the open lists on the next load.
 *
 * Races: each task has at most one request in flight (a synchronous guard, so a double tap
 * sends one request), and every request names the state it wants rather than "toggle", so a
 * repeat or a change made meanwhile in another tab cannot flip it back. The result is
 * announced in the list's live region (ToggleAnnouncement).
 */
export function useTaskDoneToggles() {
  /** The status each toggled task has now, by id; untouched tasks keep their own. */
  const [statuses, setStatuses] = useState<ReadonlyMap<string, TaskStatus>>(new Map());
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const [announcement, setAnnouncement] = useState<Announcement>(null);
  const inFlight = useRef(new Set<string>());

  const statusOf = useCallback(
    (task: ToggleableTask): TaskStatus => statuses.get(task.id) ?? task.status,
    [statuses],
  );

  function setPending(id: string, pending: boolean) {
    setPendingIds((previous) => {
      const next = new Set(previous);
      if (pending) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  async function toggle(task: ToggleableTask) {
    if (inFlight.current.has(task.id)) {
      return;
    }
    inFlight.current.add(task.id);
    const done = statusOf(task) !== "done";
    setPending(task.id, true);
    setAnnouncement(null);
    try {
      const call = await callServerAction(() => setTaskDoneAction({ taskId: task.id, done }));
      if (call.status === "redirected") {
        return;
      }
      if (call.status === "failed") {
        setAnnouncement({ text: REQUEST_FAILED_MESSAGE, error: true });
        return;
      }
      const result = call.value;
      if (!result.ok) {
        setAnnouncement({ text: result.error, error: true });
        return;
      }
      setStatuses((previous) => new Map(previous).set(task.id, result.done ? "done" : "open"));
      setAnnouncement({
        text: result.done
          ? `המשימה "${task.title}" סומנה כבוצעה.`
          : `הסימון בוטל. המשימה "${task.title}" פתוחה.`,
        error: false,
      });
    } finally {
      inFlight.current.delete(task.id);
      setPending(task.id, false);
    }
  }

  /** Drops what was toggled here, e.g. when a fresh list from the database replaces the old. */
  const forget = useCallback(() => setStatuses(new Map()), []);

  return {
    statusOf,
    isPending: (id: string) => pendingIds.has(id),
    toggle,
    forget,
    announcement,
  };
}

/**
 * The live region of a list's toggles. It stays mounted (empty when there is nothing to say),
 * so screen readers announce each result.
 */
export function ToggleAnnouncement({ announcement }: { announcement: Announcement }) {
  return (
    <p
      role="status"
      className={cn(
        "text-sm font-medium wrap-anywhere empty:sr-only",
        announcement?.error && "text-destructive",
      )}
    >
      {announcement?.text}
    </p>
  );
}

type TaskDoneButtonProps = {
  title: string;
  done: boolean;
  pending: boolean;
  onToggle: () => void;
  className?: string;
};

/**
 * A toggle button (aria-pressed) named "בוצע – <title>": pressed while the task is done.
 * Done is shown by the pressed state, a check mark and the text, not by color alone. While
 * its request runs it keeps focus and ignores clicks (aria-disabled).
 */
export function TaskDoneButton({ title, done, pending, onToggle, className }: TaskDoneButtonProps) {
  return (
    <button
      type="button"
      aria-pressed={done}
      aria-label={`בוצע – ${title}`}
      aria-disabled={pending || undefined}
      aria-busy={pending || undefined}
      onClick={pending ? undefined : onToggle}
      className={cn(
        "inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-md border-2 px-3 text-sm font-medium transition-colors aria-disabled:cursor-wait aria-disabled:opacity-60",
        done
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-background hover:bg-accent border-current",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex size-4 items-center justify-center rounded-sm border-2 border-current text-xs leading-none",
        )}
      >
        {done ? "✓" : ""}
      </span>
      בוצע
    </button>
  );
}
