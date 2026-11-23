import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SERVICE_WORKER_HEADERS } from "./pwa/headers";
import { STATIC_SECURITY_HEADERS } from "./security-headers";

const NETLIFY_TOML = readFileSync(
  fileURLToPath(new URL("../../netlify.toml", import.meta.url)),
  "utf8",
);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/** The key = "value" lines of the [headers.values] table that follows `for = "<path>"`. */
function headerValuesFor(toml: string, path: string): Record<string, string> {
  const block = new RegExp(
    `for\\s*=\\s*"${escapeRegExp(path)}"\\s*\\[headers\\.values\\]([\\s\\S]*?)(?=\\n\\s*\\[|$)`,
  ).exec(toml);
  const values: Record<string, string> = {};
  for (const match of (block?.[1] ?? "").matchAll(/^\s*([\w-]+)\s*=\s*"([^"]*)"\s*$/gm)) {
    values[match[1]] = match[2];
  }
  return values;
}

describe("netlify.toml headers", () => {
  it("SPEC-8: the /* block sets exactly the static security headers", () => {
    expect(headerValuesFor(NETLIFY_TOML, "/*")).toEqual(
      Object.fromEntries(STATIC_SECURITY_HEADERS.map(({ key, value }) => [key, value])),
    );
  });

  it("M7.1-5: the /sw.js block sets exactly the service worker headers", () => {
    expect(headerValuesFor(NETLIFY_TOML, "/sw.js")).toEqual(
      Object.fromEntries(SERVICE_WORKER_HEADERS.map(({ key, value }) => [key, value])),
    );
  });

  it("SPEC-8: netlify.toml never sets a Content-Security-Policy (it needs the per-request nonce)", () => {
    expect(NETLIFY_TOML).not.toMatch(/Content-Security-Policy/i);
  });
});
