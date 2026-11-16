import { describe, expect, it } from "vitest";

import { todayInJerusalem } from "@/lib/dates";

import { MILESTONE_STATUS_LABELS, milestoneStatus, type MilestoneStatusInput } from "./status";

function milestone(fields: Partial<MilestoneStatusInput> = {}): MilestoneStatusInput {
  return { due_date: "2026-11-16", cancelled_at: null, balance: 100_000, ...fields };
}

describe("milestoneStatus", () => {
  it("MS-2: a due date after today is planned", () => {
    expect(milestoneStatus(milestone({ due_date: "2026-11-17" }), "2026-11-16")).toBe("planned");
  });

  it("MS-2: a due date of today is still planned", () => {
    expect(milestoneStatus(milestone({ due_date: "2026-11-16" }), "2026-11-16")).toBe("planned");
  });

  it("MS-2: a due date of yesterday with a balance is due", () => {
    expect(milestoneStatus(milestone({ due_date: "2026-11-15" }), "2026-11-16")).toBe("due");
  });

  it("MS-2: a past due date across a year change is due", () => {
    expect(milestoneStatus(milestone({ due_date: "2026-12-31" }), "2027-01-01")).toBe("due");
  });

  it("MS-2: a past due date without a balance (amount 0) is not due", () => {
    expect(milestoneStatus(milestone({ due_date: "2026-11-01", balance: 0 }), "2026-11-16")).toBe(
      "planned",
    );
  });

  it.each(["2026-11-01", "2026-11-16", "2026-12-01"])(
    "MS-2: a cancelled milestone due %s is cancelled",
    (due_date) => {
      expect(
        milestoneStatus(
          milestone({ due_date, cancelled_at: "2026-11-10T10:00:00Z" }),
          "2026-11-16",
        ),
      ).toBe("cancelled");
    },
  );

  it.each([
    // Winter time: today turns at 22:00 UTC.
    ["2026-11-16T21:59:59.999Z", "planned"],
    ["2026-11-16T22:00:00.000Z", "due"],
  ] as const)(
    "MS-2: a milestone due 16/11/2026 at %s (Asia/Jerusalem midnight) is %s",
    (instant, status) => {
      expect(milestoneStatus(milestone(), todayInJerusalem(new Date(instant)))).toBe(status);
    },
  );

  it.each([
    // Summer time starts on 27/03/2026; its midnight is still UTC+2.
    ["2026-03-27", "2026-03-27T21:59:59.999Z", "due"],
    ["2026-03-27", "2026-03-27T20:59:59.999Z", "planned"],
    ["2026-03-27", "2026-03-27T21:00:00.000Z", "due"],
    // Summer time ends on 25/10/2026; that night's midnight is UTC+3, the next UTC+2.
    ["2026-10-24", "2026-10-24T20:59:59.999Z", "planned"],
    ["2026-10-24", "2026-10-24T21:00:00.000Z", "due"],
    ["2026-10-25", "2026-10-25T21:59:59.999Z", "planned"],
    ["2026-10-25", "2026-10-25T22:00:00.000Z", "due"],
  ] as const)(
    "MS-2: a milestone due %s at %s (around a DST change) is %s",
    (due_date, instant, status) => {
      expect(milestoneStatus(milestone({ due_date }), todayInJerusalem(new Date(instant)))).toBe(
        status,
      );
    },
  );

  it("MS-2: statuses are shown as Hebrew text", () => {
    expect(MILESTONE_STATUS_LABELS).toEqual({
      planned: "מתוכנן",
      due: "לתשלום",
      cancelled: "בוטל",
    });
  });
});
