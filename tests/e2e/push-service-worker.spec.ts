import { expect, test_ } from "./support/data-fixtures";

/**
 * M7.2-10: the app's real service worker receives a push from Chrome's own push delivery
 * (DevTools protocol) and shows it. The headless shell has no notification permission, so
 * this file runs on full Chromium (new headless mode).
 */
test_.use({ serviceWorkers: "allow", channel: "chromium" });

test_.describe("M7.2-10: the real service worker shows a pushed notification", () => {
  test_(
    "M7.2-10: a push delivered by Chrome is shown with the payload's text",
    async ({ page, context, browserName }) => {
      test_.skip(browserName !== "chromium", "DevTools push delivery is Chromium-only");
      await context.grantPermissions(["notifications"]);
      await page.goto("/login");
      await page.evaluate(() => navigator.serviceWorker.ready);
      const cdp = await context.newCDPSession(page);
      const registrationId = new Promise<string>((resolve) => {
        cdp.on("ServiceWorker.workerRegistrationUpdated", ({ registrations }) => {
          const match = registrations.find(
            (registration: { scopeURL: string; isDeleted: boolean }) =>
              registration.scopeURL.endsWith("/") && !registration.isDeleted,
          );
          if (match) {
            resolve(match.registrationId);
          }
        });
      });
      await cdp.send("ServiceWorker.enable");
      const origin = new URL(page.url()).origin;
      await cdp.send("ServiceWorker.deliverPushMessage", {
        origin,
        registrationId: await registrationId,
        data: JSON.stringify({
          title: "HKManager",
          body: "2 משימות להיום · 1 למחר",
          url: "https://evil.example/",
          tag: "hkmanager-daily",
        }),
      });
      await expect
        .poll(() =>
          page.evaluate(async () => {
            const registration = await navigator.serviceWorker.ready;
            return (await registration.getNotifications()).map((notification) => ({
              title: notification.title,
              body: notification.body,
              tag: notification.tag,
              dir: notification.dir,
              lang: notification.lang,
              url: (notification.data as { url: string }).url,
            }));
          }),
        )
        .toEqual([
          {
            title: "HKManager",
            body: "2 משימות להיום · 1 למחר",
            tag: "hkmanager-daily",
            dir: "rtl",
            lang: "he",
            url: "/tasks",
          },
        ]);
    },
  );
});
