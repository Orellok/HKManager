import { describe, expect, it } from "vitest";

import { NOTICE_PARAM, noticeMessage, withNotice } from "./notices";

const MESSAGES = { created: "נשמר.", deleted: "נמחק." };

describe("redirect notices", () => {
  it("CLI-1: adds the notice to a path without a query", () => {
    expect(withNotice("/clients/1", "created")).toBe(`/clients/1?${NOTICE_PARAM}=created`);
  });

  it("PRJ-1: adds the notice to a path that already has a query", () => {
    expect(withNotice("/projects?view=archived", "deleted")).toBe(
      `/projects?view=archived&${NOTICE_PARAM}=deleted`,
    );
  });

  it("PRJ-1: a known code shows its message", () => {
    expect(noticeMessage(MESSAGES, "deleted")).toBe("נמחק.");
  });

  it.each([undefined, "", "unknown", "toString", "__proto__", ["created"]])(
    "PRJ-1: the notice code %j shows nothing",
    (code) => {
      expect(noticeMessage(MESSAGES, code)).toBeUndefined();
    },
  );
});
