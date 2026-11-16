import type { Page, Route } from "@playwright/test";

/** Viewport widths checked per Playwright project (profile: 360, 412 Android; 1280 desktop). */
export const VIEWPORT_WIDTHS_BY_PROJECT: Record<string, number[]> = {
  android: [360, 412],
  desktop: [1280],
};

export const MIN_TOUCH_TARGET = 44;

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
