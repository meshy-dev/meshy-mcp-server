/**
 * Zod schemas for 3D printing tools
 */

import { z } from "zod";
import { ResponseFormatSchema, TaskIdSchema, TaskTypeSchema, UrlSchema } from "./common.js";

/**
 * Send to slicer input schema
 * Only Bambu Studio is supported for one-click URL scheme.
 * For other slicers, the tool provides 3MF download guidance.
 */
export const SendToSlicerInputSchema = z.object({
  model_url: UrlSchema
    .describe("Download URL of the model file to send to slicer"),
  slicer_type: z.string()
    .default("bambu")
    .describe("Target slicer software. Currently only 'bambu' (Bambu Studio) supports one-click URL scheme. For other slicers, a 3MF download link and manual import instructions will be provided instead."),
  file_name: z.string()
    .default("meshy_model.3mf")
    .describe("File name for the model (default: meshy_model.3mf)"),
  response_format: ResponseFormatSchema
}).strict();

/**
 * Analyze printability input schema
 */
export const AnalyzePrintabilityInputSchema = z.object({
  task_id: TaskIdSchema,
  task_type: TaskTypeSchema,
  response_format: ResponseFormatSchema
}).strict();

/**
 * Process multicolor input schema
 */
export const ProcessMulticolorInputSchema = z.object({
  task_id: TaskIdSchema,
  task_type: TaskTypeSchema,
  num_colors: z.number()
    .int()
    .min(2, "Minimum 2 colors")
    .max(16, "Maximum 16 colors")
    .default(4)
    .describe("Number of colors for multi-color processing (default: 4)"),
  response_format: ResponseFormatSchema
}).strict();
