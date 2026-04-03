/**
 * Zod schemas for 3D printing tools
 */

import { z } from "zod";
import { ResponseFormatSchema, TaskIdSchema, UrlSchema } from "./common.js";

/**
 * Send to slicer input schema
 * Detects installed slicers and returns launch commands.
 */
export const SendToSlicerInputSchema = z.object({
  model_url: UrlSchema
    .describe("Download URL of the model file to send to slicer"),
  slicer_type: z.enum(["auto", "bambu", "orcaslicer", "creality_print", "elegoo_slicer", "anycubic_slicer", "prusaslicer", "cura"])
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
 * Analyze printability input schema
 */
export const AnalyzePrintabilityInputSchema = z.object({
  task_id: TaskIdSchema,
  task_type: z.string()
    .default("text-to-3d")
    .describe("Task type of the model to analyze"),
  response_format: ResponseFormatSchema
}).strict();

/**
 * Process multicolor input schema
 * Calls POST /openapi/v1/print/multi-color to create a multicolor print task.
 */
export const ProcessMulticolorInputSchema = z.object({
  input_task_id: TaskIdSchema
    .describe("Task ID of a completed TEXTURED model. The model must have textures (run meshy_text_to_3d_refine or meshy_retexture first)."),
  max_colors: z.number()
    .int()
    .min(1, "Minimum 1 color")
    .max(16, "Maximum 16 colors")
    .default(4)
    .describe("Maximum number of colors for segmentation (1-16, default: 4)"),
  max_depth: z.number()
    .int()
    .min(3, "Minimum depth 3")
    .max(6, "Maximum depth 6")
    .default(4)
    .describe("Segmentation depth level (3-6, default: 4). Higher values produce finer color separation."),
  response_format: ResponseFormatSchema
}).strict();
