import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

import { describe, expect, it, vi } from "vitest";

const SOURCE = readFileSync(
  fileURLToPath(new URL("../../../public/sw.js", import.meta.url)),
  "utf8",
);
const ORIGIN = "https://hkmanager.example";

type FakeResponse = { ok: boolean; type: string; body: string; clone: () => FakeResponse };
type Listener = (event: unknown) => void;

function fakeResponse(body: string, ok = true, type = "basic"): FakeResponse {
  const response: FakeResponse = { ok, type, body, clone: () => response };
  return response;
}

/** Runs public/sw.js against an in-memory Cache Storage and a fake network. */
function loadServiceWorker(network: (url: string) => FakeResponse = (url) => fakeResponse(url)) {
  const stores = new Map<string, Map<string, FakeResponse>>();
  const open = (name: string) => {
    const entries = stores.get(name) ?? new Map<string, FakeResponse>();
    stores.set(name, entries);
    const keyOf = (request: Request | string) =>
      typeof request === "string" ? request : request.url;
    return {
      match: async (request: Request) => entries.get(keyOf(request)),
      put: async (request: Request, response: FakeResponse) => {
        entries.set(keyOf(request), response);
      },
      keys: async () => [...entries.keys()],
      delete: async (request: Request | string) => entries.delete(keyOf(request)),
    };
  };
  const caches = {
    open: async (name: string) => open(name),
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
  };
  const listeners = new Map<string, Listener>();
  const fetchSpy = vi.fn(async (request: Request) => network(request.url));
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn(async () => undefined) },
  };
  runInNewContext(SOURCE, { self, caches, fetch: fetchSpy, URL });

  async function dispatchFetch(url: string, method = "GET") {
    let answer: Promise<FakeResponse> | undefined;
    listeners.get("fetch")?.({
      request: new Request(url, { method }),
      respondWith: (response: Promise<FakeResponse>) => {
        answer = response;
      },
    });
    return answer === undefined ? undefined : await answer;
  }

  async function dispatchActivate() {
    let work: Promise<unknown> = Promise.resolve();
    listeners.get("activate")?.({ waitUntil: (promise: Promise<unknown>) => (work = promise) });
    await work;
  }

  return { stores, open, fetchSpy, dispatchFetch, dispatchActivate, self };
}

describe("M7.1-3: the service worker caches static assets only", () => {
  it("M7.1-3: build assets and icons are served cache-first after the first fetch", async () => {
    const sw = loadServiceWorker();
    for (const path of ["/_next/static/chunks/app-abc123.js", "/icons/icon-192.png"]) {
      expect((await sw.dispatchFetch(`${ORIGIN}${path}`))?.body).toBe(`${ORIGIN}${path}`);
      expect((await sw.dispatchFetch(`${ORIGIN}${path}`))?.body).toBe(`${ORIGIN}${path}`);
    }
    expect(sw.fetchSpy).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["a page", "/"],
    ["a screen with data", "/clients/11111111-1111-4111-8111-111111111111"],
    ["an RSC payload", "/?_rsc=abc"],
    ["a file route", "/expenses/11111111-1111-4111-8111-111111111111/file"],
    ["the manifest", "/manifest.webmanifest"],
    ["a static asset with a query", "/_next/static/chunks/a.js?v=1"],
    ["a look-alike path", "/_next/staticx/a.js"],
  ])("M7.1-3: %s is not intercepted (no page or data is cached)", async (_label, path) => {
    const sw = loadServiceWorker();
    expect(await sw.dispatchFetch(`${ORIGIN}${path}`)).toBeUndefined();
    expect(sw.fetchSpy).not.toHaveBeenCalled();
  });

  it("M7.1-3: other origins (Supabase) and non-GET requests are not intercepted", async () => {
    const sw = loadServiceWorker();
    expect(await sw.dispatchFetch("https://x.supabase.co/_next/static/a.js")).toBeUndefined();
    expect(await sw.dispatchFetch(`${ORIGIN}/_next/static/a.js`, "POST")).toBeUndefined();
  });

  it("M7.1-3: error and opaque answers are passed on but never stored", async () => {
    const sw = loadServiceWorker((url) =>
      url.endsWith("missing.js") ? fakeResponse("404", false) : fakeResponse("x", true, "opaque"),
    );
    await sw.dispatchFetch(`${ORIGIN}/_next/static/missing.js`);
    await sw.dispatchFetch(`${ORIGIN}/_next/static/opaque.js`);
    const stored = [...sw.stores.values()].reduce((count, entries) => count + entries.size, 0);
    expect(stored).toBe(0);
  });

  it("M7.1-3: activation deletes older versions of its cache and keeps other caches", async () => {
    const sw = loadServiceWorker();
    await sw.open("hkmanager-static-v0");
    await sw.open("someone-else");
    await sw.dispatchFetch(`${ORIGIN}/_next/static/a.js`);
    await sw.dispatchActivate();
    expect([...sw.stores.keys()].sort()).toEqual(["hkmanager-static-v1", "someone-else"]);
    expect(sw.self.clients.claim).toHaveBeenCalled();
  });

  it("M7.1-3: the cache keeps at most 300 entries, dropping the oldest", async () => {
    const sw = loadServiceWorker();
    for (let index = 0; index < 302; index += 1) {
      await sw.dispatchFetch(`${ORIGIN}/_next/static/${index}.js`);
    }
    const entries = sw.stores.get("hkmanager-static-v1");
    expect(entries?.size).toBe(300);
    expect(entries?.has(`${ORIGIN}/_next/static/0.js`)).toBe(false);
    expect(entries?.has(`${ORIGIN}/_next/static/301.js`)).toBe(true);
  });

  it("M7.1-3: has no push handlers yet (M7.2)", () => {
    expect(SOURCE).not.toMatch(/addEventListener\(\s*["'](push|notificationclick)["']/);
  });
});
