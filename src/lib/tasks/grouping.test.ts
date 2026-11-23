import { describe, expect, it } from "vitest";

import { todayInJerusalem } from "@/lib/dates";

import {
  badgeCount,
  badgeDisplayText,
  badgeSpokenSuffix,
  compareTasks,
  groupOpenTasks,
  isOverdue,
  taskGroupOf,
  type GroupableTask,
} from "./grouping";

function task(fields: Partial<GroupableTask> & { id: string }): GroupableTask {
  return {
    due_date: null,
    priority: "normal",
    status: "open",
    created_at: "2026-01-01T10:00:00.000Z",
    ...fields,
  };
}

/** The group keys and task ids of a grouping, for compact assertions. */
function shape(groups: ReturnType<typeof groupOpenTasks>) {
  return groups.map((group) => [group.key, group.tasks.map((item) => item.id)]);
}

describe("TASK-3: overdue is computed against today in Asia/Jerusalem", () => {
  it("TASK-3: an open task due before today is overdue; today, later or no due date is not", () => {
    expect(isOverdue({ due_date: "2026-11-22", status: "open" }, "2026-11-23")).toBe(true);
    expect(isOverdue({ due_date: "2026-11-23", status: "open" }, "2026-11-23")).toBe(false);
    expect(isOverdue({ due_date: "2026-11-24", status: "open" }, "2026-11-23")).toBe(false);
    expect(isOverdue({ due_date: null, status: "open" }, "2026-11-23")).toBe(false);
  });

  it("TASK-3: a done or cancelled task is never overdue", () => {
    expect(isOverdue({ due_date: "2020-01-01", status: "done" }, "2026-11-23")).toBe(false);
    expect(isOverdue({ due_date: "2020-01-01", status: "cancelled" }, "2026-11-23")).toBe(false);
  });

  it("TASK-3: a task due today turns overdue exactly at local midnight, not UTC midnight", () => {
    const dueToday = { due_date: "2026-11-23", status: "open" } as const;
    // Winter (UTC+2): 23:59:59 local on 23/11 is 21:59:59 UTC.
    expect(isOverdue(dueToday, todayInJerusalem(new Date("2026-11-23T21:59:59.999Z")))).toBe(false);
    expect(isOverdue(dueToday, todayInJerusalem(new Date("2026-11-23T22:00:00.000Z")))).toBe(true);
    // Still 23/11 in UTC, already 24/11 in Israel.
    expect(isOverdue(dueToday, todayInJerusalem(new Date("2026-11-23T23:30:00.000Z")))).toBe(true);
  });

  it("TASK-3: in summer time (UTC+3) the day turns at 21:00 UTC", () => {
    const dueToday = { due_date: "2026-07-15", status: "open" } as const;
    expect(isOverdue(dueToday, todayInJerusalem(new Date("2026-07-15T20:59:59.999Z")))).toBe(false);
    expect(isOverdue(dueToday, todayInJerusalem(new Date("2026-07-15T21:00:00.000Z")))).toBe(true);
  });
});

describe("TASK-6: groups by due date around midnight and DST", () => {
  const tasks = [
    task({ id: "yesterday", due_date: "2026-03-26" }),
    task({ id: "today", due_date: "2026-03-27" }),
    task({ id: "tomorrow", due_date: "2026-03-28" }),
    task({ id: "later", due_date: "2026-03-29" }),
    task({ id: "none", due_date: null }),
  ];

  it("TASK-6: באיחור, היום, מחר, בהמשך, ללא דדליין, in this order", () => {
    const groups = groupOpenTasks(tasks, "2026-03-27");
    expect(groups.map((group) => group.label)).toEqual([
      "באיחור",
      "היום",
      "מחר",
      "בהמשך",
      "ללא דדליין",
    ]);
    expect(shape(groups)).toEqual([
      ["overdue", ["yesterday"]],
      ["today", ["today"]],
      ["tomorrow", ["tomorrow"]],
      ["later", ["later"]],
      ["no_due_date", ["none"]],
    ]);
  });

  it("TASK-6: summer time starts 27/03/2026 at 02:00; the groups move at the local midnight before it", () => {
    // 23:59:59 local on 26/03 (UTC+2) and 00:00 local on 27/03 (still UTC+2).
    const before = todayInJerusalem(new Date("2026-03-26T21:59:59.999Z"));
    const after = todayInJerusalem(new Date("2026-03-26T22:00:00.000Z"));
    expect(before).toBe("2026-03-26");
    expect(after).toBe("2026-03-27");
    expect(shape(groupOpenTasks(tasks, before))[0]).toEqual(["today", ["yesterday"]]);
    expect(shape(groupOpenTasks(tasks, after))[0]).toEqual(["overdue", ["yesterday"]]);
    // The first night in summer time: the day turns at 21:00 UTC.
    expect(todayInJerusalem(new Date("2026-03-27T20:59:59.999Z"))).toBe("2026-03-27");
    expect(todayInJerusalem(new Date("2026-03-27T21:00:00.000Z"))).toBe("2026-03-28");
  });

  it("TASK-6: summer time ends 25/10/2026; tomorrow is still the next calendar day across the change", () => {
    const octoberTasks = [
      task({ id: "sat", due_date: "2026-10-24" }),
      task({ id: "sun", due_date: "2026-10-25" }),
      task({ id: "mon", due_date: "2026-10-26" }),
    ];
    // 00:00 local on 25/10 is 21:00 UTC on 24/10 (still UTC+3 until 02:00).
    const today = todayInJerusalem(new Date("2026-10-24T21:00:00.000Z"));
    expect(today).toBe("2026-10-25");
    expect(todayInJerusalem(new Date("2026-10-24T20:59:59.999Z"))).toBe("2026-10-24");
    expect(shape(groupOpenTasks(octoberTasks, today))).toEqual([
      ["overdue", ["sat"]],
      ["today", ["sun"]],
      ["tomorrow", ["mon"]],
    ]);
    // After the change (UTC+2) the next day starts at 22:00 UTC.
    expect(todayInJerusalem(new Date("2026-10-25T21:59:59.999Z"))).toBe("2026-10-25");
    expect(todayInJerusalem(new Date("2026-10-25T22:00:00.000Z"))).toBe("2026-10-26");
  });

  it("TASK-6: tomorrow crosses month and year ends (31/12 → 1/1) and leap days", () => {
    expect(taskGroupOf("2027-01-01", "2026-12-31")).toBe("tomorrow");
    expect(taskGroupOf("2028-02-29", "2028-02-28")).toBe("tomorrow");
    expect(taskGroupOf("2028-03-01", "2028-02-28")).toBe("later");
    expect(taskGroupOf("2026-12-31", "2027-01-01")).toBe("overdue");
  });

  it("TASK-6: empty groups are left out and no tasks gives no groups", () => {
    expect(groupOpenTasks([], "2026-11-23")).toEqual([]);
    expect(shape(groupOpenTasks([task({ id: "x", due_date: null })], "2026-11-23"))).toEqual([
      ["no_due_date", ["x"]],
    ]);
  });
});

