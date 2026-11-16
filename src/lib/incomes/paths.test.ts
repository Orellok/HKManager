import { describe, expect, it } from "vitest";

import {
  editIncomePath,
  newProjectIncomePath,
  recordPaymentPath,
  returnPath,
  returnTargetFrom,
} from "./paths";

const ID = "3f2b8c1e-0a4d-4e8f-9b6a-1c2d3e4f5a6b";

describe("incomes paths", () => {
  it("MS-4: רשום תשלום opens the form for the milestone and returns to the project", () => {
    expect(recordPaymentPath(ID)).toBe(`/incomes/new?milestone=${ID}&from=project`);
    expect(newProjectIncomePath(ID)).toBe(`/incomes/new?project=${ID}&from=project`);
  });

  it("INC-1: the edit path names the return target only for the project card", () => {
    expect(editIncomePath(ID)).toBe(`/incomes/${ID}/edit`);
    expect(editIncomePath(ID, "project")).toBe(`/incomes/${ID}/edit?from=project`);
  });

  it("INC-1: only from=project returns to a project card, and only with a project", () => {
    expect(returnTargetFrom("project")).toBe("project");
    expect(returnTargetFrom("https://example.com")).toBe("incomes");
    expect(returnTargetFrom(["project"])).toBe("incomes");
    expect(returnPath("project", ID)).toBe(`/projects/${ID}`);
    expect(returnPath("project", null)).toBe("/incomes");
    expect(returnPath("incomes", ID)).toBe("/incomes");
  });
});
