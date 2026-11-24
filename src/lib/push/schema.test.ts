import { describe, expect, it } from "vitest";

import { boundedUserAgent, isVapidPublicKey, pushSubscriptionSchema } from "./schema";

const VALID = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc:DEF-123_x",
  p256dh: `B${"A".repeat(86)}`,
  auth: "A".repeat(22),
};

describe("M7.2-9: push subscription input", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://fcm.googleapis.com/wp/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://wns2-db5p.notify.windows.com/w/?token=abc",
    "https://web.push.apple.com/abc",
  ])("M7.2-9: accepts the push service endpoint %s", (endpoint) => {
    expect(pushSubscriptionSchema.safeParse({ ...VALID, endpoint }).success).toBe(true);
  });

  it.each([
    ["http", "http://fcm.googleapis.com/fcm/send/abc"],
    ["another host", "https://evil.example/fcm/send/abc"],
    ["a look-alike host", "https://fcm.googleapis.com.evil.example/x"],
    ["userinfo", "https://fcm.googleapis.com@evil.example/x"],
    ["no path", "https://fcm.googleapis.com/"],
    ["a space", "https://fcm.googleapis.com/a b"],
    ["too long", `https://fcm.googleapis.com/${"a".repeat(2030)}`],
  ])("M7.2-9: rejects an endpoint with %s", (_label, endpoint) => {
    expect(pushSubscriptionSchema.safeParse({ ...VALID, endpoint }).success).toBe(false);
  });

  it.each([
    ["p256dh not starting with 0x04", { p256dh: `A${"A".repeat(86)}` }],
    ["p256dh too short", { p256dh: `B${"A".repeat(85)}` }],
    ["p256dh with padding", { p256dh: `B${"A".repeat(85)}=` }],
    ["auth too long", { auth: "A".repeat(23) }],
    ["auth with + /", { auth: `${"A".repeat(20)}+/` }],
    ["a missing key", { auth: undefined }],
  ])("M7.2-9: rejects %s", (_label, fields) => {
    expect(pushSubscriptionSchema.safeParse({ ...VALID, ...fields }).success).toBe(false);
  });

  it("M7.2-9: the public VAPID key has the p256dh form", () => {
    expect(isVapidPublicKey(VALID.p256dh)).toBe(true);
    expect(isVapidPublicKey(undefined)).toBe(false);
    expect(isVapidPublicKey("")).toBe(false);
    expect(isVapidPublicKey("x")).toBe(false);
  });

  it("M7.2-9: the user agent is trimmed and cut to 300 characters", () => {
    expect(boundedUserAgent(null)).toBeNull();
    expect(boundedUserAgent("   ")).toBeNull();
    expect(boundedUserAgent(" Chrome ")).toBe("Chrome");
    expect(boundedUserAgent("x".repeat(400))).toHaveLength(300);
  });
});
