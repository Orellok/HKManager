import { describe, expect, it } from "vitest";

import {
  editTaskPath,
  newClientTaskPath,
  newProjectTaskPath,
  taskReturnPath,
  taskReturnTargetFrom,
  tasksViewFrom,
} from "./paths";

const ID = "11111111-1111-4111-8111-111111111111";

describe("TASK-8: task routes carry ids and fixed codes only", () => {
  it("TASK-8: quick create from a card fills the link and returns to the card", () => {
    expect(newClientTaskPath(ID)).toBe(`/tasks/new?client=${ID}&from=client`);
    expect(newProjectTaskPath(ID)).toBe(`/tasks/new?project=${ID}&from=project`);
    expect(editTaskPath(ID)).toBe(`/tasks/${ID}/edit`);
    expect(editTaskPath(ID, "project")).toBe(`/tasks/${ID}/edit?from=project`);
  });

  it("TASK-8: a saved task returns to its card, or to the list when it has no such link", () => {
    expect(taskReturnPath("client", { clientId: ID, projectId: null })).toBe(`/clients/${ID}`);
    expect(taskReturnPath("project", { clientId: ID, projectId: ID })).toBe(`/projects/${ID}`);
    expect(taskReturnPath("project", { clientId: ID, projectId: null })).toBe("/tasks");
    expect(taskReturnPath("tasks", { clientId: ID, projectId: ID })).toBe("/tasks");
  });

  it("TASK-6: anything but known codes means the list and the open tab", () => {
    expect(taskReturnTargetFrom("client")).toBe("client");
    expect(taskReturnTargetFrom("https://example.com")).toBe("tasks");
    expect(taskReturnTargetFrom(undefined)).toBe("tasks");
    expect(tasksViewFrom("closed")).toBe("closed");
    expect(tasksViewFrom(["closed"])).toBe("open");
  });
});
