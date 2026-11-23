import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { ICONS, ICONS_DIRECTORY, encodePng, renderIconPixels } from "./generate-icons.mjs";

const PNG_SIGNATURE = "89504e470d0a1a0a";

type DecodedPng = { width: number; height: number; colorType: number; pixels: Buffer };

/** Reads a PNG written by encodePng (8-bit RGBA, filter 0 on every row). */
function decodePng(file: Buffer): DecodedPng {
  expect(file.subarray(0, 8).toString("hex")).toBe(PNG_SIGNATURE);
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  const data: Buffer[] = [];
  while (offset < file.length) {
    const length = file.readUInt32BE(offset);
    const type = file.toString("ascii", offset + 4, offset + 8);
    const body = file.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      colorType = body[9];
    } else if (type === "IDAT") {
      data.push(body);
    }
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const rowLength = width * 4;
  const pixels = Buffer.alloc(rowLength * height);
  for (let row = 0; row < height; row += 1) {
    expect(raw[row * (rowLength + 1)]).toBe(0);
    raw.copy(pixels, row * rowLength, row * (rowLength + 1) + 1, (row + 1) * (rowLength + 1));
  }
  return { width, height, colorType, pixels };
}

describe("M7.1-2: PWA icons", () => {
  it.each(ICONS)("M7.1-2: the committed $file is the generator's output", (icon) => {
    const decoded = decodePng(readFileSync(`${ICONS_DIRECTORY}${icon.file}`));
    expect(decoded.width).toBe(icon.size);
    expect(decoded.height).toBe(icon.size);
    expect(decoded.colorType).toBe(6);
    expect(decoded.pixels.equals(renderIconPixels(icon))).toBe(true);
  });

  it("M7.1-2: a maskable icon is fully opaque; an 'any' icon has transparent corners", () => {
    const maskable = renderIconPixels({ size: 48, maskable: true });
    const any = renderIconPixels({ size: 48, maskable: false });
    expect(maskable[3]).toBe(255);
    expect(any[3]).toBe(0);
    // The centre of the icon is opaque in both.
    const centre = (24 * 48 + 24) * 4 + 3;
    expect(any[centre]).toBe(255);
    expect(maskable[centre]).toBe(255);
  });

  it("M7.1-2: encodePng round-trips the pixels", () => {
    const pixels = renderIconPixels({ size: 16, maskable: false });
    expect(decodePng(encodePng(16, pixels)).pixels.equals(pixels)).toBe(true);
  });
});
