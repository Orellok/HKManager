import { describe, expect, it } from "vitest";

import { CREATE_KEY_FIELD, isCreateKeyConflict, newCreateKey, readCreateKey } from "./create-key";

function form(value?: string): FormData {
  const data = new FormData();
  if (value !== undefined) {
    data.set(CREATE_KEY_FIELD, value);
  }
  return data;
}

describe("M7.1-8: create keys", () => {
  it("M7.1-8: a new key is a UUID, different every time", () => {
    const first = newCreateKey();
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newCreateKey()).not.toBe(first);
  });

  it("M7.1-8: reads a submitted UUID (lower case)", () => {
    const key = newCreateKey();
    expect(readCreateKey(form(key))).toBe(key);
    expect(readCreateKey(form(key.toUpperCase()))).toBe(key);
  });

  it("M7.1-8: a missing, empty or malformed key reads as none", () => {
    for (const value of [undefined, "", "abc", "1; drop table clients", `${newCreateKey()}x`]) {
      expect(readCreateKey(form(value))).toBeNull();
    }
    const file = new FormData();
    file.set(CREATE_KEY_FIELD, new Blob(["x"]));
    expect(readCreateKey(file)).toBeNull();
  });

  it("M7.1-8: only a unique violation of the table's own key constraint counts", () => {
    const message = 'duplicate key value violates unique constraint "clients_create_key_key"';
    expect(isCreateKeyConflict({ code: "23505", message }, "clients")).toBe(true);
    expect(
      isCreateKeyConflict(
        { code: "23505", message: "x", details: "clients_create_key_key" },
        "clients",
      ),
    ).toBe(true);
    expect(isCreateKeyConflict({ code: "23505", message }, "tasks")).toBe(false);
    expect(
      isCreateKeyConflict(
        { code: "23505", message: 'violates unique constraint "expenses_file_path_key"' },
        "expenses",
      ),
    ).toBe(false);
    expect(isCreateKeyConflict({ code: "23503", message }, "clients")).toBe(false);
    expect(isCreateKeyConflict(null, "clients")).toBe(false);
  });
});
