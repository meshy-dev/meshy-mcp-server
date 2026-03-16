/**
 * Utility for reading local image files and converting to base64 data URIs.
 * Used by image-to-3d, multi-image-to-3d, and image-to-image tools
 * so agents don't need to pass huge base64 strings through MCP arguments.
 */

import { readFile } from "fs/promises";
import { extname } from "path";

const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

/**
 * Read a local image file and return a base64 data URI.
 * Throws descriptive errors for missing files, unsupported formats, or oversized files.
 */
export async function fileToDataUri(filePath: string): Promise<string> {
  const ext = extname(filePath).toLowerCase();
  const mime = MIME_TYPES[ext];

  if (!mime) {
    throw new Error(
      `Unsupported image format "${ext}". Supported: ${Object.keys(MIME_TYPES).join(", ")}`
    );
  }

  let buffer: Buffer;
  try {
    buffer = await readFile(filePath);
  } catch (err: any) {
    if (err.code === "ENOENT") {
      throw new Error(`File not found: ${filePath}`);
    }
    throw new Error(`Failed to read file ${filePath}: ${err.message}`);
  }

  if (buffer.length > MAX_FILE_SIZE) {
    const sizeMB = (buffer.length / (1024 * 1024)).toFixed(1);
    throw new Error(
      `File too large (${sizeMB} MB). Maximum is ${MAX_FILE_SIZE / (1024 * 1024)} MB.`
    );
  }

  const base64 = buffer.toString("base64");
  return `data:${mime};base64,${base64}`;
}

/**
 * Resolve an image source: if file_path is provided, convert to data URI;
 * otherwise return image_url as-is.
 */
export async function resolveImageSource(
  image_url?: string,
  file_path?: string
): Promise<string> {
  if (file_path) {
    return fileToDataUri(file_path);
  }
  if (image_url) {
    return image_url;
  }
  throw new Error(
    "Either image_url or file_path must be provided. " +
    "Use file_path for local files, image_url for public URLs."
  );
}
