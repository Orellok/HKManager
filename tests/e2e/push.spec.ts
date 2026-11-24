import type { Page } from "@playwright/test";

import { PUSH_MOCK_URL } from "../../playwright.config";

import { createServiceRoleClient, expect, test_ } from "./support/data-fixtures";
import {
  MIN_TOUCH_TARGET,
  VIEWPORT_WIDTHS_BY_PROJECT,
  hasHorizontalScroll,
} from "./support/helpers";

/**
 * M7.2: the settings screen's push section. Headless Chromium has no push service, so the
 * browser's Notification / PushManager / service worker are replaced by a stub (below) and
 * the test push goes to a stand-in for the Edge Function (tests/support/push-function-mock.mts).
 * The real service worker's push handling: push-service-worker.spec.ts.
 */

type StubOptions = {
  /** Without PushManager: a browser that cannot do push. */
  supported?: boolean;
  permission?: NotificationPermission;
  /** What the permission prompt answers. */
  answer?: NotificationPermission;
  /** Part of the endpoint the stub subscribes with; steers the function mock. */
  endpointKind?: string;
  /** The browser already has a subscription (made with the app's key). */
  subscribed?: boolean;
};

type PushStub = {
  permission: NotificationPermission;
  requests: number;
  endpoint: string | null;
  unsubscribed: number;
};

async function stubPush(page: Page, options: StubOptions = {}) {
  await page.addInitScript(
    (stub: Required<StubOptions> & { token: string }) => {
      const state = {
        permission: stub.permission,
        requests: 0,
        endpoint: null as string | null,
        unsubscribed: 0,
      };
      (window as unknown as { __pushStub: typeof state }).__pushStub = state;
      const bytes = (length: number, first: number) => {
        const array = new Uint8Array(length).fill(7);
        array[0] = first;
        return array.buffer;
      };
      let subscription: PushSubscription | null = null;
      const makeSubscription = (key: ArrayBuffer | null) => {
        const endpoint = `https://fcm.googleapis.com/fcm/send/e2e-${stub.endpointKind}-${stub.token}-${Math.random().toString(36).slice(2)}`;
        state.endpoint = endpoint;
        return {
          endpoint,
          options: { applicationServerKey: key, userVisibleOnly: true },
          getKey: (name: string) => (name === "p256dh" ? bytes(65, 4) : bytes(16, 1)),
          unsubscribe: async () => {
            state.unsubscribed += 1;
            subscription = null;
            return true;
          },
        } as unknown as PushSubscription;
      };
      const pushManager = {
        getSubscription: async () => subscription,
        subscribe: async (init: { applicationServerKey: Uint8Array }) => {
          subscription = makeSubscription(init.applicationServerKey.slice().buffer);
          return subscription;
        },
      };
      if (stub.subscribed) {
        subscription = makeSubscription(null);
      }
      const registration = { pushManager, scope: "/" };
      Object.defineProperty(navigator, "serviceWorker", {
        configurable: true,
        value: {
          getRegistration: async () => registration,
          register: async () => registration,
          ready: Promise.resolve(registration),
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        },
      });
      class FakeNotification {
        static get permission() {
          return state.permission;
        }
        static async requestPermission() {
          state.requests += 1;
          state.permission = stub.answer;
          return stub.answer;
        }
      }
      Object.defineProperty(window, "Notification", {
        configurable: true,
        value: FakeNotification,
      });
      if (stub.supported) {
        Object.defineProperty(window, "PushManager", {
          configurable: true,
          value: function PushManager() {},
        });
      } else {
        delete (window as { PushManager?: unknown }).PushManager;
      }
    },
    {
      supported: options.supported ?? true,
      permission: options.permission ?? "default",
      answer: options.answer ?? "granted",
      endpointKind: options.endpointKind ?? "ok",
      subscribed: options.subscribed ?? false,
      token: Math.random().toString(36).slice(2),
    },
  );
}

function readStub(page: Page): Promise<PushStub> {
  return page.evaluate(() => (window as unknown as { __pushStub: PushStub }).__pushStub);
}

function section(page: Page) {
  return page.getByRole("region", { name: "התראות במכשיר זה" });
}

async function gotoSettings(page: Page) {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("הגדרות");
}

async function expectState(page: Page, label: string) {
  await expect(section(page).getByTestId("push-state")).toHaveText(label);
}

async function savedRow(endpoint: string) {
  const { data } = await createServiceRoleClient()
    .from("push_subscriptions")
    .select("user_id, p256dh, auth, user_agent")
    .eq("endpoint", endpoint)
    .maybeSingle();
  return data as {
    user_id: string;
    p256dh: string;
    auth: string;
    user_agent: string | null;
  } | null;
}

async function mockCalls(endpoint: string) {
  const response = await fetch(`${PUSH_MOCK_URL}/calls?endpoint=${encodeURIComponent(endpoint)}`);
  return (await response.json()) as {
    authorization: string | null;
    apikey: boolean;
    body: unknown;
  }[];
}

