import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { STATIC_SECURITY_HEADERS } from "@/lib/security-headers";

import { proxy } from "./proxy";

const authState = vi.hoisted(() => ({ userId: undefined as string | undefined, allowed: false }));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getClaims: () =>
        Promise.resolve({
          data: authState.userId ? { claims: { sub: authState.userId } } : null,
        }),
      signOut: () => Promise.resolve({ error: null }),
    },
  }),
}));

vi.mock("@/lib/auth/roles", () => ({
  fetchIsAllowedUser: () => Promise.resolve(authState.allowed),
}));

const ORIGIN = "https://staging.example.test";

function request(path: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(new URL(path, ORIGIN), { headers });
}

function expectStaticHeaders(response: Response): void {
  for (const { key, value } of STATIC_SECURITY_HEADERS) {
    expect(response.headers.get(key), key).toBe(value);
  }
}

function locationPath(response: Response): string | undefined {
  const location = response.headers.get("location");
  return location ? new URL(location).pathname : undefined;
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project-ref.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  authState.userId = undefined;
  authState.allowed = false;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proxy security headers", () => {
  it("SPEC-8: the redirect to /login for / carries X-Robots-Tag and every static header", async () => {
    const response = await proxy(request("/"));

    expect(response.status).toBe(307);
    expect(locationPath(response)).toBe("/login");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expectStaticHeaders(response);
    expect(response.headers.get("Content-Security-Policy")).toMatch(/'nonce-/);
  });

  it.each([
    ["Next-Router-Prefetch", { "Next-Router-Prefetch": "1" }],
    ["RSC prefetch", { RSC: "1", "Next-Router-Prefetch": "1" }],
    ["Purpose: prefetch", { Purpose: "prefetch" }],
  ])(
    "SPEC-8: the /login redirect of a %s request carries the static headers",
    async (_name, headers) => {
      const response = await proxy(request("/", headers));

      expect(response.status).toBe(307);
      expect(locationPath(response)).toBe("/login");
      expectStaticHeaders(response);
    },
  );

  it("SPEC-8: the /unauthorized redirect of a non-allowlisted account carries the static headers", async () => {
    authState.userId = "user-1";
    authState.allowed = false;

    const response = await proxy(request("/"));

    expect(locationPath(response)).toBe("/unauthorized");
    expectStaticHeaders(response);
  });

  it("SPEC-8: a pass-through response for a public path carries the static headers", async () => {
    const response = await proxy(request("/login"));

    expect(locationPath(response)).toBeUndefined();
    expectStaticHeaders(response);
  });

  it("SPEC-8: a pass-through response for an allowlisted user carries the static headers", async () => {
    authState.userId = "user-1";
    authState.allowed = true;

    const response = await proxy(request("/"));

    expect(locationPath(response)).toBeUndefined();
    expectStaticHeaders(response);
  });
});
