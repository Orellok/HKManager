import { JPEG_MIME_TYPE } from "@/lib/files/signatures";

/**
 * EXP-2 / owner decision (M3): a receipt photo is compressed in the browser before upload,
 * with a canvas and no extra library: its longest side becomes at most MAX_IMAGE_SIDE pixels
 * and it is encoded as a JPEG. The photo is decoded with its EXIF orientation applied, so a
 * phone photo taken sideways comes out upright; re-encoding also drops the EXIF metadata
 * (such as the location where it was taken).
 */

export const MAX_IMAGE_SIDE = 2000;
/** Good enough to read a receipt, a fraction of the original size. */
export const JPEG_QUALITY = 0.85;

export type ImageSize = { width: number; height: number };

/**
 * The size an image of `width` × `height` is drawn at: unchanged when its longest side is at
 * most `maxSide`, otherwise scaled down proportionally so that side is exactly `maxSide`.
 * Both sides are whole pixels and at least 1.
 */
export function scaledSize(width: number, height: number, maxSide = MAX_IMAGE_SIDE): ImageSize {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new RangeError("An image size must be at least 1 × 1");
  }
  const longest = Math.max(width, height);
  if (longest <= maxSide) {
    return { width: Math.round(width), height: Math.round(height) };
  }
  const scale = maxSide / longest;
  return {
    width: width >= height ? maxSide : Math.max(1, Math.round(width * scale)),
    height: height > width ? maxSide : Math.max(1, Math.round(height * scale)),
  };
}

/** The browser could not decode the image, or could not encode the result. */
export class ImageCompressionError extends Error {}

/** Compresses an image file (JPEG or PNG) to a JPEG of at most MAX_IMAGE_SIDE pixels. */
export async function compressImage(file: Blob): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    // "from-image": the EXIF orientation is applied, and width/height are the upright ones.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch (error) {
    throw new ImageCompressionError("The image could not be decoded", { cause: error });
  }
  try {
    const size = scaledSize(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new ImageCompressionError("No 2D canvas context");
    }
    // JPEG has no transparency: transparent PNG areas become white, not black.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, JPEG_MIME_TYPE, JPEG_QUALITY),
    );
    if (!blob) {
      throw new ImageCompressionError("The image could not be encoded");
    }
    return blob;
  } finally {
    bitmap.close();
  }
}
