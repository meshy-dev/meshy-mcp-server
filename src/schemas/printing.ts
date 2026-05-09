/**
 * Zod schemas for 3D printing tools
 */

import { z } from "zod";
import { ResponseFormatSchema, TaskIdSchema, UrlSchema } from "./common.js";

/**
 * Send to slicer input schema (cross-platform 7-slicer detection).
 */
export const SendToSlicerInputSchema = z.object({
  model_url: UrlSchema
    .describe("Download URL of the model file to send to slicer (can be a placeholder when only running detection)"),
  slicer_type: z.enum([
    "auto",
    "bambu",
    "orcaslicer",
    "creality_print",
    "elegoo_slicer",
    "anycubic_slicer",
    "prusaslicer",
    "cura"
  ])
    .default("auto")
    .describe("Target slicer. 'auto' (default) detects all installed slicers and recommends the best one. Specify a value to target a particular slicer."),
  file_name: z.string()
    .default("meshy_model.3mf")
    .describe("File name for the model (default: meshy_model.3mf)"),
  is_multicolor: z.boolean()
    .default(false)
    .describe("If true, only recommends multicolor-capable slicers (OrcaSlicer, Bambu Studio, Creality Print, Elegoo Slicer, Anycubic Slicer Next)"),
  response_format: ResponseFormatSchema
}).strict();

/**
 * Analyze-printability input schema — POST /openapi/v1/print/analyze. FREE.
 *
 * Provide exactly one of input_task_id / model_url. Validation happens at the
 * handler level so the exported schema stays a plain ZodObject.
 *
 * input_task_id constraints: must be a SUCCEEDED task that used Meshy 6 or any
 * Preview model. Supported task types: image-to-3d, multi-image-to-3d,
 * text-to-3d, remesh, retexture.
 */
export const AnalyzePrintabilityInputSchema = z.object({
  input_task_id: TaskIdSchema.optional()
    .describe("ID of a SUCCEEDED upstream task to analyze (must use Meshy 6 or a Preview model). Mutually exclusive with model_url."),
  model_url: UrlSchema.optional()
    .describe("Public URL of a 3D model to analyze (.glb / .gltf / .obj / .fbx / .stl, max 100 MB). Mutually exclusive with input_task_id."),
  response_format: ResponseFormatSchema
}).strict();

/**
 * Repair-printability input schema — POST /openapi/v1/print/repair (10 credits).
 * Output format mirrors input format; for input_task_id the output is GLB.
 */
export const RepairPrintabilityInputSchema = z.object({
  input_task_id: TaskIdSchema.optional()
    .describe("ID of a SUCCEEDED upstream task with a GLB asset. Output will be GLB. Mutually exclusive with model_url."),
  model_url: UrlSchema.optional()
    .describe("Public URL of a 3D model to repair (.glb / .stl / .obj, max 100 MB). Output format matches input. Mutually exclusive with input_task_id."),
  response_format: ResponseFormatSchema
}).strict();

/**
 * Process-multicolor input schema — POST /openapi/v1/print/multi-color (10 credits).
 * The input model MUST have textures.
 */
export const ProcessMulticolorInputSchema = z.object({
  input_task_id: TaskIdSchema.optional()
    .describe("ID of a SUCCEEDED textured task. Run meshy_text_to_3d_refine or meshy_retexture first if needed. Mutually exclusive with model_url."),
  model_url: UrlSchema.optional()
    .describe("Public URL of a textured 3D model (.glb / .fbx). Mutually exclusive with input_task_id."),
  max_colors: z.number()
    .int()
    .min(1, "Minimum 1 color")
    .max(16, "Maximum 16 colors")
    .default(4)
    .describe("Maximum number of colors in the output palette (1-16, default: 4). Match this to the user's printer AMS/MMU capability."),
  max_depth: z.number()
    .int()
    .min(3, "Minimum depth 3")
    .max(6, "Maximum depth 6")
    .default(4)
    .describe("Quadtree depth for color precision (3-6, default: 4). Higher = finer color boundaries but larger file."),
  response_format: ResponseFormatSchema
}).strict();

/**
 * Runtime check: exactly one of input_task_id / model_url must be present.
 * Returns null if valid, or an error message if not.
 */
export function validateExactlyOneSource(
  params: { input_task_id?: string; model_url?: string }
): string | null {
  const hasTaskId = Boolean(params.input_task_id);
  const hasUrl = Boolean(params.model_url);
  if (hasTaskId === hasUrl) {
    return "Provide exactly one of input_task_id or model_url";
  }
  return null;
}
