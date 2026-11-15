import { describe, expect, it } from "vitest";

import {
  STATIC_SECURITY_HEADERS,
  buildContentSecurityPolicy,
  generateNonce,
} from "./security-headers";

function directive(policy: string, name: string): string | undefined {
  return policy
    .split(";")
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));
}

describe("buildContentSecurityPolicy", () => {
  it("M0.1-6: production policy allows scripts and styles only with the request nonce", () => {
    const policy = buildContentSecurityPolicy({ nonce: "abc123", isDevelopment: false });

    expect(directive(policy, "script-src")).toBe(
      "script-src 'self' 'nonce-abc123' 'strict-dynamic'",
    );
    expect(directive(policy, "style-src")).toBe("style-src 'self' 'nonce-abc123'");
  });

  it("M0.1-6: production policy never allows unsafe-eval or unsafe-inline", () => {
    const policy = buildContentSecurityPolicy({ nonce: "abc123", isDevelopment: false });

    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).not.toContain("'unsafe-inline'");
  });

  it("M0.1-6: development policy adds unsafe-eval for scripts and inline styles", () => {
    const policy = buildContentSecurityPolicy({ nonce: "abc123", isDevelopment: true });

    expect(directive(policy, "script-src")).toBe(
      "script-src 'self' 'nonce-abc123' 'strict-dynamic' 'unsafe-eval'",
    );
    expect(directive(policy, "style-src")).toBe("style-src 'self' 'unsafe-inline'");
  });

  it("M0.1-6: forbids framing, plugins and foreign base URIs", () => {
    const policy = buildContentSecurityPolicy({ nonce: "n", isDevelopment: false });

    expect(directive(policy, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive(policy, "object-src")).toBe("object-src 'none'");
    expect(directive(policy, "base-uri")).toBe("base-uri 'self'");
    expect(directive(policy, "default-src")).toBe("default-src 'self'");
  });

  it("M0.1-6: produces a single-line header value", () => {
    const policy = buildContentSecurityPolicy({ nonce: "n", isDevelopment: false });

    expect(policy).not.toMatch(/[\r\n]/);
    expect(policy.endsWith(";")).toBe(true);
  });

  it("M0.1-6: rejects an empty nonce", () => {
    expect(() => buildContentSecurityPolicy({ nonce: "", isDevelopment: false })).toThrow();
    expect(() => buildContentSecurityPolicy({ nonce: "   ", isDevelopment: false })).toThrow();
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
    expect(headers["Permissions-Policy"]).toContain("camera=()");
  });
});
