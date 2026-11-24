import { describe, expect, it, vi } from "vitest";

import { vapidFromEnv } from "./handler.ts";
import {
  jerusalemDateAndHour,
  outcomeOf,
  runDailyReminders,
  sendTestPush,
  summaryBody,
  type ClaimedRun,
  type ReminderStore,
  type StoredSubscription,
} from "./reminders.ts";

describe("M7.2-3: local date and hour in Asia/Jerusalem", () => {
  it.each([
    ["2026-07-15T06:00:00Z", "2026-07-15", 9],
    ["2026-07-15T07:00:00Z", "2026-07-15", 10],
    ["2026-01-15T06:00:00Z", "2026-01-15", 8],
    ["2026-01-15T07:00:00Z", "2026-01-15", 9],
    // Summer time starts on Friday 27/03/2026 and ends on Sunday 25/10/2026.
    ["2026-03-27T06:00:00Z", "2026-03-27", 9],
    ["2026-03-26T06:00:00Z", "2026-03-26", 8],
    ["2026-10-25T06:00:00Z", "2026-10-25", 8],
    ["2026-10-24T06:00:00Z", "2026-10-24", 9],
    // 22:30 UTC is already the next day locally.
    ["2026-11-23T22:30:00Z", "2026-11-24", 0],
  ])("M7.2-3: %s is %s, hour %i", (instant, date, hour) => {
    expect(jerusalemDateAndHour(new Date(instant))).toEqual({ date, hour });
  });
});

describe("M7.2-4: the summary text", () => {
  it.each([
    [{ today: 2, tomorrow: 1, overdue: 3 }, "2 משימות להיום · 1 למחר · 3 באיחור"],
    [{ today: 1, tomorrow: 1, overdue: 1 }, "משימה אחת להיום · 1 למחר · 1 באיחור"],
    [{ today: 0, tomorrow: 2, overdue: 0 }, "2 משימות למחר"],
    [{ today: 0, tomorrow: 1, overdue: 5 }, "משימה אחת למחר · 5 באיחור"],
    [{ today: 0, tomorrow: 0, overdue: 12 }, "12 משימות באיחור"],
    [{ today: 3, tomorrow: 0, overdue: 1 }, "3 משימות להיום · 1 באיחור"],
  ])("M7.2-4: %o → %s", (counts, expected) => {
    expect(summaryBody(counts, null)).toBe(expected);
  });

  it("M7.2-4: nothing due → no notification", () => {
    expect(summaryBody({ today: 0, tomorrow: 0, overdue: 0 }, null)).toBeNull();
  });

  it.each([
    ["today", { today: 1, tomorrow: 0, overdue: 0 }, "להיום"],
    ["tomorrow", { today: 0, tomorrow: 1, overdue: 0 }, "למחר"],
    ["overdue", { today: 0, tomorrow: 0, overdue: 1 }, "באיחור"],
  ] as const)("M7.2-4: one %s task → its title and state", (group, counts, label) => {
    expect(summaryBody(counts, { title: "להזמין אריחים", group })).toBe(`להזמין אריחים · ${label}`);
  });
});

describe("M7.2-5: push service answers", () => {
  it.each([
    [200, "delivered"],
    [201, "delivered"],
    [404, "gone"],
    [410, "gone"],
    [400, "failed"],
    [413, "failed"],
    [429, "failed"],
    [500, "failed"],
  ])("M7.2-5: %i → %s", (status, outcome) => {
    expect(outcomeOf(status)).toBe(outcome);
  });
});

const SUBSCRIPTIONS: StoredSubscription[] = [
  { id: "a", endpoint: "https://fcm.googleapis.com/a", p256dh: "p", auth: "q" },
  { id: "b", endpoint: "https://fcm.googleapis.com/b", p256dh: "p", auth: "q" },
];

function fakeStore(run: ClaimedRun) {
  const calls: string[] = [];
  const store: ReminderStore = {
    claimRun: vi.fn(async (date) => {
      calls.push(`claim ${date}`);
      return run;
    }),
    listSubscriptions: vi.fn(async () => {
      calls.push("list");
      return SUBSCRIPTIONS;
    }),
    markDelivered: vi.fn(async (ids) => void calls.push(`delivered ${ids}`)),
    deleteSubscriptions: vi.fn(async (ids) => void calls.push(`delete ${ids}`)),
    finishRun: vi.fn(
      async (date, sent, failed) => void calls.push(`finish ${date} ${sent} ${failed}`),
    ),
  };
  return { store, calls };
}

const NINE_AM_SUMMER = new Date("2026-07-15T06:00:00Z");
const DUE = { claimed: true, counts: { today: 1, tomorrow: 0, overdue: 2 }, single: null };

