import { describe, expect, it } from "vitest";

import { HOOK_REJECTION_MESSAGES, isHookRejection } from "./hook-rejection";

describe("isHookRejection", () => {
  it.each(Object.values(HOOK_REJECTION_MESSAGES))("AUTH-2: recognises %s", (message) => {
    expect(isHookRejection(message)).toBe(true);
  });

  it.each([
    ["no description", null],
    ["an empty description", ""],
    ["a cancelled Google sign-in", "The user denied the request"],
    ["a hook message with extra text", `${HOOK_REJECTION_MESSAGES.notAllowed} (extra)`],
    ["a hook message in different case", HOOK_REJECTION_MESSAGES.notAllowed.toUpperCase()],
  ])("AUTH-2: does not treat %s as a hook rejection", (_case, description) => {
    expect(isHookRejection(description)).toBe(false);
  });
});
