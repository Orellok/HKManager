import { expect, type Page, type Route } from "@playwright/test";

/** Viewport widths checked per Playwright project (profile: 360, 412 Android; 1280 desktop). */
export const VIEWPORT_WIDTHS_BY_PROJECT: Record<string, number[]> = {
  android: [360, 412],
  desktop: [1280],
};

export const MIN_TOUCH_TARGET = 44;

/**
 * A console warning or error from the app. Excludes the message Playwright itself logs when it
 * blocks the service worker registration (serviceWorkers: "block" in playwright.config.ts).
 */
export function isAppConsoleProblem(type: string, text: string): boolean {
  return (
    (type === "warning" || type === "error") &&
    text !== "Service Worker registration blocked by Playwright"
  );
}

/**
 * Records CSP violations from the first byte of every navigation, through the
 * securitypolicyviolation event (as shell.spec.ts does) and console errors.
 */
export async function trackCspViolations(page: Page): Promise<string[]> {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("Content Security Policy")) {
      violations.push(message.text());
    }
  });
  await page.exposeFunction("__reportCspViolation", (violation: string) => {
    violations.push(violation);
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      const report = (window as unknown as { __reportCspViolation: (v: string) => void })
        .__reportCspViolation;
      report(`${event.violatedDirective}: ${event.blockedURI} (${event.sourceFile})`);
    });
  });
  return violations;
}

export type FailureMode = "abort" | "500";

/**
 * Makes every Server Action request fail (a lost connection or a server error) until the
 * returned function is called. Server Actions are POSTs carrying a Next-Action header.
 */
export async function failServerActions(
  page: Page,
  mode: FailureMode,
): Promise<() => Promise<void>> {
  const pattern = "**/*";
  const handler = async (route: Route) => {
    const request = route.request();
    if (request.method() === "POST" && request.headers()["next-action"]) {
      if (mode === "abort") {
        await route.abort("internetdisconnected");
      } else {
        await route.fulfill({ status: 500, contentType: "text/plain", body: "error" });
      }
      return;
    }
    await route.continue();
  };
  await page.route(pattern, handler);
  return () => page.unroute(pattern, handler);
}

export function activeElementText(page: Page) {
  return page.evaluate(() => {
    const element = document.activeElement;
    return element ? `${element.tagName}:${(element.textContent ?? "").trim()}` : "none";
  });
}

/** Whether the page scrolls sideways at its current viewport. */
export async function hasHorizontalScroll(page: Page): Promise<boolean> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  return scrollWidth > clientWidth;
}

/**
 * Clicks the button three times in one task, as a fast double/triple click or a script
 * would: React has not re-rendered in between, so only a synchronous guard stops the
 * second and third submit.
 */
export function clickThreeTimesSynchronously(page: Page, buttonName: string) {
  return page.evaluate((name) => {
    const button = [...document.querySelectorAll("button")].find(
      (candidate) => (candidate.textContent ?? "").trim() === name,
    );
    if (!button) {
      throw new Error(`No button named ${name}`);
    }
    button.click();
    button.click();
    button.click();
  }, buttonName);
}

/** Owner decision (M3): on mobile these items sit behind "עוד" in the bottom bar. */
const MORE_NAV_LABELS = ["משימות", "יומן", "חובות", "הוצאות", "ייצוא", "הגדרות"];
/** Tailwind's md breakpoint: from here the side navigation shows every item. */
const DESKTOP_MIN_WIDTH = 768;

/**
 * A navigation link by its label. "משימות" carries the NOTIF-1 badge in its name
 * ("משימות, 3 לטיפול"), and other tests change the count, so the suffix is allowed.
 */
export function navLinkName(label: string): RegExp {
  return new RegExp(`^${label}(, .*)?$`);
}

function mainNav(page: Page) {
  return page.getByRole("navigation", { name: "ניווט ראשי" });
}

function isBehindMore(page: Page, label: string): boolean {
  return MORE_NAV_LABELS.includes(label) && (page.viewportSize()?.width ?? 0) < DESKTOP_MIN_WIDTH;
}

/**
 * Opens a screen from the main navigation. On mobile, an item behind "עוד" is reached by
 * opening it first (retried until the page is interactive: before hydration the button does
 * nothing).
 */
export async function clickNavItem(page: Page, label: string) {
  const nav = mainNav(page);
  const link = nav.getByRole("link", { name: navLinkName(label) });
  if (isBehindMore(page, label)) {
    await expect(async () => {
      if (!(await link.isVisible())) {
        await nav.getByRole("button", { name: "עוד" }).click();
      }
      await expect(link).toBeVisible({ timeout: 1000 });
    }).toPass();
  }
  await link.click();
}

/**
 * Asserts the main navigation marks `label` as the current screen: its link (aria-current
 * "page"), or on mobile for an item behind "עוד", the "עוד" button (aria-current "true").
 */
export async function expectNavCurrent(page: Page, label: string) {
  const nav = mainNav(page);
  if (isBehindMore(page, label)) {
    await expect(nav.getByRole("button", { name: "עוד" })).toHaveAttribute("aria-current", "true");
  } else {
    await expect(nav.getByRole("link", { name: navLinkName(label) })).toHaveAttribute(
      "aria-current",
      "page",
    );
  }
}
