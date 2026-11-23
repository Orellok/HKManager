import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { STATIC_SECURITY_HEADERS } from "./security-headers";

const NETLIFY_TOML = readFileSync(
  fileURLToPath(new URL("../../netlify.toml", import.meta.url)),
  "utf8",
);

/** The key = "value" lines of the [headers.values] table that follows `for = "/*"`. */
function catchAllHeaderValues(toml: string): Record<string, string> {
  const block = /for\s*=\s*"\/\*"\s*\[headers\.values\]([\s\S]*?)(?=\n\s*\[|$)/.exec(toml);
  const values: Record<string, string> = {};
  for (const match of (block?.[1] ?? "").matchAll(/^\s*([\w-]+)\s*=\s*"([^"]*)"\s*$/gm)) {
    values[match[1]] = match[2];
  }
  return values;
}

describe("netlify.toml headers", () => {
  it("SPEC-8: the /* block sets exactly the static security headers", () => {
    expect(catchAllHeaderValues(NETLIFY_TOML)).toEqual(
      Object.fromEntries(STATIC_SECURITY_HEADERS.map(({ key, value }) => [key, value])),
    );
  });

  it("SPEC-8: netlify.toml never sets a Content-Security-Policy (it needs the per-request nonce)", () => {
    expect(NETLIFY_TOML).not.toMatch(/Content-Security-Policy/i);
  });
});
