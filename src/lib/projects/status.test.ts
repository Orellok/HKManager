import { describe, expect, it } from "vitest";

import {
  DEFAULT_STATUS_FILTER,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  isProjectStatus,
  statusesForFilter,
} from "./status";

describe("project statuses", () => {
  it("PRJ-2: has the five statuses with their Hebrew labels", () => {
    expect(PROJECT_STATUSES.map((status) => PROJECT_STATUS_LABELS[status])).toEqual([
      "ליד",
      "פעיל",
      "מושהה",
      "הושלם",
      "בוטל",
    ]);
  });

  it("PRJ-2: the default filter shows lead, active and on_hold", () => {
    expect(statusesForFilter(DEFAULT_STATUS_FILTER)).toEqual(["lead", "active", "on_hold"]);
  });

  it("PRJ-2: the all filter does not limit statuses; a status filter shows that status", () => {
    expect(statusesForFilter("all")).toBeNull();
    expect(statusesForFilter("completed")).toEqual(["completed"]);
  });

  it.each(["lead", "cancelled"])("PRJ-2: %j is a status", (value) => {
    expect(isProjectStatus(value)).toBe(true);
  });

  it.each(["", "open", "Lead", "toString", null, 1])("PRJ-2: %j is not a status", (value) => {
    expect(isProjectStatus(value)).toBe(false);
  });
});
