/**
 * Post-deploy smoke check (M0.6, VERIFY-02 gate). Checks a deployed site from the outside, as an
 * anonymous visitor:
 * - /robots.txt disallows everything;
 * - every checked response carries `X-Robots-Tag: noindex, nofollow`;
 * - / without a session is redirected to /login by src/proxy.ts (proves the proxy runs on the
 *   host: its redirects carry the nonce CSP header, the page guards' redirects do not);
 * - /login returns 200 with a nonce-based CSP that matches the nonces of the page's scripts,
 *   with a new nonce on every request;
 * - prefetch-style requests to / get a redirect, not page content.
 *
 * Usage: node scripts/smoke-deploy.mts <base URL>   (exit 0: all passed, 1: a check failed,
 * 2: bad usage). It sends no credentials and prints no header values other than those checked.
 */
import { pathToFileURL } from "node:url";

const LOGIN_PATH = "/login";
const HOME_PATH = "/";
const ROBOTS_PATH = "/robots.txt";
/** The home page heading; it must never reach a visitor without a session. */
const HOME_PAGE_MARKER = "דף הבית";
const REQUIRED_ROBOTS_DIRECTIVES = ["noindex", "nofollow"] as const;
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_DETAIL_LENGTH = 200;

/** Header sets Next.js (or a forged client) sends for prefetches; see tests/e2e/auth.spec.ts. */
const PREFETCH_HEADER_SETS: readonly (readonly [label: string, headers: Record<string, string>])[] =
  [
    ["purpose: prefetch", { purpose: "prefetch" }],
    ["next-router-prefetch: 1", { "next-router-prefetch": "1" }],
    ["next-router-prefetch with an RSC request", { "next-router-prefetch": "1", rsc: "1" }],
  ];

export type CheckResult = { name: string; ok: boolean; detail: string };

export type SmokeOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

type FetchedPage = { label: string; status: number; headers: Headers; body: string };

/** The origin of an http(s) base URL. Anything with a path, query or credentials is refused. */
export function parseBaseUrl(input: string | undefined): URL {
  if (!input) {
    throw new Error("A base URL is required, for example https://example.netlify.app");
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch (error) {
    throw new Error(`Not a valid URL: ${input}`, { cause: error });
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`The base URL must use http or https: ${input}`);
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(
      `The base URL must be an origin only (no path, query or credentials): ${input}`,
    );
  }
  return new URL(url.origin);
}

