"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { NOTICE_PARAM } from "@/lib/notices";

/**
 * The live region mounts empty and receives the message a moment later, so screen readers
 * register the region first and then announce the change.
 */
const ANNOUNCE_DELAY_MS = 100;

/** A click on one of these is the user's next action; the notice has done its job by then. */
const ACTION_SELECTOR = "a, button, summary, [role='button']";

type RedirectNoticeProps = {
  /** The confirmation to show, or undefined for none. */
  message: string | undefined;
};

/**
 * A one-time confirmation after a redirect ("הלקוח נשמר."), announced politely, shown once
 * whatever way the page was reached (a redirect after a save, a full page load, an address
 * opened directly):
 *
 * - The `?notice=` parameter is removed with router.replace, which also replaces the
 *   router's own address and cached page. A plain history.replaceState changed only the
 *   address bar after a full page load, so the refresh that follows an in-page Server Action
 *   asked for the old address and showed the notice again; Back restored it as well.
 * - The message is kept in this component's state, so the re-render of the page without
 *   the parameter does not remove it at once. It is removed at the user's next action (a
 *   click on a link or button, or a form submit), and a reload or Back no longer has it.
 */
export function RedirectNotice({ message }: RedirectNoticeProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [shown, setShown] = useState<string | undefined>(undefined);
  const announceTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (message === undefined) {
      // Also the re-render after the parameter was removed: what is shown stays.
      return;
    }
    window.clearTimeout(announceTimer.current);
    announceTimer.current = window.setTimeout(() => setShown(message), ANNOUNCE_DELAY_MS);
    const params = new URLSearchParams(window.location.search);
    if (params.has(NOTICE_PARAM)) {
      params.delete(NOTICE_PARAM);
      const query = params.toString();
      router.replace(`${pathname}${query ? `?${query}` : ""}${window.location.hash}`, {
        scroll: false,
      });
    }
  }, [message, pathname, router]);

  useEffect(() => () => window.clearTimeout(announceTimer.current), []);

  useEffect(() => {
    if (shown === undefined) {
      return;
    }
    function dismiss(event: Event) {
      if (
        event.type === "submit" ||
        (event.target instanceof Element && event.target.closest(ACTION_SELECTOR))
      ) {
        setShown(undefined);
      }
    }
    document.addEventListener("click", dismiss, true);
    document.addEventListener("submit", dismiss, true);
    return () => {
      document.removeEventListener("click", dismiss, true);
      document.removeEventListener("submit", dismiss, true);
    };
  }, [shown]);

  // Empty, the region is visually hidden but stays in the accessibility tree (not display:
  // none), so the later message is announced; it takes no space in the layout.
  return (
    <p role="status" className="text-sm font-medium empty:sr-only">
      {shown}
    </p>
  );
}
