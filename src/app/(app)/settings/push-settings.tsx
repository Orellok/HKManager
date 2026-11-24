"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { REQUEST_FAILED_MESSAGE } from "@/components/archive-delete-actions";
import { Button } from "@/components/button";
import { callServerAction } from "@/lib/auth/action-failure";
import {
  deletePushSubscriptionAction,
  savePushSubscriptionAction,
  sendTestPushAction,
} from "@/lib/push/actions";
import {
  isInstalledApp,
  readPushDevice,
  subscribePushDevice,
  unsubscribePushDevice,
  type PushDeviceState,
} from "@/lib/push/browser";
import {
  INSTALL_HEADING,
  INSTALL_MANUAL_TEXT,
  INSTALL_TEXT,
  PUSH_BUTTONS,
  PUSH_CHECKING_TEXT,
  PUSH_MESSAGES,
  PUSH_SECTION_HEADING,
  PUSH_SECTION_INTRO,
  PUSH_STATE_GUIDANCE,
  PUSH_STATE_LABELS,
} from "@/lib/push/copy";
import type { PushSubscriptionInput } from "@/lib/push/schema";
import { canPromptInstall, promptInstall, subscribeInstallPrompt } from "@/lib/pwa/install-prompt";
import { cn } from "@/lib/utils";

const HEADING_ID = "push-settings-heading";
const STANDALONE_QUERY = "(display-mode: standalone)";

type Device = { state: PushDeviceState | "checking"; subscription: PushSubscriptionInput | null };
type Action = "enable" | "disable" | "test" | "install";
type Message = { text: string; error: boolean } | null;

const OFF: Device = { state: "off", subscription: null };