describe("TASK-6: sorting within a group", () => {
  it("TASK-6: by due date, then priority (high first), then the oldest created, then id", () => {
    const sorted = [
      task({ id: "c", due_date: "2026-11-30", priority: "low" }),
      task({ id: "b", due_date: "2026-11-30", priority: "high" }),
      task({ id: "a", due_date: "2026-11-25", priority: "low" }),
      task({
        id: "e",
        due_date: "2026-11-30",
        priority: "normal",
        created_at: "2026-01-02T00:00:00Z",
      }),
      task({
        id: "d",
        due_date: "2026-11-30",
        priority: "normal",
        created_at: "2026-01-01T00:00:00Z",
      }),
      task({
        id: "f2",
        due_date: "2026-11-30",
        priority: "normal",
        created_at: "2026-01-02T00:00:00Z",
      }),
    ].sort(compareTasks);
    expect(sorted.map((item) => item.id)).toEqual(["a", "b", "d", "e", "f2", "c"]);
  });

  it("TASK-6: a group keeps the order inside it whatever order the tasks came in", () => {
    const later = [
      task({ id: "low", due_date: "2026-12-01", priority: "low" }),
      task({ id: "early", due_date: "2026-11-28", priority: "low" }),
      task({ id: "high", due_date: "2026-12-01", priority: "high" }),
    ];
    const groups = groupOpenTasks(later, "2026-11-23");
    expect(shape(groups)).toEqual([["later", ["early", "high", "low"]]]);
    expect(shape(groupOpenTasks([...later].reverse(), "2026-11-23"))).toEqual(shape(groups));
  });

  it("TASK-6: tasks without a due date sort by priority among themselves", () => {
    const groups = groupOpenTasks(
      [task({ id: "n-low", priority: "low" }), task({ id: "n-high", priority: "high" })],
      "2026-11-23",
    );
    expect(shape(groups)).toEqual([["no_due_date", ["n-high", "n-low"]]]);
  });
});

describe("NOTIF-1: the navigation badge", () => {
  it("NOTIF-1: counts overdue and today's tasks, not tomorrow's", () => {
    expect(badgeCount({ overdue: 2, today: 1, tomorrow: 5 })).toBe(3);
    expect(badgeCount({ overdue: 0, today: 0, tomorrow: 4 })).toBe(0);
  });

  it("NOTIF-1: screen readers hear the count after the item's name; nothing for 0", () => {
    expect(`משימות${badgeSpokenSuffix(3, "tasks")}`).toBe("משימות, 3 לטיפול");
    expect(`עוד${badgeSpokenSuffix(1, "more")}`).toBe("עוד, משימה אחת לטיפול");
    expect(`עוד${badgeSpokenSuffix(4, "more")}`).toBe("עוד, 4 משימות לטיפול");
    expect(badgeSpokenSuffix(0, "tasks")).toBe("");
  });

  it("NOTIF-1: the pill shows up to 99 and then 99+", () => {
    expect(badgeDisplayText(1)).toBe("1");
    expect(badgeDisplayText(99)).toBe("99");
    expect(badgeDisplayText(100)).toBe("99+");
  });
});
