"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/button";
import { useHydrated } from "@/components/use-hydrated";

/** A detail shown with a copy button; `copyValue` null shows it without one. */
export type CopyableDetail = { label: string; display: string; copyValue: string | null };

/** The live region mounts empty and gets its text a moment later, so it is announced. */
const ANNOUNCE_DELAY_MS = 100;

type Announcement = { label: string; copied: boolean } | null;

/**
 * DOC-1: details with copy buttons (Clipboard API). Each button is named after its detail,
 * and the result is announced in a live region. When the browser refuses clipboard access,
 * the value appears in a read-only field, selected, ready to copy by hand. The buttons work
 * only with JavaScript, so they stay disabled until the page is interactive.
 */
export function CopyableDetails({ details }: { details: readonly CopyableDetail[] }) {
  const [announcement, setAnnouncement] = useState<Announcement>(null);
  const [manualCopy, setManualCopy] = useState<string | null>(null);
  const manualInputRef = useRef<HTMLInputElement>(null);
  const announceTimer = useRef<number | undefined>(undefined);
  const hydrated = useHydrated();

  useEffect(() => () => window.clearTimeout(announceTimer.current), []);

  useEffect(() => {
    if (manualCopy !== null) {
      manualInputRef.current?.focus();
      manualInputRef.current?.select();
    }
  }, [manualCopy]);

  function announce(next: Announcement) {
    // Cleared first, so the same message twice in a row is announced twice.
    setAnnouncement(null);
    window.clearTimeout(announceTimer.current);
    announceTimer.current = window.setTimeout(() => setAnnouncement(next), ANNOUNCE_DELAY_MS);
  }

  async function copy(detail: CopyableDetail) {
    if (detail.copyValue === null) {
      return;
    }
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("The Clipboard API is not available");
      }
      await navigator.clipboard.writeText(detail.copyValue);
      setManualCopy(null);
      announce({ label: detail.label, copied: true });
    } catch {
      setManualCopy(detail.label);
      announce({ label: detail.label, copied: false });
    }
  }

  return (
    <div className="space-y-2">
      <dl className="divide-y rounded-lg border">
        {details.map((detail) => (
          <div
            key={detail.label}
            className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 p-4 sm:grid-cols-[8rem_1fr_auto]"
          >
            <dt className="text-muted-foreground col-span-2 text-sm sm:col-span-1">
              {detail.label}
            </dt>
            <dd className="min-w-0 wrap-anywhere whitespace-pre-wrap">
              {manualCopy === detail.label && detail.copyValue !== null ? (
                <input
                  ref={manualInputRef}
                  readOnly
                  value={detail.copyValue}
                  aria-label={`${detail.label} להעתקה ידנית`}
                  onFocus={(event) => event.currentTarget.select()}
                  className="border-input bg-background min-h-11 w-full rounded-md border px-3 text-base"
                />
              ) : (
                detail.display
              )}
            </dd>
            {detail.copyValue !== null ? (
              <dd>
                <Button
                  variant="secondary"
                  onClick={() => copy(detail)}
                  disabled={!hydrated}
                  aria-label={`העתקת ${detail.label}`}
                >
                  העתקה
                </Button>
              </dd>
            ) : null}
          </div>
        ))}
      </dl>
      <p role="status" className="text-sm font-medium empty:sr-only">
        {announcement === null
          ? null
          : announcement.copied
            ? `הועתק: ${announcement.label}.`
            : `לא הצלחנו להעתיק את ${announcement.label}. אפשר להעתיק את הערך מהשדה שסומן.`}
      </p>
    </div>
  );
}