function subscribeStandalone(onChange: () => void): () => void {
  const query = window.matchMedia(STANDALONE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Forgets the browser's subscription after a failure, so the state shown stays true. */
async function dropBrowserSubscription(): Promise<void> {
  try {
    await unsubscribePushDevice();
  } catch {
    // The push service will answer 404/410 for it, and the server then deletes it (NOTIF-11).
  }
}

/**
 * NOTIF-5, 13, 14 (M7.2-7, 8): this device's push state, turning it on and off, a test push,
 * and the suggestion to install the app. Permission is asked only from the "הפעל" click.
 */
export function PushSettings({ vapidPublicKey }: { vapidPublicKey: string | null }) {
  const [device, setDevice] = useState<Device>({ state: "checking", subscription: null });
  const [running, setRunning] = useState<Action | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const inFlight = useRef(false);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const installHeadingRef = useRef<HTMLHeadingElement>(null);
  const canInstall = useSyncExternalStore(subscribeInstallPrompt, canPromptInstall, () => false);
  // The server render assumes installed, so the suggestion appears only once the browser says.
  const installed = useSyncExternalStore(subscribeStandalone, isInstalledApp, () => true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let found: Device;
      try {
        found = await readPushDevice(vapidPublicKey);
      } catch {
        found = OFF;
      }
      if (cancelled) {
        return;
      }
      setDevice(found);
      if (found.subscription) {
        // Keeps the server's copy current (keys, the signed-in user). A failure shows on the
        // test push; nothing to say here.
        const subscription = found.subscription;
        await callServerAction(() => savePushSubscriptionAction(subscription));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [vapidPublicKey]);

  async function run(action: Action, work: () => Promise<void>) {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setRunning(action);
    setMessage(null);
    try {
      await work();
    } finally {
      inFlight.current = false;
      setRunning(null);
    }
  }

  /** After the buttons change, focus stays in the section instead of falling to the page. */
  function settle(next: Device, text: Message) {
    setDevice(next);
    setMessage(text);
    statusRef.current?.focus();
  }

  const enable = () =>
    run("enable", async () => {
      if (!vapidPublicKey) {
        return;
      }
      let outcome: Awaited<ReturnType<typeof subscribePushDevice>>;
      try {
        outcome = await subscribePushDevice(vapidPublicKey);
      } catch {
        await dropBrowserSubscription();
        setMessage({ text: PUSH_MESSAGES.enableFailed, error: true });
        return;
      }
      if (outcome.outcome === "blocked") {
        settle(
          { state: "blocked", subscription: null },
          { text: PUSH_MESSAGES.blocked, error: true },
        );
        return;
      }
      if (outcome.outcome === "dismissed") {
        setMessage({ text: PUSH_MESSAGES.dismissed, error: true });
        return;
      }
      const { subscription } = outcome;
      const call = await callServerAction(() => savePushSubscriptionAction(subscription));
      if (call.status === "redirected") {
        return;
      }
      if (call.status === "done" && call.value.status === "saved") {
        settle({ state: "active", subscription }, { text: PUSH_MESSAGES.enabled, error: false });
        return;
      }
      await dropBrowserSubscription();
      const text =
        call.status === "failed"
          ? REQUEST_FAILED_MESSAGE
          : call.value.status === "limit"
            ? PUSH_MESSAGES.limit
            : PUSH_MESSAGES.enableFailed;
      setMessage({ text, error: true });
    });

  const disable = () =>
    run("disable", async () => {
      let endpoint: string | null;
      try {
        endpoint = await unsubscribePushDevice();
      } catch {
        setMessage({ text: PUSH_MESSAGES.disableFailed, error: true });
        return;
      }
      if (endpoint) {
        const call = await callServerAction(() => deletePushSubscriptionAction(endpoint));
        if (call.status === "redirected") {
          return;
        }
        // A row left behind is harmless: the push service answers 410 for it and the next
        // send deletes it (NOTIF-11). This browser no longer receives anything.
      }
      settle(OFF, { text: PUSH_MESSAGES.disabled, error: false });
    });

  const test = () =>
    run("test", async () => {
      const endpoint = device.subscription?.endpoint;
      if (!endpoint) {
        return;
      }
      const call = await callServerAction(() => sendTestPushAction(endpoint));
      if (call.status === "redirected") {
        return;
      }
      if (call.status === "failed") {
        setMessage({ text: REQUEST_FAILED_MESSAGE, error: true });
        return;
      }
      switch (call.value.status) {
        case "sent":
          setMessage({ text: PUSH_MESSAGES.testSent, error: false });
          return;
        case "not_found":
        case "gone":
          await dropBrowserSubscription();
          settle(OFF, { text: PUSH_MESSAGES.testNotRegistered, error: true });
          return;
        case "not_configured":
          setMessage({ text: PUSH_MESSAGES.testNotConfigured, error: true });
          return;
        default:
          setMessage({ text: PUSH_MESSAGES.testFailed, error: true });
      }
    });

  const install = () =>
    run("install", async () => {
      await promptInstall();
      // The offer can be used once, so the button is gone; focus stays in the suggestion.
      installHeadingRef.current?.focus();
    });

  const state = device.state;
  return (
    <section aria-labelledby={HEADING_ID} className="max-w-2xl space-y-4">
      <h2 id={HEADING_ID} className="text-xl font-semibold">
        {PUSH_SECTION_HEADING}
      </h2>
      <p className="text-muted-foreground text-sm">{PUSH_SECTION_INTRO}</p>
      <div className="space-y-3 rounded-lg border p-4">
        <p
          ref={statusRef}
          tabIndex={-1}
          className="space-y-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {state === "checking" ? (
            <span className="block text-sm">{PUSH_CHECKING_TEXT}</span>
          ) : (
            <>
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">מצב:</span>
                <span
                  data-testid="push-state"
                  className={cn(
                    "inline-flex items-center rounded-full px-3 py-0.5 text-sm",
                    state === "active" || state === "blocked"
                      ? "bg-background border-2 border-current"
                      : "bg-muted border",
                  )}
                >
                  {PUSH_STATE_LABELS[state]}
                </span>
              </span>
              <span className="block text-sm">{PUSH_STATE_GUIDANCE[state]}</span>
            </>
          )}
        </p>
        {state === "off" ? (
          <Button pending={running === "enable"} onClick={enable}>
            {running === "enable" ? "מפעילים…" : PUSH_BUTTONS.enable}
          </Button>
        ) : null}
        {state === "active" ? (
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" pending={running === "test"} onClick={test}>
              {running === "test" ? "שולחים…" : PUSH_BUTTONS.test}
            </Button>
            <Button variant="secondary" pending={running === "disable"} onClick={disable}>
              {running === "disable" ? "מכבים…" : PUSH_BUTTONS.disable}
            </Button>
          </div>
        ) : null}
        <p
          role="status"
          className={cn(
            "text-sm font-medium wrap-anywhere empty:sr-only",
            message?.error && "text-destructive",
          )}
        >
          {message?.text}
        </p>
      </div>
      {!installed && state !== "checking" && state !== "unsupported" ? (
        <div className="space-y-2">
          <h3
            ref={installHeadingRef}
            tabIndex={-1}
            className="font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {INSTALL_HEADING}
          </h3>
          <p className="text-sm">{INSTALL_TEXT}</p>
          {canInstall ? (
            <Button variant="secondary" pending={running === "install"} onClick={install}>
              {PUSH_BUTTONS.install}
            </Button>
          ) : (
            <p className="text-muted-foreground text-sm">{INSTALL_MANUAL_TEXT}</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
