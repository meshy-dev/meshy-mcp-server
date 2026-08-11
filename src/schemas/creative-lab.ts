/**
 * Zod schema for the Creative Lab tool (one tool covering all 7 OpenAPI products:
 * figure, lamp, keychain, fridge-magnet, vinyl-figure, brick-figure, keycap).
 *
 * The Meshy API splits Creative Lab into two stages — prototype (concept image)
 * then build (textured 3D model) — but that split is an internal implementation
 * detail. This single tool runs BOTH stages end-to-end, hides the intermediate
 * concept image, and returns only the final 3D product.
 *
 * Cost: 6 + 30 = 36 credits for every product EXCEPT keycap, whose prototype
 * renders two images per candidate (12) and whose build carries the base-plate
 * generation (50) → 62 credits.
 */

import { z } from "zod";
import { CreativeLabProduct, KEYCAP_BASE_MODEL } from "../constants.js";
import { ResponseFormatSchema } from "./common.js";

export const CreativeLabInputSchema = z.object({
  product: z.nativeEnum(CreativeLabProduct)
    .describe("Creative Lab product: 'figure' (chibi collectible), 'lamp' (3D-printable lampshade), 'keychain', 'fridge-magnet', 'vinyl-figure' (vinyl-toy style), 'brick-figure' (brick-minifigure style), or 'keycap' (Cherry MX 1u keycap — costs 62 credits, not 36)."),
  image_url: z.string()
    .optional()
    .describe("PUBLIC image URL or data URI of the source photo (.jpg/.jpeg/.png/.webp). For local files use file_path instead."),
  file_path: z.string()
    .optional()
    .describe("ABSOLUTE path to a LOCAL source photo (.jpg/.jpeg/.png/.webp). PREFERRED for local files; the server auto-encodes it."),
  text: z.string()
    .max(800, "Text prompt must not exceed 800 characters")
    .optional()
    .describe("Text prompt instead of an image. ONLY the 'lamp' product accepts text; every other product is image-only. Provide EITHER an image (image_url/file_path) OR text. Max 800 chars."),
  image_subject: z.enum(["character", "landscape"])
    .optional()
    .describe("Lamp only: subject type of the input image, 'character' or 'landscape'."),
  head_size_mm: z.number()
    .min(10, "head_size_mm must be at least 10")
    .max(40, "head_size_mm cannot exceed 40")
    .optional()
    .describe("Keycap only: scales the head's LONGEST edge to this many millimetres (10–40, default 23). This is NOT the height above the base."),
  base_model: z.literal(KEYCAP_BASE_MODEL)
    .optional()
    .describe(`Keycap only: keycap base profile. '${KEYCAP_BASE_MODEL}' (Cherry MX 1u) is the only value supported today.`),
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
