import { describe, expect, it } from "vitest";

import { vapidAuthorization, base64UrlDecode } from "../supabase/functions/_shared/web-push.ts";

import {
  ENVIRONMENTS,
  envFilePath,
  generateVapidKeys,
  renderEnvFile,
} from "./generate-push-keys.mts";

describe("M7.2-11: VAPID key script", () => {
  it("M7.2-11: generates a P-256 pair the push function can sign with and browsers can verify", async () => {
    const keys = generateVapidKeys();
    expect(keys.publicKey).toMatch(/^B[A-Za-z0-9_-]{86}$/);
    expect(base64UrlDecode(keys.privateKey)).toHaveLength(32);
    const header = await vapidAuthorization("https://fcm.googleapis.com/x", {
      ...keys,
      subject: ENVIRONMENTS.staging.subject,
    });
    const [, token, key] = /^vapid t=(\S+), k=(\S+)$/.exec(header) ?? [];
    expect(key).toBe(keys.publicKey);
    const [head, claims, signature] = token.split(".");
    const verifyKey = await crypto.subtle.importKey(
      "raw",
      base64UrlDecode(keys.publicKey),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      verifyKey,
      base64UrlDecode(signature),
      new TextEncoder().encode(`${head}.${claims}`),
    );
    expect(valid).toBe(true);
  });

  it("M7.2-11: two runs never produce the same key", () => {
    expect(generateVapidKeys().privateKey).not.toBe(generateVapidKeys().privateKey);
  });

  it("M7.2-11: the env file holds the three secrets and no personal data", () => {
    const text = renderEnvFile(
      { publicKey: "PUB", privateKey: "PRIV" },
      "https://hkmanager.netlify.app",
    );
    expect(text).toContain("VAPID_PUBLIC_KEY=PUB\n");
    expect(text).toContain("VAPID_PRIVATE_KEY=PRIV\n");
    expect(text).toContain("VAPID_SUBJECT=https://hkmanager.netlify.app\n");
    expect(text).not.toMatch(/@/);
  });

  it("M7.2-11: the file is a git-ignored .env.*.local under supabase/ and subjects are the site URLs", () => {
    expect(envFilePath("staging")).toMatch(/supabase\/\.env\.push\.staging\.local$/);
    expect(envFilePath("production")).toMatch(/supabase\/\.env\.push\.production\.local$/);
    expect(ENVIRONMENTS.production.subject).toBe("https://hkmanager.netlify.app");
    expect(ENVIRONMENTS.staging.subject).toBe("https://hkmanager-staging.netlify.app");
  });
});