function truncate(text: string): string {
  return text.length > MAX_DETAIL_LENGTH ? `${text.slice(0, MAX_DETAIL_LENGTH)}…` : text;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A fresh request every time: no cookies, no cached copy, no automatic redirects. */
async function fetchPage(
  baseUrl: URL,
  path: string,
  label: string,
  headers: Record<string, string>,
  { fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS }: SmokeOptions,
): Promise<FetchedPage> {
  const response = await fetchImpl(new URL(path, baseUrl), {
    headers: { "cache-control": "no-cache", ...headers },
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { label, status: response.status, headers: response.headers, body: await response.text() };
}

function redirectTarget(page: FetchedPage, baseUrl: URL): string | undefined {
  if (!REDIRECT_STATUSES.has(page.status)) {
    return undefined;
  }
  const location = page.headers.get("location");
  if (!location) {
    return undefined;
  }
  const target = new URL(location, baseUrl);
  return target.origin === baseUrl.origin ? target.pathname : `${target.origin}${target.pathname}`;
}

function describeResponse(page: FetchedPage, baseUrl: URL): string {
  const target = redirectTarget(page, baseUrl);
  return target ? `${page.status} to ${target}` : `${page.status}`;
}

/**
 * Fails unless the response redirects to /login on the same origin, carries no page, and was
 * made by src/proxy.ts. The page guards redirect too, so the redirect alone does not prove that
 * the proxy runs; only the proxy puts a nonce CSP header on its redirects.
 */
function expectProxyLoginRedirect(page: FetchedPage, baseUrl: URL): string | undefined {
  if (redirectTarget(page, baseUrl) !== LOGIN_PATH) {
    return `expected a redirect to ${LOGIN_PATH}, got ${describeResponse(page, baseUrl)}`;
  }
  if (!scriptNonceFromCsp(page.headers.get("content-security-policy"))) {
    return "the redirect has no nonce CSP header, so it did not come from the proxy";
  }
  if (page.body.includes(HOME_PAGE_MARKER)) {
    return "the redirect response contains home page content";
  }
  return undefined;
}

export function robotsTxtDisallowsAll(body: string): boolean {
  const lines = body
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/#.*$/, "")
        .trim()
        .toLowerCase()
        .replace(/\s*:\s*/, ":"),
    )
    .filter((line) => line !== "");
  const groupStart = lines.indexOf("user-agent:*");
  if (groupStart === -1) {
    return false;
  }
  const groupRules = lines.slice(groupStart + 1);
  const nextGroup = groupRules.findIndex((line) => line.startsWith("user-agent:"));
  const rules = nextGroup === -1 ? groupRules : groupRules.slice(0, nextGroup);
  return rules.includes("disallow:/") && !rules.some((line) => line.startsWith("allow:"));
}

/** Directive names in an X-Robots-Tag value; repeated headers arrive joined by commas. */
export function hasRequiredRobotsDirectives(headerValue: string | null): boolean {
  if (!headerValue) {
    return false;
  }
  const directives = new Set(headerValue.split(",").map((part) => part.trim().toLowerCase()));
  return REQUIRED_ROBOTS_DIRECTIVES.every((directive) => directives.has(directive));
}

/** The nonce of the CSP's script-src directive, if there is exactly one. */
export function scriptNonceFromCsp(csp: string | null): string | undefined {
  if (!csp) {
    return undefined;
  }
  const scriptSrc = csp
    .split(";")
    .map((directive) => directive.trim())
    .find((directive) => directive.split(/\s+/)[0]?.toLowerCase() === "script-src");
  const nonces = [...(scriptSrc ?? "").matchAll(/'nonce-([^']+)'/g)].map((match) => match[1]);
  return nonces.length === 1 ? nonces[0] : undefined;
}

/** Opening <script> tags of an HTML document. */
export function scriptTags(html: string): string[] {
  return html.match(/<script\b[^>]*>/gi) ?? [];
}

export function scriptTagsWithoutNonce(html: string, nonce: string): string[] {
  return scriptTags(html).filter((tag) => !tag.includes(`nonce="${nonce}"`));
}

function checkLoginCsp(first: FetchedPage, second: FetchedPage): string | undefined {
  if (first.status !== 200) {
    return `expected 200, got ${first.status}`;
  }
  const nonce = scriptNonceFromCsp(first.headers.get("content-security-policy"));
  if (!nonce) {
    return "no Content-Security-Policy header with exactly one script-src nonce";
  }
  const tags = scriptTags(first.body);
  if (tags.length === 0) {
    return "the page has no <script> tags to compare with the CSP nonce";
  }
  const withoutNonce = scriptTagsWithoutNonce(first.body, nonce);
  if (withoutNonce.length > 0) {
    return `${withoutNonce.length} of ${tags.length} <script> tags lack the CSP nonce, e.g. ${truncate(withoutNonce[0])}`;
  }
  const secondNonce = scriptNonceFromCsp(second.headers.get("content-security-policy"));
  if (second.status !== 200 || !secondNonce) {
    return `a second request did not return 200 with a nonce CSP (got ${second.status})`;
  }
  if (secondNonce === nonce) {
    return "two requests got the same nonce: the page is cached or the nonce is not per request";
  }
  return undefined;
}

/** Runs every check; network errors fail the check they belong to and never throw. */
export async function runSmokeChecks(
  baseUrl: URL,
  options: SmokeOptions = {},
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const fetched: FetchedPage[] = [];

  async function check(name: string, run: () => Promise<string | undefined>): Promise<void> {
    try {
      const failure = await run();
      results.push({ name, ok: failure === undefined, detail: failure ?? "ok" });
    } catch (error) {
      results.push({ name, ok: false, detail: `request failed: ${describeError(error)}` });
    }
  }

  async function get(path: string, label: string, headers: Record<string, string> = {}) {
    const page = await fetchPage(baseUrl, path, label, headers, options);
    fetched.push(page);
    return page;
  }

  await check(`${ROBOTS_PATH} disallows all`, async () => {
    const page = await get(ROBOTS_PATH, `GET ${ROBOTS_PATH}`);
    if (page.status !== 200) {
      return `expected 200, got ${page.status}`;
    }
    return robotsTxtDisallowsAll(page.body)
      ? undefined
      : `no "User-Agent: *" group with only "Disallow: /": ${truncate(page.body)}`;
  });

  await check(
    `${HOME_PATH} without a session is redirected to ${LOGIN_PATH} by the proxy`,
    async () => expectProxyLoginRedirect(await get(HOME_PATH, `GET ${HOME_PATH}`), baseUrl),
  );

  await check(`${LOGIN_PATH} returns 200 with a nonce CSP matching its scripts`, async () => {
    const first = await get(LOGIN_PATH, `GET ${LOGIN_PATH}`);
    const second = await get(LOGIN_PATH, `GET ${LOGIN_PATH} (again)`);
    return checkLoginCsp(first, second);
  });

  for (const [label, headers] of PREFETCH_HEADER_SETS) {
    await check(`${HOME_PATH} with ${label} gets no page content`, async () =>
      expectProxyLoginRedirect(
        await get(HOME_PATH, `GET ${HOME_PATH} with ${label}`, headers),
        baseUrl,
      ),
    );
  }

  const missingRobotsTag = fetched
    .filter((page) => !hasRequiredRobotsDirectives(page.headers.get("x-robots-tag")))
    .map((page) => page.label);
  results.push({
    name: "X-Robots-Tag: noindex, nofollow on every checked response",
    ok: fetched.length > 0 && missingRobotsTag.length === 0,
    detail:
      fetched.length === 0
        ? "no response was received"
        : missingRobotsTag.length === 0
          ? `ok (${fetched.length} responses)`
          : `missing on: ${missingRobotsTag.join("; ")}`,
  });

  return results;
}

async function main(argv: readonly string[]): Promise<number> {
  let baseUrl: URL;
  try {
    baseUrl = parseBaseUrl(argv[0]);
  } catch (error) {
    console.error(`Usage: node scripts/smoke-deploy.mts <base URL>\n${describeError(error)}`);
    return 2;
  }
  console.log(`Smoke checks against ${baseUrl.origin}`);
  const results = await runSmokeChecks(baseUrl);
  for (const { name, ok, detail } of results) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `: ${detail}`}`);
  }
  const failed = results.filter((result) => !result.ok).length;
  console.log(failed === 0 ? "All smoke checks passed." : `${failed} smoke check(s) failed.`);
  return failed === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
