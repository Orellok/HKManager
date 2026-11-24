import { SERVICE_WORKER_PATH } from "@/lib/pwa/manifest";

import type { PushSubscriptionInput } from "./schema";

/**
 * The browser side of NOTIF-5 / NOTIF-13: what this device can do and has done. Only called
 * from client components after hydration.
 */

/** NOTIF-13: the states shown on the settings screen ("not_configured" shows as unsupported). */
export type PushDeviceState = "unsupported" | "not_configured" | "blocked" | "off" | "active";

export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function bytesToBase64Url(buffer: ArrayBuffer | null): string {
  if (!buffer) {
    return "";
  }
  let binary = "";
  for (const byte of new Uint8Array(buffer)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** Whether the subscription was made with this VAPID key (a rotated key needs a new one). */
function usesKey(subscription: PushSubscription, vapidPublicKey: string): boolean {
  const key = subscription.options?.applicationServerKey;
  return !key || bytesToBase64Url(key) === vapidPublicKey;
}

export function subscriptionInput(subscription: PushSubscription): PushSubscriptionInput {
  return {
    endpoint: subscription.endpoint,
    p256dh: bytesToBase64Url(subscription.getKey("p256dh")),
    auth: bytesToBase64Url(subscription.getKey("auth")),
  };
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration("/");
  return registration ? await registration.pushManager.getSubscription() : null;
}

/** The device's state and, when active, its subscription. */
export async function readPushDevice(
  vapidPublicKey: string | null,
): Promise<{ state: PushDeviceState; subscription: PushSubscriptionInput | null }> {
  if (!isPushSupported()) {
    return { state: "unsupported", subscription: null };
  }
  if (!vapidPublicKey) {
    return { state: "not_configured", subscription: null };
  }
  if (Notification.permission === "denied") {
    return { state: "blocked", subscription: null };
  }
  const subscription = await currentSubscription();
  if (
    Notification.permission === "granted" &&
    subscription &&
    usesKey(subscription, vapidPublicKey)
  ) {
    return { state: "active", subscription: subscriptionInput(subscription) };
  }
  return { state: "off", subscription: null };
}

async function ensureRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (!existing) {
    await navigator.serviceWorker.register(SERVICE_WORKER_PATH, {
      scope: "/",
      updateViaCache: "none",
    });
  }
  return navigator.serviceWorker.ready;
}

export type SubscribeOutcome =
  | { outcome: "subscribed"; subscription: PushSubscriptionInput }
  | { outcome: "blocked" }
  | { outcome: "dismissed" };

/**
 * NOTIF-5: asks for permission (only ever from the user's click) and subscribes with the
 * VAPID key. A subscription made with another key is replaced. Throws when the browser or the
 * push service fails.
 */
export async function subscribePushDevice(vapidPublicKey: string): Promise<SubscribeOutcome> {
  const permission = await Notification.requestPermission();
  if (permission === "denied") {
    return { outcome: "blocked" };
  }
  if (permission !== "granted") {
    return { outcome: "dismissed" };
  }
  const registration = await ensureRegistration();
  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !usesKey(subscription, vapidPublicKey)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlToBytes(vapidPublicKey),
  });
  return { outcome: "subscribed", subscription: subscriptionInput(subscription) };
}

/** NOTIF-5: ends this browser's subscription; returns its endpoint (null if there was none). */
export async function unsubscribePushDevice(): Promise<string | null> {
  const subscription = await currentSubscription();
  if (!subscription) {
    return null;
  }
  const { endpoint } = subscription;
  await subscription.unsubscribe();
  return endpoint;
}

/** NOTIF-13: running as the installed app (standalone window) rather than in a tab. */
export function isInstalledApp(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches;
}
