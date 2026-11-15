import { describe, expect, it } from "vitest";

import { cn } from "./utils";

describe("cn", () => {
  it("M0.1-3: joins class names and drops falsy values", () => {
    expect(cn("p-4", false, undefined, null, "", "text-sm")).toBe("p-4 text-sm");
  });

  it("M0.1-3: lets a later Tailwind utility override a conflicting earlier one", () => {
    expect(cn("ps-2 text-sm", "ps-4")).toBe("text-sm ps-4");
  });

  it("M0.1-3: returns an empty string when nothing is passed", () => {
    expect(cn()).toBe("");
  });
});
