/**
 * Zod schemas for standalone post-processing tools: convert, resize, uv-unwrap.
 *
 * All three accept exactly one of input_task_id / model_url. Validation happens at
 * the handler level (see validateExactlyOneSource in ./printing.js) so the exported
 * schema stays a plain ZodObject compatible with `inputSchema`.
 */

import { z } from "zod";
import { ConvertFormat, OriginAt } from "../constants.js";
import { ResponseFormatSchema, TaskIdSchema, UrlSchema } from "./common.js";

/**
 * Convert input schema — POST /openapi/v1/convert (1 credit).
 * Cheaper, dedicated format conversion (vs. remesh). target_formats is required.
 */
export const ConvertInputSchema = z.object({
  input_task_id: TaskIdSchema.optional()
    .describe("ID of a SUCCEEDED Meshy task whose model to convert. Mutually exclusive with model_url."),
  model_url: UrlSchema.optional()
    .describe("Public URL or data URI of a 3D model (.glb / .gltf / .obj / .fbx / .stl). Mutually exclusive with input_task_id."),
  target_formats: z.array(z.nativeEnum(ConvertFormat))
    .min(1, "At least one target format is required")
    .describe("Output formats (required). Options: glb, fbx, obj, usdz, blend, stl, 3mf."),
  response_format: ResponseFormatSchema
}).strict();

/**
 * Resize input schema — POST /openapi/v1/resize (1 credit).
 * Exactly one resize mode (resize_height / resize_longest_side / auto_size) is required.
 */
export const ResizeInputSchema = z.object({
  input_task_id: TaskIdSchema.optional()
    .describe("ID of a SUCCEEDED Meshy task whose model to resize (output is GLB). Mutually exclusive with model_url."),
  model_url: UrlSchema.optional()
    .describe("Public URL or data URI of a 3D model (.glb / .gltf / .obj / .fbx / .stl); output preserves the input format. Mutually exclusive with input_task_id."),
  resize_height: z.number()
    .positive()
    .optional()
    .describe("Resize to this exact height in meters. Mutually exclusive with resize_longest_side / auto_size."),
  resize_longest_side: z.number()
    .positive()
    .optional()
    .describe("Resize so the longest side matches this value in meters (aspect ratio preserved). Mutually exclusive with resize_height / auto_size."),
  auto_size: z.boolean()
    .optional()
    .describe("Use AI vision to estimate the real-world height and resize accordingly. Mutually exclusive with resize_height / resize_longest_side."),
  origin_at: z.nativeEnum(OriginAt)
    .optional()
    .describe("Origin placement after resizing: 'bottom' (default) or 'center'."),
  response_format: ResponseFormatSchema
}).strict();

/**
 * UV Unwrap input schema — POST /openapi/v1/uv-unwrap (5 credits).
 * GLB only; meshes over 40,000 faces are rejected with 400 (remesh first).
 */
export const UvUnwrapInputSchema = z.object({
  input_task_id: TaskIdSchema.optional()
    .describe("ID of a SUCCEEDED Meshy task that produced a GLB (≤40,000 faces). Mutually exclusive with model_url."),
  model_url: UrlSchema.optional()
    .describe("Public URL or data URI of a .glb model (≤40,000 faces). ONLY .glb is supported — convert other formats first. Mutually exclusive with input_task_id."),
  response_format: ResponseFormatSchema
}).strict();

/**
 * Runtime check for resize: exactly one resize mode must be present.
 * Returns null if valid, or an error message if not.
 */
export function validateExactlyOneResizeMode(
  params: { resize_height?: number; resize_longest_side?: number; auto_size?: boolean }
): string | null {
  const modes = [
    params.resize_height !== undefined,
    params.resize_longest_side !== undefined,
    Boolean(params.auto_size)
  ].filter(Boolean).length;
  if (modes !== 1) {
    return "Provide exactly one resize mode: resize_height, resize_longest_side, or auto_size.";
  }
  return null;
}
