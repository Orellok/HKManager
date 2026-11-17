import { describe, expect, it } from "vitest";

import { transactionDescription } from "./queries";

describe("transactionDescription", () => {
  it("DOC-1: a milestone payment is described by its project and milestone", () => {
    expect(
      transactionDescription({ projectName: "דירה", milestoneDescription: "מקדמה", notes: "x" }),
    ).toBe("דירה – מקדמה");
  });

  it("DOC-1: a project payment without a milestone is described by the project", () => {
    expect(
      transactionDescription({ projectName: "דירה", milestoneDescription: null, notes: "x" }),
    ).toBe("דירה");
  });

  it("DOC-1: an income without a project is described by its notes, or has no description", () => {
    expect(
      transactionDescription({ projectName: null, milestoneDescription: null, notes: "ייעוץ" }),
    ).toBe("ייעוץ");
    expect(
      transactionDescription({ projectName: null, milestoneDescription: null, notes: null }),
    ).toBeNull();
  });
});
