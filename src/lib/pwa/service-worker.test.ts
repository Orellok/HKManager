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
type FakeWindow = {
  url: string;
  focus: ReturnType<typeof vi.fn>;
  navigate: ReturnType<typeof vi.fn>;
};

function fakeWindow(url: string, navigateFails = false): FakeWindow {
  const client: FakeWindow = {
    url,
    focus: vi.fn(async () => client),
    navigate: vi.fn(async () => {
      if (navigateFails) {
        throw new TypeError("not controlled");
      }
      return client;
    }),
  };
  return client;
}

function loadServiceWorker(
  network: (url: string) => FakeResponse = (url) => fakeResponse(url),
  windows: FakeWindow[] = [],
) {
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
    clients: {
      claim: vi.fn(async () => undefined),
      matchAll: vi.fn(async () => windows),
      openWindow: vi.fn(async () => null),
    },
    registration: { showNotification: vi.fn(async () => undefined) },
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

  async function dispatchPush(data: (() => unknown) | null) {
    let work: Promise<unknown> = Promise.resolve();
    listeners.get("push")?.({
      data: data === null ? null : { json: data },
      waitUntil: (promise: Promise<unknown>) => (work = promise),
    });
    await work;
  }

  async function dispatchClick(data: unknown) {
    let work: Promise<unknown> = Promise.resolve();
    const notification = { data, close: vi.fn() };
    listeners.get("notificationclick")?.({
      notification,
      waitUntil: (promise: Promise<unknown>) => (work = promise),
    });
    await work;
    return notification;
  }

  return {
    stores,
    open,
    fetchSpy,
    dispatchFetch,
    dispatchActivate,
    dispatchPush,
    dispatchClick,
    self,
  };
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
});

describe("M7.2-10: push notifications in the service worker", () => {
  it("M7.2-10: shows the pushed summary in Hebrew RTL with the icon, tag and target", async () => {
    const sw = loadServiceWorker();
    await sw.dispatchPush(() => ({
      title: "HKManager",
      body: "2 משימות להיום · 1 למחר",
      url: "/tasks",
      tag: "hkmanager-daily",
    }));
    expect(sw.self.registration.showNotification).toHaveBeenCalledWith("HKManager", {
      body: "2 משימות להיום · 1 למחר",
      tag: "hkmanager-daily",
      renotify: true,
      dir: "rtl",
      lang: "he",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: "/tasks" },
    });
  });

  it.each([
    ["no data", null],
    ["data that is not JSON", () => JSON.parse("not json")],
    ["a JSON value that is not an object", () => 42],
  ])("M7.2-10: %s shows a generic notification", async (_label, data) => {
    const sw = loadServiceWorker();
    await sw.dispatchPush(data);
    expect(sw.self.registration.showNotification).toHaveBeenCalledWith(
      "HKManager",
      expect.objectContaining({ body: "יש עדכון במשימות.", data: { url: "/tasks" } }),
    );
  });

  it.each([
    ["another origin", "https://evil.example/phish", "/tasks"],
    ["a protocol-relative URL", "//evil.example/x", "/tasks"],
    ["a script URL", "javascript:alert(1)", "/tasks"],
    ["a non-string", 7, "/tasks"],
    ["a same-origin path", "/settings", "/settings"],
    ["a same-origin absolute URL", `${ORIGIN}/tasks?view=list`, "/tasks?view=list"],
  ])("M7.2-10: a payload target that is %s opens %s", async (_label, url, expected) => {
    const sw = loadServiceWorker();
    await sw.dispatchPush(() => ({ title: "t", body: "b", url, tag: "x" }));
    expect(sw.self.registration.showNotification).toHaveBeenCalledWith(
      "t",
      expect.objectContaining({ data: { url: expected } }),
    );
  });

  it("M7.2-10: overlong text is cut, empty text falls back", async () => {
    const sw = loadServiceWorker();
    await sw.dispatchPush(() => ({ title: "", body: "א".repeat(1000), url: "/tasks", tag: "" }));
    const [title, options] = sw.self.registration.showNotification.mock.calls[0] as unknown as [
      string,
      { body: string; tag: string },
    ];
    expect(title).toBe("HKManager");
    expect(options.body).toHaveLength(400);
    expect(options.tag).toBe("hkmanager-daily");
  });

  it("M7.2-10: a click focuses an open app window and takes it to the target", async () => {
    const other = fakeWindow("https://other.example/");
    const app = fakeWindow(`${ORIGIN}/clients`);
    const sw = loadServiceWorker(undefined, [other, app]);
    const notification = await sw.dispatchClick({ url: "/tasks" });
    expect(notification.close).toHaveBeenCalled();
    expect(app.focus).toHaveBeenCalled();
    expect(app.navigate).toHaveBeenCalledWith(`${ORIGIN}/tasks`);
    expect(other.focus).not.toHaveBeenCalled();
    expect(sw.self.clients.openWindow).not.toHaveBeenCalled();
  });

  it("M7.2-10: with no app window a click opens one; a foreign target opens the tasks", async () => {
    const sw = loadServiceWorker();
    await sw.dispatchClick({ url: "https://evil.example/" });
    expect(sw.self.clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/tasks`);
  });

  it("M7.2-10: a window that cannot be navigated → a new window", async () => {
    const app = fakeWindow(`${ORIGIN}/`, true);
    const sw = loadServiceWorker(undefined, [app]);
    await sw.dispatchClick({ url: "/settings" });
    expect(sw.self.clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/settings`);
  });

  it("M7.2-10: static-only caching is unchanged (no fetch handling for pages)", async () => {
    const sw = loadServiceWorker();
    expect(await sw.dispatchFetch(`${ORIGIN}/tasks`)).toBeUndefined();
  });
});
