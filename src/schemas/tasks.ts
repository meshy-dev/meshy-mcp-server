/**
 * Zod schemas for task management tools
 */

import { z } from "zod";
import { TaskStatus, TaskPhase, TaskType, POLL_MAX_TIMEOUT } from "../constants.js";
import { ResponseFormatSchema, PaginationSchema, TaskIdSchema, TaskTypeSchema } from "./common.js";

/**
 * Get task status input schema (also supports wait mode)
 */
export const GetTaskStatusInputSchema = z.object({
  task_id: TaskIdSchema,
  task_type: TaskTypeSchema,
  wait: z.boolean()
    .default(true)
    .describe("If true (default), auto-poll until task completes. If false, return current status immediately."),
  timeout_seconds: z.number()
    .int()
    .min(10, "Timeout must be at least 10 seconds")
    .max(POLL_MAX_TIMEOUT / 1000, `Timeout cannot exceed ${POLL_MAX_TIMEOUT / 1000} seconds`)
    .default(300)
    .describe("Maximum wait time in seconds when wait=true (default: 300, max: 300)"),
  response_format: ResponseFormatSchema
}).strict();

/**
 * List tasks input schema
 */
export const ListTasksInputSchema = z.object({
  task_type: z.nativeEnum(TaskType)
    .optional()
    .describe("Filter by task type. If omitted, queries ALL task types (text-to-3d, image-to-3d, multi-image-to-3d, remesh, retexture, text-to-image, image-to-image) and merges results. Note: rigging and animation do not have list endpoints."),
  sort_by: z.enum(["+created_at", "-created_at"])
    .default("-created_at")
    .describe("Sort order by creation time. '-created_at' = newest first (default), '+created_at' = oldest first"),
  status: z.nativeEnum(TaskStatus)
    .optional()
    .describe("Filter by task status"),
  phase: z.nativeEnum(TaskPhase)
    .optional()
    .describe("Filter by task phase"),
  response_format: ResponseFormatSchema
}).merge(PaginationSchema).strict();

/**
 * Cancel task input schema
 */
export const CancelTaskInputSchema = z.object({
  task_id: TaskIdSchema,
  task_type: TaskTypeSchema
}).strict();

/**
 * Download model input schema
 */
export const DownloadModelInputSchema = z.object({
  task_id: TaskIdSchema,
  task_type: TaskTypeSchema,
  format: z.enum(["glb", "fbx", "usdz", "stl", "obj", "3mf"])
    .default("glb")
    .describe("Model format to download. IMPORTANT: Ask the user which format they need before downloading. Recommendations: GLB (general viewing), OBJ (white model printing), 3MF (multicolor printing), FBX (game engines/animation), USDZ (AR/Apple). Do NOT download all formats."),
  include_textures: z.boolean()
    .default(true)
    .describe("Include texture files in response"),
  save_to: z.string()
    .optional()
    .describe("Override auto-save path with a custom ABSOLUTE path. If omitted, auto-saves to meshy_output/{timestamp}_{prompt}_{id}/. Example: /Users/me/models/chair.glb"),
  parent_task_id: z.string()
    .optional()
    .describe("Parent task ID for chaining (e.g., preview_task_id for refine, input_task_id for rig). Places output in the same project folder as the parent."),
  print_ready: z.boolean()
    .optional()
    .describe("If true and format is OBJ, auto-fix coordinates for 3D printing: rotates Y-up to Z-up, scales to target height, centers on XY, aligns bottom to Z=0. Default false."),
  print_height_mm: z.number()
    .optional()
    .describe("Target height in mm when print_ready is true. Default 75. Adjust per user request (e.g. 'print at 15cm' → 150).")
}).strict();

/**
 * List models input schema
 */
export const ListModelsInputSchema = z.object({
  workspace_id: z.string()
    .optional()
    .describe("Workspace ID (uses default if omitted)"),
  filter: z.enum(["all", "published", "private"])
    .default("all")
    .describe("Filter models by visibility"),
  response_format: ResponseFormatSchema
}).merge(PaginationSchema).strict();
