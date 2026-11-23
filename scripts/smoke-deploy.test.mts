import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import {
  cspBlocksHostScripts,
  hasRequiredRobotsDirectives,
  isHostInjectedScript,
  parseBaseUrl,
  robotsTxtDisallowsAll,
  runSmokeChecks,
  scriptNonceFromCsp,
  scriptTagsWithoutNonce,
  type CheckResult,
} from "./smoke-deploy.mjs";

/** A stand-in for the deployed app; each test overrides the behaviour it breaks. */
type SiteBehaviour = {
  robotsTxt: string;
  robotsTag: string | null;
  redirectHome: boolean;
  redirectPrefetch: boolean;
  /** Redirects come from the proxy (with a CSP header) rather than from a page guard. */
  proxyRedirect: boolean;
  loginStatus: number;
  cspNonce: (requestNumber: number) => string | null;
  scriptNonce: (requestNumber: number) => string | null;
  /** script-src sources of the /login CSP for a given nonce. */
  scriptSources: (nonce: string) => string;
  /** Extra markup in the /login head, e.g. a script the host injects. */
  extraHeadHtml: string;
};

const NETLIFY_HUD_SCRIPT =
  '<script async src="/.netlify/scripts/hud?variant=public" data-nf-variant="public"></script>';

const HEALTHY: SiteBehaviour = {
  robotsTxt: "User-Agent: *\nDisallow: /\n",
  robotsTag: "noindex, nofollow",
  redirectHome: true,
  redirectPrefetch: true,
  proxyRedirect: true,
  loginStatus: 200,
  cspNonce: (n) => `nonce${n}`,
  scriptNonce: (n) => `nonce${n}`,
  scriptSources: (nonce) => `'self' 'nonce-${nonce}' 'strict-dynamic'`,
  extraHeadHtml: "",
};

let server: Server | undefined;

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

