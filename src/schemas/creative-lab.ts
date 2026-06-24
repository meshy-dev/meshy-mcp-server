/**
 * Zod schema for the Creative Lab tool (one tool covering the 4 OpenAPI products:
 * figure, lamp, keychain, fridge-magnet).
 *
 * The Meshy API splits Creative Lab into two stages — prototype (concept image, 6cr)
 * then build (textured 3D model, 30cr) — but that split is an internal implementation
 * detail. This single tool runs BOTH stages end-to-end, hides the intermediate concept
 * image, and returns only the final 3D product. Total cost: 36 credits.
 */

import { z } from "zod";
import { CreativeLabProduct } from "../constants.js";
import { ResponseFormatSchema } from "./common.js";

export const CreativeLabInputSchema = z.object({
  product: z.nativeEnum(CreativeLabProduct)
    .describe("Creative Lab product: 'figure' (chibi collectible), 'lamp' (3D-printable lampshade), 'keychain', or 'fridge-magnet'."),
  image_url: z.string()
    .optional()
    .describe("PUBLIC image URL or data URI of the source photo (.jpg/.jpeg/.png/.webp). For local files use file_path instead."),
  file_path: z.string()
    .optional()
    .describe("ABSOLUTE path to a LOCAL source photo (.jpg/.jpeg/.png/.webp). PREFERRED for local files; the server auto-encodes it."),
  text: z.string()
    .max(800, "Text prompt must not exceed 800 characters")
    .optional()
    .describe("Text prompt instead of an image. Supported by some products (e.g. lamp = text-to-3D path); figure/keychain/fridge-magnet are image-only. Provide EITHER an image (image_url/file_path) OR text. Max 800 chars."),
  image_subject: z.enum(["character", "landscape"])
    .optional()
    .describe("For image input on products that support it (e.g. lamp): subject type, 'character' or 'landscape'."),
  name: z.string()
    .max(100, "Name must not exceed 100 characters")
    .optional()
    .describe("Optional display name for the task (≤100 chars)."),
  timeout_seconds: z.number()
    .int()
    .min(30, "Timeout must be at least 30 seconds")
    .max(600, "Timeout cannot exceed 600 seconds")
    .default(300)
    .describe("Max seconds to wait for EACH stage (prototype, then build) before giving up. Default 300."),
  response_format: ResponseFormatSchema
}).strict();
