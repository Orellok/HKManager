import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { APP_NAME, webAppManifest } from "./manifest";

const PUBLIC_DIRECTORY = fileURLToPath(new URL("../../../public", import.meta.url));

describe("M7.1-1: web app manifest", () => {
  it("M7.1-1: names the app HKManager, in Hebrew, right to left, standalone from /", () => {
    expect(webAppManifest()).toMatchObject({
      id: "/",
      name: APP_NAME,
      short_name: "HKManager",
      lang: "he",
      dir: "rtl",
      start_url: "/",
      scope: "/",
      display: "standalone",
    });
  });

  it("M7.1-1: lists 192 and 512 PNG icons and a maskable 512 icon that exist in public/", () => {
    const icons = webAppManifest().icons ?? [];
    expect(icons.map(({ sizes, purpose }) => `${sizes} ${purpose}`)).toEqual([
      "192x192 any",
      "512x512 any",
      "512x512 maskable",
    ]);
    for (const icon of icons) {
      expect(icon.type).toBe("image/png");
      expect(existsSync(`${PUBLIC_DIRECTORY}${icon.src}`)).toBe(true);
    }
  });

  it("M7.1-1: theme and background colors are sRGB hex values", () => {
    const { theme_color: theme, background_color: background } = webAppManifest();
    expect(theme).toMatch(/^#[0-9a-f]{6}$/);
    expect(background).toMatch(/^#[0-9a-f]{6}$/);
  });
});
