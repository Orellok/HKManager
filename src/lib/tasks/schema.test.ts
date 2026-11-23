import { describe, expect, it } from "vitest";

import { EMPTY_TASK_FORM_VALUES, TASK_FIELD_MESSAGES, validateTaskInput } from "./schema";

const CLIENT = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";

function values(fields: Partial<typeof EMPTY_TASK_FORM_VALUES>) {
  return { ...EMPTY_TASK_FORM_VALUES, ...fields };
}

describe("TASK-1 / TASK-2: the task form schema", () => {
  it("TASK-1: only the title is required; a new task is open with normal priority", () => {
    const result = validateTaskInput(values({ title: "  להזמין אריחים  " }));
    expect(result).toEqual({
      success: true,
      data: {
        title: "להזמין אריחים",
        due_date: null,
        priority: "normal",
        client_id: null,
        project_id: null,
        description: null,
        status: "open",
      },
    });
  });

  it("TASK-1: a missing or too long title, or an unknown priority or status, is refused", () => {
    expect(validateTaskInput(values({ title: "   " }))).toEqual({
      success: false,
      fieldErrors: { title: TASK_FIELD_MESSAGES.titleRequired },
    });
    expect(validateTaskInput(values({ title: "א".repeat(201) }))).toMatchObject({
      success: false,
      fieldErrors: { title: TASK_FIELD_MESSAGES.titleTooLong },
    });
    expect(validateTaskInput(values({ title: "א".repeat(200) })).success).toBe(true);
    expect(validateTaskInput(values({ title: "x", priority: "urgent" }))).toMatchObject({
      success: false,
      fieldErrors: { priority: TASK_FIELD_MESSAGES.priorityRequired },
    });
    expect(validateTaskInput(values({ title: "x", status: "overdue" }))).toMatchObject({
      success: false,
      fieldErrors: { status: TASK_FIELD_MESSAGES.statusRequired },
    });
  });

  it("TASK-2: the due date is optional, date only, and may be in the past", () => {
    expect(validateTaskInput(values({ title: "x", due_date: "2020-01-01" }))).toMatchObject({
      success: true,
      data: { due_date: "2020-01-01" },
    });
    expect(validateTaskInput(values({ title: "x", due_date: "2026-02-30" }))).toMatchObject({
      success: false,
      fieldErrors: { due_date: "יש להזין תאריך תקין." },
    });
    expect(validateTaskInput(values({ title: "x", due_date: "2026-11-23T09:00" }))).toMatchObject({
      success: false,
    });
    expect(validateTaskInput(values({ title: "x", due_date: "2101-01-01" }))).toMatchObject({
      success: false,
      fieldErrors: { due_date: "יש להזין תאריך בין 01/01/1900 ל-31/12/2100." },
    });
  });

  it("TASK-9: client and project are ids or empty; the description keeps \\n line breaks", () => {
    expect(
      validateTaskInput(
        values({ title: "x", client_id: CLIENT, project_id: PROJECT, description: "א\r\nב" }),
      ),
    ).toMatchObject({
      success: true,
      data: { client_id: CLIENT, project_id: PROJECT, description: "א\nב" },
    });
    expect(validateTaskInput(values({ title: "x", client_id: "not-an-id" }))).toMatchObject({
      success: false,
      fieldErrors: { client_id: TASK_FIELD_MESSAGES.clientInvalid },
    });
    expect(validateTaskInput(values({ title: "x", project_id: "1" }))).toMatchObject({
      success: false,
      fieldErrors: { project_id: TASK_FIELD_MESSAGES.projectInvalid },
    });
    expect(validateTaskInput(values({ title: "x", description: "א".repeat(2001) }))).toMatchObject({
      success: false,
      fieldErrors: { description: TASK_FIELD_MESSAGES.descriptionTooLong },
    });
  });

  it("TASK-3: the edit form's status is open, done or cancelled", () => {
    for (const status of ["open", "done", "cancelled"]) {
      expect(validateTaskInput(values({ title: "x", status }))).toMatchObject({
        success: true,
        data: { status },
      });
    }
  });
});
