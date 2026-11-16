import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
  AuthUnknownError,
  type User,
} from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { sessionStateFrom } from "./action-failure";

const USER = { id: "user-1" } as User;

describe("sessionStateFrom", () => {
  it("AUTH-3: a verified user is a valid session", () => {
    expect(sessionStateFrom({ user: USER, error: null })).toBe("valid");
  });

  it("AUTH-3: a missing session has ended", () => {
    expect(sessionStateFrom({ user: null, error: new AuthSessionMissingError() })).toBe("ended");
  });

  it.each([
    [401, "bad_jwt"],
    [403, "bad_jwt"],
    [400, "validation_failed"],
    [400, "refresh_token_not_found"],
    [404, "user_not_found"],
  ])("AUTH-3: the Auth server rejecting the session with %i %s has ended", (status, code) => {
    expect(
      sessionStateFrom({ user: null, error: new AuthApiError("rejected", status, code) }),
    ).toBe("ended");
  });

  it.each([
    ["rate limiting (429)", new AuthApiError("too many", 429, "over_request_rate_limit")],
    ["a server error (500)", new AuthApiError("server", 500, "unexpected_failure")],
    ["a bad gateway (502)", new AuthApiError("gateway", 502, undefined)],
    ["no connection", new AuthRetryableFetchError("Failed to fetch", 0)],
    ["an unknown failure", new AuthUnknownError("unknown", new Error("x"))],
    ["a non-auth error", new Error("x")],
    ["no error at all", null],
  ])("AUTH-3: %s is unknown, never a sign-out", (_case, error) => {
    expect(sessionStateFrom({ user: null, error })).toBe("unknown");
  });
});
