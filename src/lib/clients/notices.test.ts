import { describe, expect, it } from "vitest";

import { CLIENT_NOTICE_MESSAGES, clientNoticeMessage, saveNotice } from "./notices";

const ACTIVE = { archived_at: null };
const ARCHIVED = { archived_at: "2026-11-16T00:00:00Z" };

describe("save notices", () => {
  it.each(["created", "updated"] as const)(
    "CLI-1: %s without another client of the same name has the plain notice",
    (saved) => {
      expect(saveNotice(saved, [])).toBe(saved);
    },
  );

  it("CLI-1: warns about an active client with the same name", () => {
    expect(saveNotice("created", [ACTIVE])).toBe("created_duplicate");
    expect(saveNotice("updated", [ARCHIVED, ACTIVE])).toBe("updated_duplicate");
  });

  it("CLI-1: uses the archived wording when every same-name client is archived", () => {
    expect(saveNotice("created", [ARCHIVED])).toBe("created_duplicate_archived");
    expect(saveNotice("updated", [ARCHIVED, ARCHIVED])).toBe("updated_duplicate_archived");
  });

  it("CLI-1: the duplicate notices have the agreed texts", () => {
    expect(CLIENT_NOTICE_MESSAGES.created_duplicate).toBe(
      "הלקוח נשמר. שימו לב: כבר קיים לקוח נוסף בשם הזה.",
    );
    expect(CLIENT_NOTICE_MESSAGES.updated_duplicate).toBe(
      "השינויים נשמרו. שימו לב: כבר קיים לקוח נוסף בשם הזה.",
    );
  });

  it.each([undefined, "", "unknown", "toString", "__proto__", ["created"]])(
    "CLI-1: the notice code %j shows nothing",
    (code) => {
      expect(clientNoticeMessage(code)).toBeUndefined();
    },
  );

  it("CLI-1: a known code shows its message", () => {
    expect(clientNoticeMessage("deleted")).toBe("הלקוח נמחק.");
  });
});