test_.describe("M7.2-7: this device's push state on the settings screen", () => {
  test_.beforeEach(async ({ signIn }) => {
    await signIn({ role: "owner" });
  });

  test_("M7.2-7: a browser without push shows לא נתמך and no button", async ({ page }) => {
    await stubPush(page, { supported: false });
    await gotoSettings(page);
    await expectState(page, "לא נתמך");
    await expect(section(page)).toContainText("הדפדפן הזה לא תומך בהתראות.");
    await expect(section(page).getByRole("button")).toHaveCount(0);
  });

  test_(
    "M7.2-7: notifications blocked in the browser show חסום בדפדפן with how to allow",
    async ({ page }) => {
      await stubPush(page, { permission: "denied" });
      await gotoSettings(page);
      await expectState(page, "חסום בדפדפן");
      await expect(section(page)).toContainText("הגדרות אתרים ← התראות");
      await expect(
        section(page).getByRole("button", { name: "הפעל התראות במכשיר זה" }),
      ).toHaveCount(0);
    },
  );

  test_(
    "M7.2-7 / NOTIF-5: permission is asked only on the click; turning on saves the subscription",
    async ({ page, signIn }) => {
      const account = await signIn({ role: "owner" });
      await stubPush(page);
      await gotoSettings(page);
      await expectState(page, "כבוי");
      expect((await readStub(page)).requests).toBe(0);
      const enable = section(page).getByRole("button", { name: "הפעל התראות במכשיר זה" });
      const box = await enable.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
      await enable.click();
      await expectState(page, "פעיל");
      await expect(section(page).getByRole("status")).toHaveText("ההתראות הופעלו במכשיר הזה.");
      await expect(section(page).getByRole("paragraph").filter({ hasText: "מצב:" })).toBeFocused();
      const stub = await readStub(page);
      expect(stub.requests).toBe(1);
      const row = await savedRow(stub.endpoint ?? "");
      expect(row).toMatchObject({ user_id: account.id, auth: "AQcHBwcHBwcHBwcHBwcHBw" });
      expect(row?.p256dh).toMatch(/^BA/);
      expect(row?.user_agent).toBeTruthy();
    },
  );

  test_(
    "M7.2-7: a dismissed prompt keeps it off; a refused one shows blocked",
    async ({ page }) => {
      await stubPush(page, { answer: "default" });
      await gotoSettings(page);
      await section(page).getByRole("button", { name: "הפעל התראות במכשיר זה" }).click();
      await expect(section(page).getByRole("status")).toHaveText(
        "לא ניתנה הרשאה להתראות. אפשר לנסות שוב.",
      );
      await expectState(page, "כבוי");

      const other = await page.context().newPage();
      await stubPush(other, { answer: "denied" });
      await gotoSettings(other);
      await section(other).getByRole("button", { name: "הפעל התראות במכשיר זה" }).click();
      await expectState(other, "חסום בדפדפן");
      await expect(section(other).getByRole("status")).toHaveText(
        "הדפדפן חסם את ההתראות במכשיר הזה.",
      );
    },
  );

  test_(
    "M7.2-7 / NOTIF-14: the test push goes to the function with the user's token",
    async ({ page }) => {
      await stubPush(page);
      await gotoSettings(page);
      await section(page).getByRole("button", { name: "הפעל התראות במכשיר זה" }).click();
      await expectState(page, "פעיל");
      await section(page).getByRole("button", { name: "שלח התראת בדיקה" }).click();
      await expect(section(page).getByRole("status")).toHaveText(
        "התראת הבדיקה נשלחה. היא אמורה להופיע תוך דקה.",
      );
      const endpoint = (await readStub(page)).endpoint ?? "";
      const calls = await mockCalls(endpoint);
      expect(calls).toHaveLength(1);
      expect(calls[0].body).toEqual({ kind: "test", endpoint });
      expect(calls[0].authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
      expect(calls[0].apikey).toBe(true);
    },
  );

  test_(
    "M7.2-7: a test push to a subscription the push service dropped turns it off",
    async ({ page }) => {
      await stubPush(page, { endpointKind: "gone" });
      await gotoSettings(page);
      await section(page).getByRole("button", { name: "הפעל התראות במכשיר זה" }).click();
      await expectState(page, "פעיל");
      await section(page).getByRole("button", { name: "שלח התראת בדיקה" }).click();
      await expect(section(page).getByRole("status")).toHaveText(
        "המכשיר הזה כבר לא רשום לקבלת התראות. אפשר להפעיל אותן מחדש.",
      );
      await expectState(page, "כבוי");
      expect((await readStub(page)).unsubscribed).toBe(1);
    },
  );

  test_("M7.2-7: an environment without the push function set up says so", async ({ page }) => {
    await stubPush(page, { endpointKind: "notconfigured" });
    await gotoSettings(page);
    await section(page).getByRole("button", { name: "הפעל התראות במכשיר זה" }).click();
    await section(page).getByRole("button", { name: "שלח התראת בדיקה" }).click();
    await expect(section(page).getByRole("status")).toHaveText(
      "שליחת התראות עדיין לא הוגדרה בשרת.",
    );
    await expectState(page, "פעיל");
  });

  test_(
    "M7.2-7: turning off ends the browser subscription and deletes the saved one",
    async ({ page }) => {
      await stubPush(page);
      await gotoSettings(page);
      await section(page).getByRole("button", { name: "הפעל התראות במכשיר זה" }).click();
      await expectState(page, "פעיל");
      const endpoint = (await readStub(page)).endpoint ?? "";
      expect(await savedRow(endpoint)).not.toBeNull();
      await section(page).getByRole("button", { name: "כבה התראות במכשיר זה" }).click();
      await expectState(page, "כבוי");
      await expect(section(page).getByRole("status")).toHaveText("ההתראות כובו במכשיר הזה.");
      await expect.poll(() => savedRow(endpoint)).toBeNull();
    },
  );

  test_(
    "M7.2-7: an existing browser subscription shows פעיל and is saved again on load",
    async ({ page }) => {
      await stubPush(page, { permission: "granted", subscribed: true });
      await gotoSettings(page);
      await expectState(page, "פעיל");
      const endpoint = (await readStub(page)).endpoint ?? "";
      await expect.poll(() => savedRow(endpoint)).not.toBeNull();
    },
  );

  test_(
    "M7.2-7: a failed save leaves it off and drops the browser subscription",
    async ({ page }) => {
      await stubPush(page);
      await gotoSettings(page);
      await page.route("**/settings", async (route) => {
        if (route.request().method() === "POST") {
          await route.abort("internetdisconnected");
          return;
        }
        await route.continue();
      });
      await section(page).getByRole("button", { name: "הפעל התראות במכשיר זה" }).click();
      await expect(section(page).getByRole("status")).toHaveText(
        "הפעולה לא בוצעה. בדקו את החיבור ונסו שוב.",
      );
      await expectState(page, "כבוי");
      expect((await readStub(page)).unsubscribed).toBe(1);
    },
  );

  test_(
    "M7.2-13: the section fits every viewport without horizontal scroll",
    async ({ page }, testInfo) => {
      await stubPush(page, { permission: "granted", subscribed: true });
      for (const width of VIEWPORT_WIDTHS_BY_PROJECT[testInfo.project.name] ?? []) {
        await page.setViewportSize({ width, height: 800 });
        await gotoSettings(page);
        await expectState(page, "פעיל");
        expect(await hasHorizontalScroll(page), `${width}px`).toBe(false);
      }
    },
  );
});

test_.describe("M7.2-8: the install suggestion", () => {
  test_.beforeEach(async ({ signIn }) => {
    await signIn({ role: "owner" });
  });

  test_(
    "M7.2-8: in a browser tab it suggests installing; Chrome's offer opens its dialog",
    async ({ page }) => {
      await stubPush(page);
      await gotoSettings(page);
      await expect(section(page).getByRole("heading", { name: "התקנת האפליקציה" })).toBeVisible();
      await expect(section(page)).toContainText("ההתקנה לא נדרשת כדי לקבל התראות.");
      await expect(section(page)).toContainText("התקנת אפליקציה");
      await page.evaluate(() => {
        const event = new Event("beforeinstallprompt") as Event & {
          prompt: () => Promise<void>;
          userChoice: Promise<{ outcome: string }>;
        };
        event.prompt = async () => {
          (window as unknown as { __prompted: boolean }).__prompted = true;
        };
        event.userChoice = Promise.resolve({ outcome: "accepted" });
        window.dispatchEvent(event);
      });
      const install = section(page).getByRole("button", { name: "התקנת האפליקציה" });
      await install.click();
      await expect
        .poll(() => page.evaluate(() => (window as unknown as { __prompted?: boolean }).__prompted))
        .toBe(true);
      await expect(install).toHaveCount(0);
    },
  );

  test_("M7.2-8: running as the installed app shows no suggestion", async ({ page }) => {
    await stubPush(page);
    await page.addInitScript(() => {
      const original = window.matchMedia.bind(window);
      window.matchMedia = (query: string) =>
        query === "(display-mode: standalone)"
          ? ({
              ...original(query),
              matches: true,
              addEventListener: () => undefined,
              removeEventListener: () => undefined,
            } as MediaQueryList)
          : original(query);
    });
    await gotoSettings(page);
    await expectState(page, "כבוי");
    await expect(section(page).getByRole("heading", { name: "התקנת האפליקציה" })).toHaveCount(0);
  });
});
