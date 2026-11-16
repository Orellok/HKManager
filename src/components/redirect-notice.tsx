"use client";

import { useEffect, useState } from "react";

/**
 * The live region mounts empty and receives the message a moment later, so screen readers
 * register the region first and then announce the change.
 */
const ANNOUNCE_DELAY_MS = 100;

type RedirectNoticeProps = {
  /** The confirmation to show, or undefined for none. */
  message: string | undefined;
  /** The query parameter that carried the notice; removed from the address after showing it. */
  param: string;
};

/**
 * A one-time confirmation after a redirect ("הלקוח נשמר."), announced politely. The query
 * parameter is removed with history.replaceState, so a reload or a later refresh of the page
 * does not show it again.
 */
export function RedirectNotice({ message, param }: RedirectNoticeProps) {
  const [shown, setShown] = useState<string | undefined>(undefined);

  useEffect(() => {
    const timer = window.setTimeout(() => setShown(message), ANNOUNCE_DELAY_MS);
    if (message !== undefined) {
      const url = new URL(window.location.href);
      if (url.searchParams.has(param)) {
        url.searchParams.delete(param);
        window.history.replaceState(window.history.state, "", url);
      }
    }
    return () => window.clearTimeout(timer);
  }, [message, param]);

  // Empty, the region is visually hidden but stays in the accessibility tree (not display:
  // none), so the later message is announced; it takes no space in the layout.
  return (
    <p role="status" className="text-sm font-medium empty:sr-only">
      {shown}
    </p>
  );
}