async function startSite(overrides: Partial<SiteBehaviour> = {}): Promise<URL> {
  const site = { ...HEALTHY, ...overrides };
  let loginRequests = 0;
  server = createServer((request: IncomingMessage, response: ServerResponse) => {
    if (site.robotsTag) {
      response.setHeader("X-Robots-Tag", site.robotsTag);
    }
    const isPrefetch = Boolean(
      request.headers["purpose"] || request.headers["next-router-prefetch"],
    );
    if (request.url === "/robots.txt") {
      response.end(site.robotsTxt);
    } else if (request.url === "/" && (isPrefetch ? site.redirectPrefetch : site.redirectHome)) {
      const proxyHeaders = site.proxyRedirect
        ? { "Content-Security-Policy": "script-src 'self' 'nonce-redirect'" }
        : {};
      response.writeHead(307, { Location: "/login", ...proxyHeaders }).end();
    } else if (request.url === "/") {
      response.end("<html><body><h1>דף הבית</h1></body></html>");
    } else if (request.url === "/login") {
      loginRequests += 1;
      const cspNonce = site.cspNonce(loginRequests);
      const scriptNonce = site.scriptNonce(loginRequests);
      if (cspNonce) {
        response.setHeader(
          "Content-Security-Policy",
          `default-src 'self'; script-src ${site.scriptSources(cspNonce)}; style-src 'self' 'nonce-${cspNonce}';`,
        );
      }
      const nonceAttribute = scriptNonce ? ` nonce="${scriptNonce}"` : "";
      response
        .writeHead(site.loginStatus, { "Content-Type": "text/html" })
        .end(
          `<html><head><script src="/a.js"${nonceAttribute} async></script>${site.extraHeadHtml}</head>` +
            `<body><script${nonceAttribute}>self.x=1</script></body></html>`,
        );
    } else {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return new URL(`http://127.0.0.1:${(server!.address() as AddressInfo).port}`);
}

function failures(results: CheckResult[]): string[] {
  return results.filter((result) => !result.ok).map((result) => result.name);
}

describe("M0.6-4: post-deploy smoke checks", () => {
  it("M0.6-4: passes every check against a healthy site", async () => {
    const results = await runSmokeChecks(await startSite());

    expect(failures(results)).toEqual([]);
    expect(results).toHaveLength(7);
  });

  it("M0.6-4: fails when / is served without a session (proxy not running)", async () => {
    const results = await runSmokeChecks(
      await startSite({ redirectHome: false, redirectPrefetch: false }),
    );

    expect(failures(results)).toEqual([
      "/ without a session is redirected to /login by the proxy",
      "/ with purpose: prefetch gets no page content",
      "/ with next-router-prefetch: 1 gets no page content",
      "/ with next-router-prefetch with an RSC request gets no page content",
    ]);
  });

  it("M0.6-4: fails when the redirect comes from a page guard, not the proxy", async () => {
    const results = await runSmokeChecks(await startSite({ proxyRedirect: false }));

    expect(failures(results)).toHaveLength(4);
    expect(results.find((r) => !r.ok)?.detail).toBe(
      "the redirect has no nonce CSP header, so it did not come from the proxy",
    );
  });

  it("M0.6-4: fails when only prefetch requests bypass the redirect", async () => {
    const results = await runSmokeChecks(await startSite({ redirectPrefetch: false }));

    expect(failures(results)).toHaveLength(3);
    expect(results.find((r) => r.name.includes("purpose: prefetch"))?.detail).toBe(
      "expected a redirect to /login, got 200",
    );
  });

  it("M0.6-4: fails when robots.txt allows crawling", async () => {
    const results = await runSmokeChecks(
      await startSite({ robotsTxt: "User-Agent: *\nAllow: /\n" }),
    );

    expect(failures(results)).toEqual(["/robots.txt disallows all"]);
  });

  it("M0.6-4: fails when X-Robots-Tag is missing", async () => {
    const results = await runSmokeChecks(await startSite({ robotsTag: null }));

    expect(failures(results)).toEqual([
      "X-Robots-Tag: noindex, nofollow on every checked response",
    ]);
    expect(results.at(-1)?.detail).toContain("GET /robots.txt");
  });

  it("M0.6-4: fails when /login has no CSP header", async () => {
    const results = await runSmokeChecks(await startSite({ cspNonce: () => null }));

    expect(failures(results)).toEqual(["/login returns 200 with a nonce CSP matching its scripts"]);
  });

  it("M0.6-4: fails when page scripts do not carry the CSP nonce", async () => {
    const results = await runSmokeChecks(await startSite({ scriptNonce: () => "other" }));

    expect(results.find((r) => !r.ok)?.detail).toMatch(/2 of 2 <script> tags lack the CSP nonce/);
  });

  it("M0.6-4: warns about, but passes, a Netlify host script the CSP blocks", async () => {
    const results = await runSmokeChecks(await startSite({ extraHeadHtml: NETLIFY_HUD_SCRIPT }));

    expect(failures(results)).toEqual([]);
    const login = results.find((r) => r.name.startsWith("/login"));
    expect(login?.warnings).toHaveLength(1);
    expect(login?.warnings[0]).toContain("/.netlify/scripts/hud?variant=public");
  });

  it("M0.6-4: still fails on another script without the nonce next to the host script", async () => {
    const results = await runSmokeChecks(
      await startSite({ extraHeadHtml: `${NETLIFY_HUD_SCRIPT}<script src="/evil.js"></script>` }),
    );

    expect(results.find((r) => !r.ok)?.detail).toMatch(
      /1 of 4 <script> tags lack the CSP nonce, e\.g\. <script src="\/evil\.js">/,
    );
  });

  it("M0.6-4: fails on a host script when the CSP lacks 'strict-dynamic'", async () => {
    const results = await runSmokeChecks(
      await startSite({
        extraHeadHtml: NETLIFY_HUD_SCRIPT,
        scriptSources: (nonce) => `'self' 'nonce-${nonce}'`,
      }),
    );

    expect(results.find((r) => !r.ok)?.detail).toMatch(/CSP may allow a host-injected script/);
  });

  it("M0.6-4: fails on a host script when the CSP names a Netlify source", async () => {
    const results = await runSmokeChecks(
      await startSite({
        extraHeadHtml: NETLIFY_HUD_SCRIPT,
        scriptSources: (nonce) => `'nonce-${nonce}' 'strict-dynamic' https://x.netlify.app`,
      }),
    );

    expect(results.find((r) => !r.ok)?.detail).toMatch(/CSP may allow a host-injected script/);
  });

  it("M0.6-4: fails when the nonce repeats across requests (cached page)", async () => {
    const results = await runSmokeChecks(
      await startSite({ cspNonce: () => "fixed", scriptNonce: () => "fixed" }),
    );

    expect(results.find((r) => !r.ok)?.detail).toMatch(/same nonce/);
  });

  it("M0.6-4: fails when /login does not return 200", async () => {
    const results = await runSmokeChecks(await startSite({ loginStatus: 500 }));

    expect(results.find((r) => !r.ok)?.detail).toBe("expected 200, got 500");
  });

  it("M0.6-4: reports an unreachable site as failed checks instead of throwing", async () => {
    const baseUrl = await startSite();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;

    const results = await runSmokeChecks(baseUrl, { timeoutMs: 2_000 });

    expect(results.every((result) => !result.ok)).toBe(true);
    expect(results[0].detail).toMatch(/^request failed:/);
  });
});

describe("M0.6-4: smoke check helpers", () => {
  it("M0.6-4: accepts an origin and rejects anything else", () => {
    expect(parseBaseUrl("https://example.netlify.app/").origin).toBe("https://example.netlify.app");
    expect(() => parseBaseUrl(undefined)).toThrow(/required/);
    expect(() => parseBaseUrl("not a url")).toThrow(/Not a valid URL/);
    expect(() => parseBaseUrl("ftp://example.com")).toThrow(/http or https/);
    expect(() => parseBaseUrl("https://example.com/login")).toThrow(/origin only/);
    expect(() => parseBaseUrl("https://user:pw@example.com")).toThrow(/origin only/);
  });

  it("M0.6-4: robots.txt must disallow / for all agents without allow rules", () => {
    expect(robotsTxtDisallowsAll("User-agent: *\nDisallow: /")).toBe(true);
    expect(robotsTxtDisallowsAll("User-Agent : *\r\nDisallow : / # all\r\n")).toBe(true);
    expect(robotsTxtDisallowsAll("User-Agent: *\nDisallow: /private")).toBe(false);
    expect(robotsTxtDisallowsAll("User-Agent: *\nDisallow: /\nAllow: /login")).toBe(false);
    expect(robotsTxtDisallowsAll("User-Agent: bot\nDisallow: /")).toBe(false);
    expect(robotsTxtDisallowsAll("")).toBe(false);
  });

  it("M0.6-4: X-Robots-Tag needs both noindex and nofollow, in any order or repetition", () => {
    expect(hasRequiredRobotsDirectives("noindex, nofollow")).toBe(true);
    expect(hasRequiredRobotsDirectives("NoFollow,noindex, noindex")).toBe(true);
    expect(hasRequiredRobotsDirectives("noindex")).toBe(false);
    expect(hasRequiredRobotsDirectives(null)).toBe(false);
  });

  it("M0.6-4: reads exactly one script-src nonce from the CSP", () => {
    expect(scriptNonceFromCsp("default-src 'self'; script-src 'self' 'nonce-a+b/c==';")).toBe(
      "a+b/c==",
    );
    expect(scriptNonceFromCsp("style-src 'nonce-a'; script-src 'self'")).toBeUndefined();
    expect(scriptNonceFromCsp("script-src 'nonce-a' 'nonce-b'")).toBeUndefined();
    expect(scriptNonceFromCsp(null)).toBeUndefined();
  });

  it("M0.6-4: lists script tags without the nonce", () => {
    const html = '<script nonce="n">a</script><SCRIPT src="/x.js"></SCRIPT><scripts>';
    expect(scriptTagsWithoutNonce(html, "n")).toEqual(['<SCRIPT src="/x.js">']);
  });

  it("M0.6-4: recognises only same-origin /.netlify/scripts/ paths as host scripts", () => {
    expect(isHostInjectedScript(NETLIFY_HUD_SCRIPT)).toBe(true);
    expect(isHostInjectedScript("<script src='/.netlify/scripts/rum'>")).toBe(true);
    expect(isHostInjectedScript("<SCRIPT async SRC=/.netlify/scripts/hud>")).toBe(true);

    expect(isHostInjectedScript('<script src="//evil/.netlify/scripts/hud">')).toBe(false);
    expect(isHostInjectedScript('<script src="https://x/.netlify/scripts/hud">')).toBe(false);
    expect(isHostInjectedScript('<script src="/.netlify/scriptsX/hud">')).toBe(false);
    expect(isHostInjectedScript('<script src="/.netlify/scripts">')).toBe(false);
    expect(isHostInjectedScript('<script src="/app/.netlify/scripts/hud">')).toBe(false);
    expect(isHostInjectedScript("<script>")).toBe(false);
    expect(isHostInjectedScript('<script data-src="/.netlify/scripts/hud">')).toBe(false);
    expect(isHostInjectedScript('<script data-x="/.netlify/scripts/" src="/a.js">')).toBe(false);
  });

  it("M0.6-4: the CSP blocks host scripts only with 'strict-dynamic' and no Netlify source", () => {
    expect(cspBlocksHostScripts("script-src 'self' 'nonce-a' 'strict-dynamic'")).toBe(true);
    expect(cspBlocksHostScripts("script-src 'self' 'nonce-a'")).toBe(false);
    expect(cspBlocksHostScripts("script-src 'nonce-a' 'strict-dynamic' *.netlify.app")).toBe(false);
    expect(cspBlocksHostScripts("default-src 'strict-dynamic'; script-src 'nonce-a'")).toBe(false);
    expect(cspBlocksHostScripts(null)).toBe(false);
  });
});
