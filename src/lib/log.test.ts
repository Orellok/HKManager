import { afterEach, describe, expect, it, vi } from "vitest";

import { logDbFailure } from "./log";

describe("logDbFailure", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("PRJ-1: logs the Postgres code and never the error message or details", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("Could not save", {
      cause: { code: "23514", message: "row (דנה לוי, 050-1234567)", details: "דנה" },
    });

    logDbFailure("projects", "create", error);

    expect(log).toHaveBeenCalledWith("projects: create failed (code 23514)");
  });

  it("PRJ-1: logs code none for an error without a Postgres cause", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    logDbFailure("projects", "read", new Error("network"));

    expect(log).toHaveBeenCalledWith("projects: read failed (code none)");
  });
});
