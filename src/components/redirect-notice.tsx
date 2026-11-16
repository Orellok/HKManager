"use client";

import { useEffect } from "react";

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
  useEffect(() => {
    if (message === undefined) {
      return;
    }
    const url = new URL(window.location.href);
    if (url.searchParams.has(param)) {
      url.searchParams.delete(param);
      window.history.replaceState(window.history.state, "", url);
    }
  }, [message, param]);

  return (
    <p role="status" className="text-sm font-medium empty:hidden">
      {message}
    </p>
  );
}
