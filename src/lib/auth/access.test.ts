import { describe, expect, it } from "vitest";

import { decideAdminAccess, decideUserAccess, isPublicPath } from "./access";

describe("isPublicPath", () => {
  it.each(["/login", "/unauthorized", "/auth/callback", "/robots.txt"])(
    "AUTH-3: %s is reachable without a session",
    (pathname) => {
      expect(isPublicPath(pathname)).toBe(true);
    },
  );

  it.each([
    "/",
    "/clients",
    "/settings",
    "/this-page-does-not-exist",
    "/login/extra",
    "/auth/callback/extra",
    "/auth",
    "/LOGIN",
    "/login/",
    "/robots.txt.bak",
  ])("AUTH-3: %s is protected", (pathname) => {
    expect(isPublicPath(pathname)).toBe(false);
  });
});

describe("decideUserAccess", () => {
  it("AUTH-3: a visitor without a verified session goes to login", () => {
    expect(decideUserAccess({ hasUser: false, isAllowed: false })).toBe("login");
  });

  it("AUTH-3: missing session wins even if the allowlist flag is somehow true", () => {
    expect(decideUserAccess({ hasUser: false, isAllowed: true })).toBe("login");
  });

  it("AUTH-2: a signed-in account outside the allowlist is unauthorized", () => {
    expect(decideUserAccess({ hasUser: true, isAllowed: false })).toBe("unauthorized");
  });

  it("AUTH-2: a signed-in allowlisted account is allowed", () => {
    expect(decideUserAccess({ hasUser: true, isAllowed: true })).toBe("allow");
  });
});

describe("decideAdminAccess", () => {
  it("AUTH-5: an admin is allowed", () => {
    expect(decideAdminAccess({ hasUser: true, isAllowed: true, isAdmin: true })).toBe("allow");
  });

  it("AUTH-5: an owner is forbidden", () => {
    expect(decideAdminAccess({ hasUser: true, isAllowed: true, isAdmin: false })).toBe("forbidden");
  });

  it("AUTH-5: a visitor without a session goes to login, whatever the role flags say", () => {
    expect(decideAdminAccess({ hasUser: false, isAllowed: true, isAdmin: true })).toBe("login");
  });

  it("AUTH-5: an account outside the allowlist is unauthorized, not merely forbidden", () => {
    expect(decideAdminAccess({ hasUser: true, isAllowed: false, isAdmin: true })).toBe(
      "unauthorized",
    );
  });
});
