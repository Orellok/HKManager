/**
 * Security and indexing headers (SPEC section 8).
 *
 * Static headers are applied to every response by next.config.ts.
 * The Content-Security-Policy depends on a per-request nonce and is set by src/proxy.ts.
 */

export const NONCE_REQUEST_HEADER = "x-nonce";

export const ROBOTS_DIRECTIVE = "noindex, nofollow";

export type HeaderEntry = { key: string; value: string };

export const STATIC_SECURITY_HEADERS: readonly HeaderEntry[] = [
  { key: "X-Robots-Tag", value: ROBOTS_DIRECTIVE },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  },
];

type CspOptions = {
  nonce: string;
  /** Development needs 'unsafe-eval' (React debug stacks) and inline styles (dev overlay). */
  isDevelopment: boolean;
  /** The configured Supabase URL; the browser client may call it (connect-src). */
  supabaseUrl: string;
};

/** The origin of an http(s) URL, used as a CSP source. Throws on anything else. */
function httpOrigin(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    throw new Error("The Supabase URL for the Content-Security-Policy is not a valid URL", {
      cause: error,
    });
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("The Supabase URL for the Content-Security-Policy must use http or https");
  }
  return parsed.origin;
}

export function buildContentSecurityPolicy({
  nonce,
  isDevelopment,
  supabaseUrl,
}: CspOptions): string {
  if (nonce.trim() === "") {
    throw new Error("A non-empty nonce is required to build the Content-Security-Policy");
  }
  const supabaseOrigin = httpOrigin(supabaseUrl);

  const nonceSource = `'nonce-${nonce}'`;
  const scriptSources = ["'self'", nonceSource, "'strict-dynamic'"];
  if (isDevelopment) {
    scriptSources.push("'unsafe-eval'");
  }
  const styleSources = isDevelopment ? ["'self'", "'unsafe-inline'"] : ["'self'", nonceSource];

  const directives: [name: string, sources: string[]][] = [
    ["default-src", ["'self'"]],
    ["script-src", scriptSources],
    ["style-src", styleSources],
    ["img-src", ["'self'", "blob:", "data:"]],
    ["font-src", ["'self'"]],
    ["connect-src", ["'self'", supabaseOrigin]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
    ["upgrade-insecure-requests", []],
  ];

  return directives
    .map(([name, sources]) => [name, ...sources].join(" "))
    .join("; ")
    .concat(";");
}

/** 128 bits of randomness from the Web Crypto API, base64 encoded. */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