describe("M7.2-3: the daily run", () => {
  it("M7.2-3: outside 09:00 nothing is claimed or sent", async () => {
    const { store, calls } = fakeStore(DUE);
    const send = vi.fn();
    const result = await runDailyReminders({
      store,
      send,
      now: new Date("2026-07-15T07:00:00Z"),
      log: vi.fn(),
    });
    expect(result).toEqual({ status: "outside_hour", hour: 10 });
    expect(calls).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it("M7.2-3: claims the date before sending; an already claimed date sends nothing", async () => {
    const { store, calls } = fakeStore({ ...DUE, claimed: false });
    const send = vi.fn();
    const result = await runDailyReminders({ store, send, now: NINE_AM_SUMMER, log: vi.fn() });
    expect(result).toEqual({ status: "already_ran", runDate: "2026-07-15" });
    expect(calls).toEqual(["claim 2026-07-15"]);
    expect(send).not.toHaveBeenCalled();
  });

  it("M7.2-3: sends the same payload to every subscription and records the result", async () => {
    const { store, calls } = fakeStore(DUE);
    const send = vi.fn(async () => 201);
    const result = await runDailyReminders({ store, send, now: NINE_AM_SUMMER, log: vi.fn() });
    expect(result).toEqual({
      status: "sent",
      runDate: "2026-07-15",
      sent: 2,
      failed: 0,
      removed: 0,
    });
    expect(send).toHaveBeenCalledTimes(2);
    for (const call of send.mock.calls as unknown[][]) {
      expect(call[1]).toEqual({
        title: "HKManager",
        body: "משימה אחת להיום · 2 באיחור",
        url: "/tasks",
        tag: "hkmanager-daily",
      });
      expect(call[2]).toBe(43200);
    }
    expect(calls).toEqual([
      "claim 2026-07-15",
      "list",
      "delivered a,b",
      "delete ",
      "finish 2026-07-15 2 0",
    ]);
  });

  it("M7.2-5: a thrown error or a failure status is logged without the endpoint and counted", async () => {
    const { store, calls } = fakeStore(DUE);
    const log = vi.fn();
    const send = vi.fn(async (target: StoredSubscription) => {
      if (target.id === "a") {
        throw new TypeError(`fetch failed for ${target.endpoint}`);
      }
      return 503;
    });
    const result = await runDailyReminders({ store, send, now: NINE_AM_SUMMER, log });
    expect(result).toMatchObject({ status: "sent", sent: 0, failed: 2 });
    expect(log.mock.calls.flat()).toEqual([
      "push: daily delivery failed (TypeError)",
      "push: daily delivery failed (status 503)",
    ]);
    expect(calls.at(-1)).toBe("finish 2026-07-15 0 2");
  });
});

describe("M7.2-6: the test push", () => {
  const subscription = SUBSCRIPTIONS[0];

  it.each([
    [201, "sent"],
    [410, "gone"],
    [500, "failed"],
  ] as const)("M7.2-6: push service %i → %s", async (status, expected) => {
    const deleteSubscription = vi.fn(async () => undefined);
    const markDelivered = vi.fn(async () => undefined);
    const send = vi.fn(async () => status);
    const result = await sendTestPush({
      subscription,
      send,
      deleteSubscription,
      markDelivered,
      log: vi.fn(),
    });
    expect(result).toBe(expected);
    expect(send.mock.calls[0]).toEqual([
      subscription,
      {
        title: "HKManager",
        body: "התראת בדיקה: ההתראות במכשיר הזה פועלות.",
        url: "/settings",
        tag: "hkmanager-test",
      },
      600,
    ]);
    expect(deleteSubscription).toHaveBeenCalledTimes(expected === "gone" ? 1 : 0);
    expect(markDelivered).toHaveBeenCalledTimes(expected === "sent" ? 1 : 0);
  });

  it("M7.2-6: no own subscription → not_found, nothing sent", async () => {
    const send = vi.fn();
    const result = await sendTestPush({
      subscription: null,
      send,
      deleteSubscription: vi.fn(),
      markDelivered: vi.fn(),
      log: vi.fn(),
    });
    expect(result).toBe("not_found");
    expect(send).not.toHaveBeenCalled();
  });
});

describe("M7.2-5: VAPID secrets", () => {
  it("M7.2-5: all three are needed", () => {
    const all = { VAPID_PUBLIC_KEY: "p", VAPID_PRIVATE_KEY: "k", VAPID_SUBJECT: "https://x" };
    expect(vapidFromEnv((name) => all[name as keyof typeof all])).toEqual({
      publicKey: "p",
      privateKey: "k",
      subject: "https://x",
    });
    for (const missing of Object.keys(all)) {
      const partial: Record<string, string> = { ...all, [missing]: "" };
      expect(vapidFromEnv((name) => partial[name])).toBeNull();
    }
  });
});
