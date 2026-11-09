/**
 * Zod schema for the Creative Lab tool (one tool covering every public
 * Creative Lab product).
 *
 * Most products run two stages — prototype (concept image) then build (3D
 * model). This tool runs both, hides the intermediate concept image, and
 * returns only the final 3D product. Collapsible Fidget is a single stage.
 *
 * Cost: see creativeLabCredits(). Every product is image-only.
 */

import { z } from "zod";
import { CreativeLabProduct, KEYCAP_BASE_MODEL } from "../constants.js";
import { ResponseFormatSchema } from "./common.js";

/** Build output formats per product (`output.format`); products not listed take none. */
export const CREATIVE_LAB_OUTPUT_FORMATS: Partial<Record<CreativeLabProduct, readonly string[]>> = {
  [CreativeLabProduct.KEYCHAIN]: ["glb", "obj", "zip"],
  [CreativeLabProduct.FRIDGE_MAGNET]: ["glb", "obj", "zip"],
  [CreativeLabProduct.LAMP]: ["stl", "zip"],
  [CreativeLabProduct.FIDGET_PIXEL]: ["3mf"]
};

/** A number that must be one of a few values (a union of literals gives only "Invalid input"). */
const oneOf = (values: number[], message: string) =>
  z.number().refine(value => values.includes(value), message);

/**
 * Build options per product, with the ranges the API documents, so a bad value is refused before
 * the billable prototype is posted. Unknown keys pass through: the API is the final validator.
 */
const lampOptions = z.object({
  diameter_mm: z.number().min(50).max(400).optional(),
  thickness_mm: z.number().gt(0).max(10).optional(),
  cut_amount_percent: z.number().min(1).max(100).optional(),
  light_source_preset: z.enum(["bambu_mh001_60mm", "none"]).optional(),
  fixture_offset_x_mm: z.number().min(-80).max(80).optional(),
  fixture_offset_z_mm: z.number().min(-80).max(80).optional(),
  rotate_x_deg: z.number().min(-360).max(360).optional(),
  rotate_y_deg: z.number().min(-360).max(360).optional(),
  rotate_z_deg: z.number().min(-360).max(360).optional(),
  include_result_json: z.boolean().optional()
}).passthrough();

const reliefOptions = z.object({
  badge_shape: z.enum(["circle", "rounded-rect", "hexagon", "shield", "star"]).optional(),
  size_mm: z.number().gt(0).max(400).optional(),
  relief_height_mm: z.number().min(0).max(20).optional(),
  relief_offset_mm: z.number().min(0).max(20).optional(),
  base_thickness_mm: z.number().min(0).max(20).optional(),
  has_closed_back: z.boolean().optional(),
  relief_curve: z.enum(["linear", "gamma", "s-curve"]).optional(),
  curve_param: z.number().gt(0).max(10).optional(),
  invert_depth: z.boolean().optional(),
  smoothing: z.number().min(0).max(10).optional(),
  relief_scale: z.number().gt(0).max(10).optional(),
  depth_threshold: z.number().min(0).max(1).optional(),
  remove_background: z.boolean().optional(),
  // 0 means the server default (512); 512 is the depth map's own resolution, so the API refuses more.
  export_resolution: z.number()
    .refine(value => value === 0 || (Number.isInteger(value) && value >= 64 && value <= 512),
      "must be 0 (the server default) or a whole number from 64 to 512")
    .optional()
}).passthrough();

const keycapOptions = z.object({
  base_model: z.enum([KEYCAP_BASE_MODEL]).optional(),
  head_size_mm: z.number().min(10).max(40).optional(),
  vertical_offset_mm: z.number().min(-5).max(5).optional()
}).passthrough();

const fidgetPixelOptions = z.object({
  shape: z.enum(["square", "hex"]).optional(),
  grid_size: oneOf([16, 32], "must be 16 or 32").optional(),
  piece_size_mm: oneOf([6, 8, 10], "must be 6, 8 or 10").optional(),
  color_count: z.number().int().min(1).max(8).optional(),
  piece_height_mm: z.number().int().min(10).max(80).optional()
}).passthrough()
  .refine(o => !(o.shape === "hex" && o.piece_size_mm === 10),
    { message: "hex pieces come in 6 or 8 mm only", path: ["piece_size_mm"] });

/** Products whose build stage takes an `options` object, with what each one accepts. */
const CREATIVE_LAB_BUILD_OPTIONS: Partial<Record<CreativeLabProduct, z.ZodTypeAny>> = {
  [CreativeLabProduct.KEYCHAIN]: reliefOptions,
  [CreativeLabProduct.FRIDGE_MAGNET]: reliefOptions,
  [CreativeLabProduct.LAMP]: lampOptions,
  [CreativeLabProduct.FIDGET_PIXEL]: fidgetPixelOptions,
  [CreativeLabProduct.KEYCAP]: keycapOptions
};

