"use client";

import { useState } from "react";

import { REQUEST_FAILED_MESSAGE } from "@/components/archive-delete-actions";
import { Button } from "@/components/button";
import { useGuardedTransition } from "@/components/use-guarded-transition";
import { NO_ACTION_STATUS, type ActionStatus } from "@/lib/action-status";
import { callServerAction } from "@/lib/auth/action-failure";
import { acknowledgeCeilingAlertAction } from "@/lib/ceiling/actions";
import type { CeilingThreshold } from "@/lib/ceiling/status";

import { CEILING_HEADING_ID } from "./ceiling-progress";

/** CEIL-5: the exact wording of the banner at 100%. */
export const CEILING_EXCEEDED_MESSAGE = "יש לפנות לרואה חשבון/רשות המסים";

type CeilingBannersProps = {
  year: number;
  /** CEIL-4: the threshold waiting for acknowledgement, or null. */
  banner: CeilingThreshold | null;
  /** CEIL-5: the turnover reached the ceiling. */
  exceeded: boolean;
  /** "72.4%" etc. */
  percentText: string;
};

const BANNER_CLASSES = "space-y-2 rounded-lg border-2 border-current bg-muted p-4";

/**
 * CEIL-4 / CEIL-5: the ceiling banners of the tax year. A crossed threshold (70/85/95%) shows
 * until a user acknowledges it; the acknowledgement is stored for the year and threshold and
 * hides it for both users. At 100% a banner that cannot be dismissed replaces them. Marked by
 * a heavy border and the word "התראה", not by color alone.
 *
 * After the acknowledgement the banner disappears with the refreshed page; focus moves to the
 * ceiling's heading and the result is announced in a live region that stays mounted.
 */
export function CeilingBanners({ year, banner, exceeded, percentText }: CeilingBannersProps) {
  const [status, setStatus] = useState<ActionStatus>(NO_ACTION_STATUS);
  const [pending, start] = useGuardedTransition();

  function acknowledge(threshold: CeilingThreshold) {
    start(async () => {
      setStatus(NO_ACTION_STATUS);
      const call = await callServerAction(() => acknowledgeCeilingAlertAction(year, threshold));
      if (call.status === "redirected") {
        return;
      }
      if (call.status === "failed") {
        setStatus({ message: null, error: REQUEST_FAILED_MESSAGE });
        return;
      }
      setStatus(call.value);
      if (!call.value.error) {
        document.getElementById(CEILING_HEADING_ID)?.focus();
      }
    });
  }

  return (
    <div className="space-y-3">
      {exceeded ? (
        <section aria-labelledby="ceiling-exceeded-heading" className={BANNER_CLASSES}>
          <h2 id="ceiling-exceeded-heading" className="font-semibold">
            התראה: המחזור בשנת {year} הגיע לתקרת עוסק פטור ({percentText})
          </h2>
          <p className="font-semibold">{CEILING_EXCEEDED_MESSAGE}</p>
        </section>
      ) : null}
      {banner !== null ? (
        <section aria-labelledby="ceiling-threshold-heading" className={BANNER_CLASSES}>
          <h2 id="ceiling-threshold-heading" className="font-semibold">
            התראה: המחזור בשנת {year} עבר {banner}% מתקרת עוסק פטור ({percentText})
          </h2>
          <p className="text-sm">
            ההתראה תוצג עד שתאושר. האישור נשמר לשנה ולסף הזה, לשני המשתמשים.
          </p>
          <Button variant="secondary" pending={pending} onClick={() => acknowledge(banner)}>
            {pending ? "שומר…" : "קראתי, אפשר להסתיר"}
          </Button>
        </section>
      ) : null}
      <p role="status" className="text-sm font-medium empty:sr-only">
        {status.message}
        {status.error ? <span className="text-destructive">{status.error}</span> : null}
      </p>
    </div>
  );
}
