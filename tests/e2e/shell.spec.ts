import { expect, test, type APIResponse, type Page } from "@playwright/test";

const MISSING_PATH = "/this-page-does-not-exist";

const VIEWPORT_WIDTHS_BY_PROJECT: Record<string, number[]> = {
  android: [360, 412],
  desktop: [1280],
};

function extractNonce(contentSecurityPolicy: string): string {
  const match = contentSecurityPolicy.match(/'nonce-([^']+)'/);
  if (!match) {
    throw new Error(`No nonce in Content-Security-Policy: ${contentSecurityPolicy}`);
  }
  return match[1];
}

function expectSecurityHeaders(response: APIResponse) {
  const headers = response.headers();
  const csp = headers["content-security-policy"];

  expect(csp).toBeDefined();
  expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).not.toContain("'unsafe-inline'");
  expect(csp).not.toContain("'unsafe-eval'");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["permissions-policy"]).toContain("camera=()");
}

/** Records CSP violations from the very first byte of every navigation on this page. */
async function trackCspViolations(page: Page): Promise<string[]> {
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
      report(`${event.violatedDirective}: ${event.blockedURI}`);
    });
  });
  return violations;
}

test.describe("M0.1-4: RTL shell", () => {
  test("M0.1-4: html is Hebrew and right-to-left", async ({ page }) => {
    await page.goto("/");

    const html = page.locator("html");
    await expect(html).toHaveAttribute("lang", "he");
    await expect(html).toHaveAttribute("dir", "rtl");
  });

  test("M0.1-4: body uses the Hebrew-capable Heebo font", async ({ page }) => {
    await page.goto("/");

    const fontFamily = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    expect(fontFamily).toContain("Heebo");
    const heeboLoaded = await page.evaluate(async () => {
      await document.fonts.ready;
      return [...document.fonts].some(
        (font) => font.family.includes("Heebo") && font.status === "loaded",
      );
    });
    expect(heeboLoaded).toBe(true);
  });

  test("M0.1-4: header shows HKManager, main landmark exists, no navigation", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("banner")).toHaveText("HKManager");
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("navigation")).toHaveCount(0);
  });

  test("M0.1-4: no horizontal page scroll at the supported widths", async ({ page }, testInfo) => {
    const widths = VIEWPORT_WIDTHS_BY_PROJECT[testInfo.project.name];
    expect(widths, `no widths configured for project ${testInfo.project.name}`).toBeDefined();

    for (const width of widths) {
      for (const path of ["/", MISSING_PATH]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(path);

        const { scrollWidth, clientWidth } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(scrollWidth, `horizontal scroll at ${width}px on ${path}`).toBeLessThanOrEqual(
          clientWidth,
        );
      }
    }
  });
});

test.describe("M0.1-5: indexing blocked", () => {
  test("M0.1-5: X-Robots-Tag on the home page", async ({ request }) => {
    const response = await request.get("/");

    expect(response.status()).toBe(200);
    expect(response.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  });

  test("M0.1-5: X-Robots-Tag on a 404 response", async ({ request }) => {
    const response = await request.get(MISSING_PATH);

    expect(response.status()).toBe(404);
    expect(response.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  });

  test("M0.1-5: X-Robots-Tag on robots.txt and static assets", async ({ request }) => {
    const robots = await request.get("/robots.txt");
    expect(robots.headers()["x-robots-tag"]).toBe("noindex, nofollow");

    const favicon = await request.get("/favicon.ico");
    expect(favicon.status()).toBe(200);
    expect(favicon.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  });

  test("M0.1-5: robots.txt disallows everything for all agents", async ({ request }) => {
    const response = await request.get("/robots.txt");

    expect(response.status()).toBe(200);
    const lines = (await response.text()).split("\n").map((line) => line.trim());
    expect(lines).toContain("User-Agent: *");
    expect(lines).toContain("Disallow: /");
    expect(lines.some((line) => line.startsWith("Allow:"))).toBe(false);
  });

  test("M0.1-5: meta robots noindex, nofollow and title HKManager only", async ({ page }) => {
    for (const path of ["/", MISSING_PATH]) {
      await page.goto(path);

      // Next.js adds its own `noindex` meta on 404 pages, so there may be more than one tag.
      const robotsContents = await page
        .locator('meta[name="robots"]')
        .evaluateAll((tags) => tags.map((tag) => tag.getAttribute("content")));
      expect(robotsContents, `meta robots on ${path}`).toContain("noindex, nofollow");
      for (const content of robotsContents) {
        expect(content).toContain("noindex");
      }
      await expect(page).toHaveTitle("HKManager");
      await expect(page.locator('meta[name="description"]')).toHaveCount(0);
    }
  });
});

test.describe("M0.1-6: security headers", () => {
  test("M0.1-6: home page carries CSP and security headers", async ({ request }) => {
    expectSecurityHeaders(await request.get("/"));
  });

  test("M0.1-6: 404 response carries CSP and security headers", async ({ request }) => {
    const response = await request.get(MISSING_PATH);

    expect(response.status()).toBe(404);
    expectSecurityHeaders(response);
  });

  test("M0.1-6: CSP nonce is different on every request", async ({ request }) => {
    const first = extractNonce((await request.get("/")).headers()["content-security-policy"]);
    const second = extractNonce((await request.get("/")).headers()["content-security-policy"]);

    expect(first).not.toBe(second);
  });

  test("M0.1-6: page scripts carry the request nonce and run without CSP violations", async ({
    page,
  }) => {
    const violations = await trackCspViolations(page);

    for (const path of ["/", MISSING_PATH]) {
      const response = await page.goto(path, { waitUntil: "networkidle" });
      expect(response).not.toBeNull();
      const nonce = extractNonce(response!.headers()["content-security-policy"]);

      expect(violations, `CSP violations on ${path}`).toEqual([]);

      const scriptNonces = await page.evaluate(() =>
        [...document.querySelectorAll("script")].map((script) => script.nonce),
      );
      expect(scriptNonces.length).toBeGreaterThan(0);
      for (const scriptNonce of scriptNonces) {
        expect(scriptNonce).toBe(nonce);
      }
    }
  });
});
