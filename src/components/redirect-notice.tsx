"use client";

import { useEffect, useState } from "react";

import { NOTICE_PARAM } from "@/lib/notices";

/**
 * The live region mounts empty and receives the message a moment later, so screen readers
 * register the region first and then announce the change.
 */
const ANNOUNCE_DELAY_MS = 100;

type RedirectNoticeProps = {
  /** The confirmation to show, or undefined for none. */
  message: string | undefined;
};

/**
 * A one-time confirmation after a redirect ("הלקוח נשמר."), announced politely. The `?notice=`
 * parameter is removed from the address with history.replaceState, so a reload or a later
 * refresh of the page does not show it again.
 *
 * The state passed to replaceState must not be the router's own (window.history.state):
 * Next.js takes a call with its own state for one of its internal calls and leaves its
 * router out of it, so the router kept the old address, put `?notice=` back after the
 * refresh that follows an in-page Server Action, and the page rendered the notice again.
 * With other state, Next.js updates its router to the new address as well.
 */
export function RedirectNotice({ message }: RedirectNoticeProps) {
  const [shown, setShown] = useState<string | undefined>(undefined);

  useEffect(() => {
    const timer = window.setTimeout(() => setShown(message), ANNOUNCE_DELAY_MS);
    if (message !== undefined) {
      const url = new URL(window.location.href);
      if (url.searchParams.has(NOTICE_PARAM)) {
        url.searchParams.delete(NOTICE_PARAM);
        window.history.replaceState(null, "", url);
      }
    }
    return () => window.clearTimeout(timer);
  }, [message]);

  // Empty, the region is visually hidden but stays in the accessibility tree (not display:
  // none), so the later message is announced; it takes no space in the layout.
  return (
    <p role="status" className="text-sm font-medium empty:sr-only">
      {shown}
    </p>
  );
}