export const CreativeLabInputSchema = z.object({
  product: z.nativeEnum(CreativeLabProduct)
    .describe("The product (see the tool description for costs)."),
  image_url: z.string()
    .optional()
    .describe("Public URL or data URI of the photo (.jpg/.jpeg/.png/.webp). For local files use file_path."),
  file_path: z.string()
    .optional()
    .describe("Absolute path to a local photo; the server encodes it."),
  image_subject: z.enum(["character", "landscape"])
    .optional()
    .describe("Lamp only: what the photo shows."),
  pixel_subject: z.enum(["person", "other"])
    .optional()
    .describe("fidget-pixel only, REQUIRED: 'person' → chibi pixel sprite; 'other' (pets, objects, logos, landscapes) → bead-art icon."),
  name_text: z.string()
    .refine(text => [...text.trim()].length <= 10, "name_text must be at most 10 characters")
    .optional()
    .describe("Keychain only: text printed on the face as a flat coloured detail (not raised or cut), ≤10 characters (CJK count one each). The build keeps it."),
  head_size_mm: z.number()
    .min(10, "head_size_mm must be at least 10")
    .max(40, "head_size_mm cannot exceed 40")
    .optional()
    .describe("Keycap only: the head's LONGEST edge in mm (default 23), not its height."),
  vertical_offset_mm: z.number()
    .min(-5, "vertical_offset_mm must be at least -5")
    .max(5, "vertical_offset_mm cannot exceed 5")
    .optional()
    .describe("Keycap only: raise (+) or lower (-) the head on the base, in mm (default 0)."),
  base_model: z.literal(KEYCAP_BASE_MODEL)
    .optional()
    .describe("Keycap only: base profile (Cherry MX 1u)."),
  build_options: z.record(z.union([z.string(), z.number(), z.boolean()]))
    .optional()
    .describe("Build options; ranges are checked before anything is billed. Keychain / fridge-magnet: badge_shape (circle|rounded-rect|hexagon|shield|star), size_mm, relief_height_mm, relief_offset_mm, base_thickness_mm, has_closed_back, relief_curve (linear|gamma|s-curve), curve_param, invert_depth, smoothing, relief_scale, depth_threshold, remove_background, export_resolution (0 = server default, or 64–512). Lamp: diameter_mm (50–400), thickness_mm, cut_amount_percent, light_source_preset (bambu_mh001_60mm|none), fixture_offset_x_mm, fixture_offset_z_mm, rotate_x_deg, rotate_y_deg, rotate_z_deg, include_result_json (true needs output_format zip). Fidget pixel: shape (square|hex), grid_size (16|32), piece_size_mm (6|8|10; hex 6|8), color_count (1–8), piece_height_mm (10–80). Other products take none."),
  output_format: z.enum(["glb", "obj", "zip", "stl", "3mf"])
    .optional()
    .describe("Keychain / fridge-magnet: glb (default), obj (zip of OBJ + MTL + texture) or zip (everything). Lamp: stl (default) or zip. Fidget pixel: 3mf. Others: none."),
  name: z.string()
    .max(100, "Name must not exceed 100 characters")
    .optional()
    .describe("Display name for the task; not printed on the model (see name_text)."),
  timeout_seconds: z.number()
    .int()
    .min(30, "Timeout must be at least 30 seconds")
    .max(600, "Timeout cannot exceed 600 seconds")
    .default(300)
    .describe("Max wait per stage in seconds; a longer stage keeps running (check it with meshy_get_task_status)."),
  response_format: ResponseFormatSchema
}).strict();

/** Product-specific argument checks; returns an error message or null. */
export function checkCreativeLabParams(params: z.infer<typeof CreativeLabInputSchema>): string | null {
  const { product } = params;
  if (product === CreativeLabProduct.FIDGET_PIXEL && !params.pixel_subject) {
    return "fidget-pixel needs pixel_subject: 'person' or 'other'.";
  }
  const onlyFor: [unknown, CreativeLabProduct, string][] = [
    [params.image_subject, CreativeLabProduct.LAMP, "image_subject"],
    [params.pixel_subject, CreativeLabProduct.FIDGET_PIXEL, "pixel_subject"],
    [params.name_text, CreativeLabProduct.KEYCHAIN, "name_text"],
    [params.head_size_mm, CreativeLabProduct.KEYCAP, "head_size_mm"],
    [params.vertical_offset_mm, CreativeLabProduct.KEYCAP, "vertical_offset_mm"],
    [params.base_model, CreativeLabProduct.KEYCAP, "base_model"]
  ];
  for (const [value, owner, field] of onlyFor) {
    if (value !== undefined && product !== owner) return `${field} is for ${owner} only.`;
  }
  if (params.build_options) {
    const schema = CREATIVE_LAB_BUILD_OPTIONS[product];
    if (!schema) return `${product} takes no build_options.`;
    const parsed = schema.safeParse(params.build_options);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = issue.path.join(".");
      return `${product} build_options invalid: ${field ? `${field}: ` : ""}${issue.message}.`;
    }
  }
  if (params.output_format) {
    const formats = CREATIVE_LAB_OUTPUT_FORMATS[product];
    if (!formats?.includes(params.output_format)) {
      return formats
        ? `${product} output_format must be one of: ${formats.join(", ")}.`
        : `${product} takes no output_format.`;
    }
  }
  if (product === CreativeLabProduct.LAMP && params.build_options?.include_result_json === true && params.output_format !== "zip") {
    return "lamp include_result_json true requires output_format zip (the STL output has no place for result.json).";
  }
  return null;
}
