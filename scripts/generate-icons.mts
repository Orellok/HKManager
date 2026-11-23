/**
 * Generates the PWA icons (M7.1-2) with Node built-ins only: a dark square with the letters
 * "HK" in light, drawn from rectangles and slanted strokes and anti-aliased by supersampling,
 * then encoded as PNG with node:zlib. The committed files under public/icons/ must match this
 * output (scripts/generate-icons.test.mts compares the pixels).
 *
 * Usage: node scripts/generate-icons.mts   (writes public/icons/*.png)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { crc32, deflateSync } from "node:zlib";

type Rgb = readonly [red: number, green: number, blue: number];
type Point = readonly [x: number, y: number];

/** --primary (oklch 0.205 0 0) and --primary-foreground (oklch 0.985 0 0) in sRGB. */
export const ICON_BACKGROUND: Rgb = [23, 23, 23];
export const ICON_FOREGROUND: Rgb = [250, 250, 250];

export type IconSpec = { file: string; size: number; maskable: boolean };

export const ICONS: readonly IconSpec[] = [
  { file: "icon-192.png", size: 192, maskable: false },
  { file: "icon-512.png", size: 512, maskable: false },
  { file: "icon-maskable-512.png", size: 512, maskable: true },
];

/** Corner radius of the "any" icons, as a share of the side; maskable icons are full squares. */
const CORNER_RADIUS = 0.2;
const SUPERSAMPLE = 4;
const STROKE = 0.08;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const BYTES_PER_PIXEL = 4;

/**
 * The letters, in units of the icon's side (x to the right, y down). They fit in the central
 * circle of radius 0.4 that a maskable icon keeps visible.
 */
const GLYPH: readonly (readonly Point[])[] = [
  // H
  rectangle(0.25, 0.33, 0.33, 0.67),
  rectangle(0.39, 0.33, 0.47, 0.67),
  rectangle(0.25, 0.46, 0.47, 0.54),
  // K
  rectangle(0.53, 0.33, 0.61, 0.67),
  stroke([0.59, 0.53], [0.75, 0.33]),
  stroke([0.61, 0.47], [0.75, 0.67]),
];

function rectangle(left: number, top: number, right: number, bottom: number): Point[] {
  return [
    [left, top],
    [right, top],
    [right, bottom],
    [left, bottom],
  ];
}

/** A straight stroke of width STROKE between two points, as a quadrilateral. */
function stroke(from: Point, to: Point): Point[] {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const offsetX = (-(to[1] - from[1]) / length) * (STROKE / 2);
  const offsetY = ((to[0] - from[0]) / length) * (STROKE / 2);
  return [
    [from[0] + offsetX, from[1] + offsetY],
    [to[0] + offsetX, to[1] + offsetY],
    [to[0] - offsetX, to[1] - offsetY],
    [from[0] - offsetX, from[1] - offsetY],
  ];
}

/** Whether a point is inside a convex polygon (either winding). */
function insideConvex(polygon: readonly Point[], x: number, y: number): boolean {
  let sign = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const [ax, ay] = polygon[index];
    const [bx, by] = polygon[(index + 1) % polygon.length];
    const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (cross !== 0) {
      if (sign !== 0 && Math.sign(cross) !== sign) {
        return false;
      }
      sign = Math.sign(cross);
    }
  }
  return true;
}

function insideRoundedSquare(x: number, y: number, radius: number): boolean {
  const cornerX = Math.min(Math.max(x, radius), 1 - radius);
  const cornerY = Math.min(Math.max(y, radius), 1 - radius);
  return Math.hypot(x - cornerX, y - cornerY) <= radius;
}

/** The icon's pixels as RGBA rows, without PNG filter bytes. */
export function renderIconPixels({ size, maskable }: Pick<IconSpec, "size" | "maskable">): Buffer {
  const pixels = Buffer.alloc(size * size * BYTES_PER_PIXEL);
  const radius = maskable ? 0 : CORNER_RADIUS;
  const samples = SUPERSAMPLE * SUPERSAMPLE;
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      let shapeHits = 0;
      let glyphHits = 0;
      for (let sampleY = 0; sampleY < SUPERSAMPLE; sampleY += 1) {
        for (let sampleX = 0; sampleX < SUPERSAMPLE; sampleX += 1) {
          const x = (column + (sampleX + 0.5) / SUPERSAMPLE) / size;
          const y = (row + (sampleY + 0.5) / SUPERSAMPLE) / size;
          if (!insideRoundedSquare(x, y, radius)) {
            continue;
          }
          shapeHits += 1;
          if (GLYPH.some((polygon) => insideConvex(polygon, x, y))) {
            glyphHits += 1;
          }
        }
      }
      const glyphShare = shapeHits === 0 ? 0 : glyphHits / shapeHits;
      const offset = (row * size + column) * BYTES_PER_PIXEL;
      for (let channel = 0; channel < 3; channel += 1) {
        pixels[offset + channel] = Math.round(
          ICON_BACKGROUND[channel] + (ICON_FOREGROUND[channel] - ICON_BACKGROUND[channel]) * glyphShare,
        );
      }
      pixels[offset + 3] = Math.round((shapeHits / samples) * 255);
    }
  }
  return pixels;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, checksum]);
}

/** RGBA pixels → PNG (8-bit RGBA, no interlace, filter 0 on every row). */
export function encodePng(size: number, pixels: Buffer): Buffer {
  const rowLength = size * BYTES_PER_PIXEL;
  const filtered = Buffer.alloc((rowLength + 1) * size);
  for (let row = 0; row < size; row += 1) {
    pixels.copy(filtered, row * (rowLength + 1) + 1, row * rowLength, (row + 1) * rowLength);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // color type: RGBA
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(filtered, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

export const ICONS_DIRECTORY = fileURLToPath(new URL("../public/icons/", import.meta.url));

function main(): void {
  mkdirSync(ICONS_DIRECTORY, { recursive: true });
  for (const icon of ICONS) {
    writeFileSync(`${ICONS_DIRECTORY}${icon.file}`, encodePng(icon.size, renderIconPixels(icon)));
    console.log(`Wrote public/icons/${icon.file}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
