import { describe, expect, it } from "vitest";

import { listObjects, objectFilePath } from "./storage.mts";

type Entry = { name: string; id: string | null; metadata: { mimetype: string } | null };

/** A Storage API that lists a small tree, recording the prefixes asked for. */
function fakeStorage(tree: Record<string, Entry[]>) {
  const asked: string[] = [];
  const headers: Record<string, string>[] = [];
  const fetchFn = (async (_url: URL | RequestInfo, init: RequestInit = {}) => {
    const { prefix, offset } = JSON.parse(String(init.body)) as { prefix: string; offset: number };
    asked.push(prefix);
    headers.push(init.headers as Record<string, string>);
    return new Response(JSON.stringify(offset === 0 ? (tree[prefix] ?? []) : []));
  }) as typeof fetch;
  return { fetchFn, asked, headers };
}

const file = (name: string, mimetype = "application/pdf"): Entry => ({
  name,
  id: "x",
  metadata: { mimetype },
});
const folder = (name: string): Entry => ({ name, id: null, metadata: null });

describe("M7.3-2: Storage export listing", () => {
  it("M7.3-2: lists every object of a bucket, descending into folders", async () => {
    const { fetchFn, asked } = fakeStorage({
      "": [folder("inc1"), file("root.pdf")],
      inc1: [folder("deep"), file("a.pdf")],
      "inc1/deep": [file("b.png", "image/png")],
    });
    const objects = await listObjects(
      { apiUrl: "http://s", serviceKey: "jwt", fetch: fetchFn },
      "receipts",
    );
    expect(objects).toEqual([
      { path: "root.pdf", contentType: "application/pdf" },
      { path: "inc1/a.pdf", contentType: "application/pdf" },
      { path: "inc1/deep/b.png", contentType: "image/png" },
    ]);
    expect(asked).toEqual(["", "inc1", "inc1/deep"]);
  });

  it("M7.3-2: a legacy key goes as Bearer too; a new secret key only as apikey", async () => {
    const legacy = fakeStorage({});
    await listObjects({ apiUrl: "http://s", serviceKey: "eyJ.jwt", fetch: legacy.fetchFn }, "b");
    expect(legacy.headers[0]).toMatchObject({ apikey: "eyJ.jwt", Authorization: "Bearer eyJ.jwt" });
    const secret = fakeStorage({});
    await listObjects(
      { apiUrl: "http://s", serviceKey: "sb_secret_x", fetch: secret.fetchFn },
      "b",
    );
    expect(secret.headers[0].Authorization).toBeUndefined();
  });

  it("M7.3-6: a failing listing reports status and code only", async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ error: "Unauthorized", message: "secret detail" }), {
        status: 403,
      })) as typeof fetch;
    await expect(
      listObjects({ apiUrl: "http://s", serviceKey: "k", fetch: fetchFn }, "b"),
    ).rejects.toThrow(/^Storage object listing failed: HTTP 403 \(Unauthorized\)$/);
  });

  it("M7.3-2: object files stay inside the backup folder", () => {
    expect(objectFilePath("/w/storage", "receipts", "a/b.pdf")).toBe("/w/storage/receipts/a/b.pdf");
    expect(() => objectFilePath("/w/storage", "receipts", "../../x")).toThrow(/unsupported name/);
    expect(() => objectFilePath("/w/storage", "..", "x")).toThrow(/unsupported name/);
  });
});
