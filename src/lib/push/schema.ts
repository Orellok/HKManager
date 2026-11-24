import { z } from "@/lib/zod";

/**
 * M7.2-9: a browser push subscription as the settings screen sends it. Mirrors the checks on
 * public.push_subscriptions (supabase/migrations/20261129090000_m7_2_push.sql): the Edge
 * Function only ever POSTs to a known push service over https.
 */

export const MAX_ENDPOINT_LENGTH = 2048;
export const MAX_USER_AGENT_LENGTH = 300;

/** Chrome uses FCM; the others are listed so another browser saves rather than fails. */
const PUSH_ENDPOINT_PATTERN =
  /^https:\/\/(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com|web\.push\.apple\.com)\/[!-~]+$/;
/** base64url without padding: 65-byte uncompressed P-256 point (0x04 first) / 16 bytes. */
const P256DH_PATTERN = /^B[A-Za-z0-9_-]{86}$/;
const AUTH_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export const pushEndpointSchema = z.string().max(MAX_ENDPOINT_LENGTH).regex(PUSH_ENDPOINT_PATTERN);

export const pushSubscriptionSchema = z.object({
  endpoint: pushEndpointSchema,
  p256dh: z.string().regex(P256DH_PATTERN),
  auth: z.string().regex(AUTH_PATTERN),
});

export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

/** The public VAPID key the browser subscribes with (same form as p256dh). */
export function isVapidPublicKey(value: string | undefined): value is string {
  return value !== undefined && P256DH_PATTERN.test(value);
}

/** The request's User-Agent, cut to what the database keeps; null when absent. */
export function boundedUserAgent(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed.slice(0, MAX_USER_AGENT_LENGTH);
}
