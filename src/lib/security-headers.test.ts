import { describe, expect, it } from "vitest";

import {
  STATIC_SECURITY_HEADERS,
  buildContentSecurityPolicy,
  generateNonce,
} from "./security-headers";

const SUPABASE_URL = "https://project-ref.supabase.co";

function directive(policy: string, name: string): string | undefined {
  return policy
    .split(";")
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));
}

describe("buildContentSecurityPolicy", () => {
  it("M0.1-6: production policy allows scripts and styles only with the request nonce", () => {
    const policy = buildContentSecurityPolicy({
      nonce: "abc123",
      isDevelopment: false,
      supabaseUrl: SUPABASE_URL,
    });

    expect(directive(policy, "script-src")).toBe(
      "script-src 'self' 'nonce-abc123' 'strict-dynamic'",
    );
    expect(directive(policy, "style-src")).toBe("style-src 'self' 'nonce-abc123'");
  });

  it("M0.1-6: production policy never allows unsafe-eval or unsafe-inline", () => {
    const policy = buildContentSecurityPolicy({
      nonce: "abc123",
      isDevelopment: false,
      supabaseUrl: SUPABASE_URL,
    });

    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).not.toContain("'unsafe-inline'");
  });

  it("M0.1-6: development policy adds unsafe-eval for scripts and inline styles", () => {
    const policy = buildContentSecurityPolicy({
      nonce: "abc123",
      isDevelopment: true,
      supabaseUrl: SUPABASE_URL,
    });

    expect(directive(policy, "script-src")).toBe(
      "script-src 'self' 'nonce-abc123' 'strict-dynamic' 'unsafe-eval'",
    );
    expect(directive(policy, "style-src")).toBe("style-src 'self' 'unsafe-inline'");
  });

  it("M0.1-6: forbids framing, plugins and foreign base URIs", () => {
    const policy = buildContentSecurityPolicy({
      nonce: "n",
      isDevelopment: false,
      supabaseUrl: SUPABASE_URL,
    });

    expect(directive(policy, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive(policy, "object-src")).toBe("object-src 'none'");
    expect(directive(policy, "base-uri")).toBe("base-uri 'self'");
    expect(directive(policy, "default-src")).toBe("default-src 'self'");
  });

  it("M0.1-6: produces a single-line header value", () => {
    const policy = buildContentSecurityPolicy({
      nonce: "n",
      isDevelopment: false,
      supabaseUrl: SUPABASE_URL,
    });

    expect(policy).not.toMatch(/[\r\n]/);
    expect(policy.endsWith(";")).toBe(true);
  });

  it("M0.1-6: rejects an empty nonce", () => {
    for (const nonce of ["", "   "]) {
      expect(() =>
        buildContentSecurityPolicy({ nonce, isDevelopment: false, supabaseUrl: SUPABASE_URL }),
      ).toThrow();
    }
  });

  it("M0.3-8: connect-src allows only 'self' and the Supabase origin", () => {
    const policy = buildContentSecurityPolicy({
      nonce: "n",
      isDevelopment: false,
      supabaseUrl: `${SUPABASE_URL}/some/path?x=1`,
    });

    expect(directive(policy, "connect-src")).toBe(`connect-src 'self' ${SUPABASE_URL}`);
  });

  it("M7.1-4: the service worker and the manifest may only come from the app itself", () => {
    const policy = buildContentSecurityPolicy({
      nonce: "n",
      isDevelopment: false,
      supabaseUrl: SUPABASE_URL,
    });

    expect(directive(policy, "worker-src")).toBe("worker-src 'self'");
    expect(directive(policy, "manifest-src")).toBe("manifest-src 'self'");
  });

  it("M0.3-8: keeps the port of a local Supabase URL in connect-src", () => {
    const policy = buildContentSecurityPolicy({
      nonce: "n",
      isDevelopment: true,
      supabaseUrl: "http://127.0.0.1:54321",
    });

    expect(directive(policy, "connect-src")).toBe("connect-src 'self' http://127.0.0.1:54321");
  });

  it.each([
    ["an empty value", ""],
    ["a value that is not a URL", "not a url"],
    ["a non-http scheme", "javascript:alert(1)"],
  ])("M0.3-8: rejects %s as the Supabase URL", (_case, supabaseUrl) => {
    expect(() =>
      buildContentSecurityPolicy({ nonce: "n", isDevelopment: false, supabaseUrl }),
    ).toThrow();
  });
});

describe("generateNonce", () => {
  it("M0.1-6: returns base64 encoding 16 random bytes", () => {
    const nonce = generateNonce();

    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(atob(nonce)).toHaveLength(16);
  });

  it("M0.1-6: returns a different value on each call", () => {
    const nonces = new Set(Array.from({ length: 50 }, () => generateNonce()));

    expect(nonces.size).toBe(50);
  });
});

describe("STATIC_SECURITY_HEADERS", () => {
  const headers = Object.fromEntries(STATIC_SECURITY_HEADERS.map(({ key, value }) => [key, value]));

  it("M0.1-5: blocks indexing", () => {
    expect(headers["X-Robots-Tag"]).toBe("noindex, nofollow");
  });

  it("M0.1-6: includes nosniff, referrer policy, frame denial and permissions policy", () => {
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Permissions-Policy"]).toBe(
      "camera=(self), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
    );
  });

  it("EXP-2: the camera is allowed for the app's own pages only (receipt photos), nothing else changes", () => {
    expect(headers["Permissions-Policy"]).toContain("camera=(self)");
    expect(headers["Permissions-Policy"]).not.toContain("camera=()");
  });
});
