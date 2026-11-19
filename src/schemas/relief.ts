/**
 * Zod schema for the Relief tool — POST /openapi/v1/relief (20 credits).
 *
 * One photo becomes a bas-relief model and a 16-bit depth map. Every range and
 * value the API documents is checked here, so a bad request is refused before
 * it is sent. Optional fields left out are not sent: the API applies its own
 * defaults.
 */

import { z } from "zod";
import { ResponseFormatSchema } from "./common.js";

/** The formats a relief task can generate (target_formats) and be downloaded in. */
export const RELIEF_FORMATS = ["glb", "obj", "fbx", "stl", "usdz", "3mf"] as const;

/** The formats that carry the photo's color with color_mapping; STL and 3MF stay white. */
export const RELIEF_COLOR_FORMATS: readonly string[] = ["glb", "obj", "fbx", "usdz"];

export const ReliefInputSchema = z.object({
  image_url: z.string()
    .optional()
    .describe("Public URL or data URI of the photo. For local files use file_path."),
  file_path: z.string()
    .optional()
    .describe("Absolute path to a local .jpg/.jpeg/.png/.webp; the server encodes it."),
  variant: z.enum(["low", "high"])
    .optional()
    .describe("'low' (default): shallow carving for laser engraving, CNC and thin plaques. 'high': deeper carving for 3D-printed pieces."),
  should_generate_model: z.boolean()
    .optional()
    .describe("false: the depth map only, with no model or preview (same cost). Default true."),
  size_mm: z.number()
    .min(20, "size_mm must be at least 20")
    .max(250, "size_mm cannot exceed 250")
    .optional()
    .describe("Length of the photo's longer side on the model, flat, in mm: 20–250 (default 60)."),
  carving_mode: z.enum(["emboss", "engrave"])
    .optional()
    .describe("'emboss' (default): the nearer parts stand out. 'engrave': they are cut in."),
  carving_depth_mm: z.number()
    .min(0, "carving_depth_mm must be at least 0")
    .max(60, "carving_depth_mm cannot exceed 60")
    .optional()
    .describe("Carving depth in mm, 0–60 (default 3 for low, 6 for high)."),
  remove_base: z.boolean()
    .optional()
    .describe("Cut away the background and build no base plate (default false)."),
  removal_threshold: z.number()
    .min(0.01, "removal_threshold must be at least 0.01")
    .max(1, "removal_threshold cannot exceed 1")
    .optional()
    .describe("With remove_base: the depth (0.01–1, default 0.01) below which the background is cut away. A high value can leave an empty model, still charged."),
  base_thickness_mm: z.number()
    .min(0, "base_thickness_mm must be 0.1–10, or 0 with remove_base")
    .max(10, "base_thickness_mm cannot exceed 10")
    .optional()
    .describe("Base plate thickness in mm, 0.1–10 (default 1). With remove_base true, omit it or send 0."),
  bend_mode: z.enum(["off", "convex", "concave"])
    .optional()
    .describe("'off' (default, flat), 'convex' (the front bulges out) or 'concave' (the front curves in)."),
  bend_axis: z.enum(["xz", "yz"])
    .optional()
    .describe("With a bend: 'xz' curls the left and right edges (default), 'yz' the top and bottom."),
  bend_angle: z.number()
    .min(0, "bend_angle must be at least 0")
    .max(360, "bend_angle cannot exceed 360")
    .optional()
    .describe("With a bend: the arc in degrees, 0–360 (default 60; below 1 stays flat)."),
  mesh_resolution: z.number()
    .int("mesh_resolution must be a whole number")
    .min(512, "mesh_resolution must be at least 512")
    .max(2048, "mesh_resolution cannot exceed 2048")
    .optional()
    .describe("Mesh points along the longer side, 512–2048 (default 1024). Higher keeps finer detail in much larger files."),
  target_formats: z.array(z.enum(RELIEF_FORMATS))
    .min(1, "List at least one format, or omit target_formats")
    .refine(formats => new Set(formats).size === formats.length, "target_formats must not repeat a format")
    .optional()
    .describe("Formats to generate; only these are returned (default glb and stl). STL and 3MF keep the real size."),
  color_mapping: z.boolean()
    .optional()
    .describe("Color the model with the photo (default false, same cost): GLB, OBJ, FBX and USDZ carry color; STL and 3MF stay white."),
  response_format: ResponseFormatSchema
}).strict();

/** Checks that span fields; returns an error message or null. */
export function checkReliefParams(params: z.infer<typeof ReliefInputSchema>): string | null {
  if (!params.image_url && !params.file_path) {
    return "provide the photo as image_url or file_path.";
  }
  const thickness = params.base_thickness_mm;
  if (thickness !== undefined) {
    if (params.remove_base === true && thickness !== 0) {
      return "with remove_base true there is no base plate: omit base_thickness_mm or send 0.";
    }
    if (params.remove_base !== true && thickness < 0.1) {
      return "base_thickness_mm must be 0.1–10 (0 only with remove_base true).";
    }
  }
  return null;
}
